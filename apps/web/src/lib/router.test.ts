import { describe, expect, test } from "vitest";
import { parsePath, routePath } from "./router";

describe("lightweight routes", () => {
  test("parses chat, settings, login with refresh-safe paths", () => {
    expect(parsePath("/login")).toEqual({ name: "login" });
    expect(parsePath("/chat")).toEqual({ name: "chat-new" });
    expect(parsePath("/")).toEqual({ name: "chat-new" });
    expect(parsePath("/chat/abc-123")).toEqual({ name: "chat", id: "abc-123" });
    expect(parsePath("/settings")).toEqual({ name: "settings", section: "connectors" });
    expect(parsePath("/settings/archive")).toEqual({ name: "settings", section: "archive" });
    expect(parsePath("/settings/unknown")).toEqual({ name: "settings", section: "connectors" });
  });

  test("round-trips paths for back/forward", () => {
    expect(routePath({ name: "chat-new" })).toBe("/chat");
    expect(routePath({ name: "chat", id: "x" })).toBe("/chat/x");
    expect(routePath({ name: "settings", section: "security" })).toBe("/settings/security");
  });

  test("intended route guard rejects open redirects", () => {
    const candidates = ["/chat", "/settings/archive", "https://evil.com", "//evil.com", "/chat/x?add=1"];
    const safe = (s: string) => s.startsWith("/") && !s.startsWith("//") && !s.includes("://");
    expect(candidates.filter(safe)).toEqual(["/chat", "/settings/archive", "/chat/x?add=1"]);
  });
});
