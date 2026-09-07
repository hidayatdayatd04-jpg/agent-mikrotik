import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { Env } from "../types";
import { AppError } from "../lib/errors";
import { RouterModeSchema } from "@shared/index";
import type { ConnectorService } from "../services/connector";
import type { McpSupervisor } from "../mcp/supervisor";
import type { TransactionCoordinator } from "../transactions/coordinator";
import type { Logger } from "../lib/logger";
import type { WorkspaceContext } from "../lib/workspace";

import { discoverMikrotikRouters } from "../services/discovery";

const HostSchema = z
  .string({ required_error: "Host / IP address wajib diisi" })
  .min(1, "Host / IP address tidak boleh kosong")
  .max(255, "Host maksimal 255 karakter")
  .regex(/^[a-zA-Z0-9._-]+$/, "Host hanya boleh berisi huruf, angka, titik, strip, underscore");

const CreateSchema = z.object({
  label: z.string().min(1, "Nama router tidak boleh kosong").max(200, "Nama router maksimal 200 karakter"),
  host: HostSchema,
  port: z.coerce.number().int("Port harus bilangan bulat").min(1, "Port minimal 1").max(65535, "Port maksimal 65535").default(22),
  username: z.string().min(1, "Username SSH tidak boleh kosong").max(128),
  password: z.string().max(512).default(""),
});

const PatchSchema = z.object({
  label: z.string().min(1, "Nama router tidak boleh kosong").max(200).optional(),
  host: HostSchema.optional(),
  port: z.coerce.number().int("Port harus bilangan bulat").min(1).max(65535).optional(),
  username: z.string().min(1, "Username SSH tidak boleh kosong").max(128).optional(),
  password: z.string().max(512).optional(),
});

const ModeSchema = z.object({
  mode: RouterModeSchema,
  expectedVersion: z.coerce.number().int().min(1),
});

function validateJson<T extends z.ZodTypeAny>(schema: T) {
  return zValidator("json", schema, (result, c: Context<Env>) => {
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] ? String(issue.path[0]) : "general";
        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      return c.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: result.error.issues[0]?.message ?? "Validasi input form gagal.",
            requestId: c.get("requestId") ?? "unknown",
            fieldErrors,
          },
        },
        400,
      );
    }
  });
}

