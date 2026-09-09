import type { SafeModeSession, TransactionContext } from "./coordinator";
import type { McpChild } from "../mcp/supervisor";
import { AppError } from "../lib/errors";
import { openSession } from "./safe-session-open";
import { sessionKey, withTimeout, type SafeSessionState } from "./safe-session-types";

/**
 * Open + enable + PROVE the window is live, self-healing once.
 *
 * Why: upstream tracks Safe Mode with an in-memory flag, so `enable`
 * can report success on a stale/dead shell ("already active") while every
 * later command wedges. The probe (a read routed through the safe shell)
 * is the only real proof. On probe failure the child is stopped — the
 * stale flag dies with it — and a fresh child gets exactly one retry.
 * Read-only probe: never mutates, so a failed attempt leaves nothing staged.
 */
export async function openVerifiedSession(state: SafeSessionState, ctx: TransactionContext): Promise<SafeModeSession> {
  const { deps, children, probeTimeoutMs } = state;
  const k = sessionKey(ctx.userId, ctx.connectionId);
  const probeLive = async (child: McpChild): Promise<void> => {
    const raw = (await withTimeout(
      child.client.callTool({ name: "get_system_identity", arguments: {} }),
      probeTimeoutMs,
      "probe sesi Safe Mode",
    )) as { content?: { type: string; text?: string }[]; isError?: boolean };
    if (raw.isError) throw new Error("probe sesi Safe Mode mengembalikan error");
    const text = (raw.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
    if (!text.trim()) throw new Error("probe sesi Safe Mode kosong");
  };
  const recycleChild = async (why: string) => {
    deps.logger.warn("recycling wedged safe-mode child", { userId: ctx.userId, connectionId: ctx.connectionId, why });
    children.delete(k);
    try {
      await deps.supervisor.stop(ctx.userId, ctx.connectionId);
    } catch {
      /* stop is best-effort; a fresh spawn replaces it anyway */
    }
  };
  const attempt = async (): Promise<SafeModeSession> => {
    const session = await openSession(state, ctx);
    const child = children.get(k);
    if (!child) throw new Error("child Safe Mode tidak tersedia setelah openSession");
    await session.enable();
    await probeLive(child);
    return session;
  };
  try {
    return await attempt();
  } catch (firstErr) {
    await recycleChild(firstErr instanceof Error ? firstErr.message : String(firstErr));
    try {
      const session = await openSession(state, ctx);
      const child = children.get(k);
      if (!child) throw new Error("child Safe Mode tidak tersedia setelah recycle");
      await session.enable();
      await probeLive(child);
      return session;
    } catch (secondErr) {
      await recycleChild(secondErr instanceof Error ? secondErr.message : String(secondErr));
      throw new AppError(
        "SAFE_MODE_UNAVAILABLE",
        `Sesi Safe Mode tidak dapat dipakai (${secondErr instanceof Error ? secondErr.message : String(secondErr)}). Child sudah di-restart; coba lagi. Bila berulang, restart sesi MCP atau reboot router.`,
        409,
      );
    }
  }
}

/**
 * Pre-commit management-plane probe: execute a read tool on the SAME child
 * that holds the safe-mode window. A successful SSH command alone does not
 * prove the management plane is healthy — this checks the router still
 * answers identity reads through the transaction's own connection.
 */
export async function verifyManagement(state: SafeSessionState, ctx: TransactionContext): Promise<{ ok: boolean; detail: string }> {
  const { deps, children } = state;
  try {
    const conn = await deps.getConnection(ctx.userId, ctx.connectionId);
    const child = await deps.supervisor.getOrSpawn({
      connectionId: ctx.connectionId,
      userId: ctx.userId,
      host: conn.spec.host,
      port: conn.spec.port,
      username: conn.spec.username,
      password: conn.spec.password,
      hostKeyFingerprint: conn.spec.hostKeyFingerprint,
      readOnly: false,
    });
    children.set(sessionKey(ctx.userId, ctx.connectionId), child);
    const raw = (await child.client.callTool({ name: "get_system_identity", arguments: {} })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    if (raw.isError) return { ok: false, detail: "probe identitas router mengembalikan error" };
    const text = (raw.content ?? []).map((c) => (c.type === "text" ? c.text ?? "" : "")).join("\n");
    if (!text.trim()) return { ok: false, detail: "probe identitas router kosong" };
    return { ok: true, detail: "manajemen router menjawab pembacaan identitas" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
