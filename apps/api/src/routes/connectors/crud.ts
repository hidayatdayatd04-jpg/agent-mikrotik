import type { Hono } from "hono";
import type { Env } from "../../types";
import type { ConnectorService } from "../../services/connector";
import type { Logger } from "../../lib/logger";
import { requireWorkspace } from "../../middleware/session";
import { discoverMikrotikRouters } from "../../services/discovery";
import { CreateSchema, PatchSchema, validateJson } from "./validation";

export interface ConnectorRouteDeps {
  connectors: ConnectorService;
  logger: Logger;
}

/** CRUD + discovery + mode baca + write-readiness. */
export function registerConnectorCrud(routes: Hono<Env>, deps: ConnectorRouteDeps) {
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
}
