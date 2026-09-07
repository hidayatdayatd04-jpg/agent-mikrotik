import { expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { routerConnections, terminalCommands } from "../db/schema";
import { AppError } from "../lib/errors";
import { LOCAL_WORKSPACE_ID } from "../lib/workspace";
import { openTerminalSession, routerKeyFor, routerLockOwner, submitTerminalCommand, type TerminalDeps } from "./terminal";

async function harness(mode: "read-only" | "write") {
  const db = createDb(":memory:");
  const [connection] = await db.insert(routerConnections).values({
    userId: LOCAL_WORKSPACE_ID, label: "terminal guard test", host: "192.0.2.1", username: "test",
    status: "connected", routerIdentity: "test-router",
  }).returning();
  const decryptCredential = mock(async () => "test-password");
  const getMode = mock(async () => ({ mode, version: 1 }));
  const deps: TerminalDeps = { db, logger: { debug() {}, info() {}, warn() {}, error() {} }, decryptCredential, getMode };
  const session = await openTerminalSession(deps, { userId: LOCAL_WORKSPACE_ID, connectionId: connection!.id });
  const submit = (command: string) => submitTerminalCommand(deps, { userId: LOCAL_WORKSPACE_ID, sessionId: session.id, command });
  return { db, deps, decryptCredential, getMode, submit };
}

test.each(["read-only", "write"] as const)("terminal menolak aksi unknown sebelum akses SSH, mode %s", async (mode) => {
  const { db, decryptCredential, getMode, submit } = await harness(mode);
  for (const command of [
    "/ip dhcp-server lease make-static number=0",
    "/tool e-mail send to=test@example.com subject=hi body=hello",
    "/tool sniffer start",
    "/system identity print; /tool sniffer start",
  ]) {
    await expect(submit(command)).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 422 });
  }
  const rows = await db.select().from(terminalCommands);
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row.status).toBe("rejected");
    expect(row.errorCode).toBe("VALIDATION_FAILED");
    expect(row.transactionId).toBeNull();
  }
  expect(getMode).not.toHaveBeenCalled();
  expect(decryptCredential).not.toHaveBeenCalled();
});

test("terminal menolak mutasi dikenal saat Write OFF sebelum akses SSH", async () => {
  const { db, decryptCredential, submit } = await harness("read-only");
  await expect(submit("/ip firewall filter add chain=input action=accept")).rejects.toMatchObject({ code: "WRITE_DISABLED", status: 403 });
  const [row] = await db.select().from(terminalCommands);
  expect(row!.status).toBe("rejected");
  expect(row!.errorCode).toBe("WRITE_DISABLED");
  expect(decryptCredential).not.toHaveBeenCalled();
});

test.each([false, true])("terminal Write gagal sebelum SSH ketika Safe Mode tidak tersedia (coordinator=%s)", async (withCoordinator) => {
  const { db, deps, submit } = await harness("write");
  const begin = mock(async () => { throw new AppError("SAFE_MODE_UNAVAILABLE", "Safe Mode gagal (test)", 409); });
  if (withCoordinator) {
    deps.transactions = {
      begin, commit: mock(async () => ({ state: "committed" })),
      rollback: mock(async () => ({ state: "rolled_back" })), getActionCount: () => 0,
    };
  }
  const result = await submit("/ip firewall filter add chain=input action=accept");
  // The production service executes in the background; wait for persisted completion.
  const deadline = Date.now() + 1000;
  let row;
  do {
    [row] = await db.select().from(terminalCommands).where(eq(terminalCommands.id, result.commandId));
    if (row?.endedAt) break;
    await Bun.sleep(5);
  } while (Date.now() < deadline);
  expect(row!.status).toBe("failed");
  expect(row!.errorCode).toBe("SAFE_MODE_UNAVAILABLE");
  expect(row!.transactionId).toBeNull();
  expect(begin).toHaveBeenCalledTimes(withCoordinator ? 1 : 0);
  expect(routerLockOwner(routerKeyFor("192.0.2.1", 22, "test"))).toBeNull();
});
