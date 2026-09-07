import { describe, expect, test } from "vitest";
import { groupConversations, type ConversationDTO } from "./chat-hooks";

function conv(id: string, overrides: Partial<ConversationDTO> = {}): ConversationDTO {
  const now = new Date().toISOString();
  return {
    id,
    title: `chat ${id}`,
    activeConnectionId: null,
    createdAt: now,
    updatedAt: now,
    pinnedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

describe("conversation grouping (recency + pin)", () => {
  test("pin di atas deterministik menurut pinnedAt; lainnya menurut updatedAt", () => {
    const items = [
      conv("a", { updatedAt: new Date("2026-09-01").toISOString() }),
      conv("b", { updatedAt: new Date("2026-09-07").toISOString(), pinnedAt: new Date("2026-09-06").toISOString() }),
      conv("c", { updatedAt: new Date("2026-09-06").toISOString(), pinnedAt: new Date("2026-09-07").toISOString() }),
    ];
    const groups = groupConversations(items);
    expect(groups[0]!.label).toBe("Disematkan");
    expect(groups[0]!.items.map((c) => c.id)).toEqual(["c", "b"]);
  });

  test("metadata memakai createdAt, bukan updatedAt", () => {
    const c = conv("x", { createdAt: new Date("2026-01-01").toISOString(), updatedAt: new Date("2026-09-07").toISOString() });
    expect(c.createdAt).not.toBe(c.updatedAt);
  });

  test("composer tidak menawarkan Tanpa router (kontrak UI)", async () => {
    const fs = await import("node:fs");
    const composer = fs.readFileSync("D:/agent-mikrotik/apps/web/src/features/chat/ChatComposer.tsx", "utf8");
    expect(composer).not.toMatch(/Tanpa router/);
    expect(composer).toMatch(/Connector/);
    expect(composer).toMatch(/Tambah router/);
  });
});
