import { join } from "node:path";
import { createDb, recoverLocalState } from "../index";
import { conversations, routerConnections, connectionPermissions, changeTransactions } from "../schema";
import { LOCAL_WORKSPACE_ID } from "../../lib/workspace";
import { ensureLocalKey } from "../../lib/local-files";
import { envKeyRing } from "../../lib/crypto";
import { createProviderSettingsService } from "../../agent/provider-settings";
import { createLogger } from "../../lib/logger";

const folder = process.argv[2]!;
const db = createDb(join(folder, "agent.sqlite"));
const userId = LOCAL_WORKSPACE_ID;
const provider = createProviderSettingsService({
  db, keyRing: envKeyRing({ 1: ensureLocalKey(folder) }, 1), logger: createLogger("error"),
});
try {
  if (process.argv[3] === "seed") {
    await provider.save(userId, { kind: "custom", baseUrl: "http://localhost:4999/v1", model: "test", apiKey: "restart-test-key" });
    await db.insert(conversations).values({ userId, title: "Persisted" });
    const [router] = await db.insert(routerConnections).values({ userId, host: "192.168.88.1", username: "admin", label: "Lab", status: "connected" }).returning();
    await db.insert(connectionPermissions).values({ userId, connectionId: router!.id, writeEnabled: true });
    await db.insert(changeTransactions).values({ connectionId: router!.id, state: "active" });
  } else {
    recoverLocalState(db);
    console.log(JSON.stringify({
      providerKeyMatches: (await provider.getWithKey(userId))!.apiKey === "restart-test-key",
      title: (await db.select().from(conversations))[0]!.title,
      routerStatus: (await db.select().from(routerConnections))[0]!.status,
      writeEnabled: (await db.select().from(connectionPermissions))[0]!.writeEnabled,
      transactionState: (await db.select().from(changeTransactions))[0]!.state,
      foreignKeyErrors: db.$client.query("PRAGMA foreign_key_check").all(),
    }));
  }
} finally { db.$client.close(); }