export function createConnectorRoutes(deps: {
  connectors: ConnectorService;
  supervisor: McpSupervisor;
  txCoordinator: TransactionCoordinator;
  safeModeSessions: { forget(userId: string, connectionId: string): void };
  logger: Logger;
  invalidateCatalog: () => void;
}) {
  const routes = new Hono<Env>();

  /**
   * Disconnect closes this connection's transactions; delete also closes this
   * user's transactions on other connectors for the same verified router.
   */
  async function cleanupTransactions(userId: string, connectionId: string, removing = false) {
    try {
      const active = await deps.txCoordinator.activeTransactionsForRouter(
        (await deps.connectors.requireOwned(userId, connectionId)()).routerIdentity ?? "",
      );
      for (const tx of active) {
        if (tx.lockOwner !== userId || (!removing && tx.connectionId !== connectionId)) continue;
        if (tx.state === "active" || tx.state === "verifying" || tx.state === "preparing") {
          const r = await deps.txCoordinator.forceRollback(tx.id, userId);
          deps.logger.info("transaction force-rolled back on disconnect", { transactionId: tx.id, state: r.state });
        }
      }
    } catch (err) {
      deps.logger.warn("transaction cleanup on disconnect failed", {
        connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      deps.safeModeSessions.forget(userId, connectionId);
    }
  }

  routes.get("/", async (c) => {
    const workspace = requireWorkspace(c);
    const list = await deps.connectors.list(workspace.userId);
    return c.json({ connectors: list });
  });

  /**
   * Auto-discovery of local MikroTik devices via MNDP (port 5678)
   */
  routes.get("/discover", async (c) => {
    const workspace = requireWorkspace(c);
    const existing = await deps.connectors.list(workspace.userId);
    const discovered = await discoverMikrotikRouters(1500);

    const mapped = discovered.map((dev) => {
      const match = existing.find(
        (e) => e.host === dev.ip || e.host === dev.ipv4
      );
      return {
        ...dev,
        alreadyAdded: !!match,
        connectorId: match?.id ?? null,
        connectorStatus: match?.status ?? null,
      };
    });

    return c.json({ discovered: mapped });
  });

  routes.post("/", validateJson(CreateSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const input = c.req.valid("json");
    const { connector, probe } = await deps.connectors.create(workspace.userId, input);
    return c.json({ connector, probe: { ok: probe.ok, routerIdentity: probe.routerIdentity } }, 201);
  });

  routes.patch("/:id", validateJson(PatchSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const input = c.req.valid("json");
    const { connector, probe } = await deps.connectors.update(workspace.userId, c.req.param("id"), input);
    return c.json({ connector, probe: { ok: probe.ok, routerIdentity: probe.routerIdentity } });
  });

  routes.post("/:id/connect", async (c) => {
    const workspace = requireWorkspace(c);
    const connector = await deps.connectors.connect(workspace.userId, c.req.param("id"));
    return c.json({ connector });
  });

  routes.post("/:id/disconnect", async (c) => {
    const workspace = requireWorkspace(c);
    // stop the supervised MCP process and revoke write; any live transaction
    // on this connection is force-rolled-back first (safe revert)
    await cleanupTransactions(workspace.userId, c.req.param("id"));
    await deps.supervisor.stop(workspace.userId, c.req.param("id"));
    const connector = await deps.connectors.disconnect(workspace.userId, c.req.param("id"));
    return c.json({ connector });
  });

  routes.patch("/:id/mode", validateJson(ModeSchema), async (c) => {
    const workspace = requireWorkspace(c);
    const { mode, expectedVersion } = c.req.valid("json");
    // Write OFF must first roll back any live transaction on this connection:
    // revoke mutations at the source, then flip the mode atomically.
    if (mode === "read-only") {
      try {
        const conn = await deps.connectors.requireOwned(workspace.userId, c.req.param("id"))();
        const active = await deps.txCoordinator.activeTransactionsForRouter(conn.routerIdentity ?? "");
        for (const tx of active) {
          if (tx.connectionId !== c.req.param("id")) continue;
          if (tx.state === "active" || tx.state === "verifying" || tx.state === "preparing") {
            const r = await deps.txCoordinator.forceRollback(tx.id, workspace.userId);
            deps.logger.info("transaction force-rolled back on Write OFF", { transactionId: tx.id, state: r.state });
          }
        }
        deps.safeModeSessions.forget(workspace.userId, c.req.param("id"));
      } catch (err) {
        deps.logger.warn("transaction cleanup on Write OFF failed", {
          connectionId: c.req.param("id"),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await deps.supervisor.stop(workspace.userId, c.req.param("id"));
    }
    // Enabling Write requires a connected, verified router; revoking it always remains allowed.
    const result = await deps.connectors.setMode(workspace.userId, c.req.param("id"), mode, expectedVersion);
    deps.invalidateCatalog();
    return c.json({ connector: result.connector, version: result.version });
  });

  routes.get("/:id/mode", async (c) => {
    const workspace = requireWorkspace(c);
    const result = await deps.connectors.getMode(workspace.userId, c.req.param("id"));
    return c.json(result);
  });

  /**
   * User-facing write readiness ( powers the "password masih kosong" banner).
   * Only booleans leave the server — the stored secret itself never does.
   */
  routes.get("/:id/write-readiness", async (c) => {
    const workspace = requireWorkspace(c);
    const id = c.req.param("id");
    const conn = await deps.connectors.requireOwned(workspace.userId, id)();
    const { mode, version } = await deps.connectors.getMode(workspace.userId, id);
    let credentialEmpty: boolean | null = null;
    try {
      credentialEmpty = (await deps.connectors.decryptCredential(workspace.userId, id)) === "";
    } catch {
      credentialEmpty = null;
    }
    const blocked =
      mode !== "write"
        ? "read-only"
        : conn.status !== "connected"
          ? "disconnected"
          : credentialEmpty === true
            ? "empty-credential"
            : credentialEmpty === null
              ? "credential-unreadable"
              : null;
    return c.json({
      connectorId: id,
      status: conn.status,
      mode,
      modeVersion: version,
      credentialEmpty,
      blocked,
    });
  });

  routes.delete("/:id", async (c) => {
    const workspace = requireWorkspace(c);
    await cleanupTransactions(workspace.userId, c.req.param("id"), true);
    await deps.supervisor.stop(workspace.userId, c.req.param("id"));
    await deps.connectors.remove(workspace.userId, c.req.param("id"));
    return c.json({ ok: true });
  });

  function requireWorkspace(c: { get: (k: "workspace") => unknown }): WorkspaceContext {
    const s = c.get("workspace");
    if (!s) throw new AppError("UNAUTHORIZED", "Session habis atau belum login. Silakan login kembali.", 401);
    return s as WorkspaceContext;
  }

  return routes;
}
