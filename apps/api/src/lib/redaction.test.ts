import { describe, expect, test } from "bun:test";
import { redactText, redactObject, redactUrl } from "./redaction";

describe("redactText", () => {
  test("redacts key=value and key: value forms", () => {
    expect(redactText("password=hunter2 note")).toContain("[REDACTED]");
    expect(redactText("the secret: abc123 end")).toContain("[REDACTED]");
    expect(redactText("password=hunter2")).not.toContain("hunter2");
  });
  test("leaves benign text intact", () => {
    expect(redactText("/ip address print")).toBe("/ip address print");
  });
});

describe("redactObject", () => {
  test("redacts sensitive keys at any depth", () => {
    const input = {
      host: "192.168.1.1",
      username: "admin",
      password: "hunter2",
      nested: { api_key: "xyz", ok: 1 },
      list: [{ token: "t", name: "n" }],
    };
    const out = redactObject(input);
    expect(out).toEqual({
      host: "192.168.1.1",
      username: "admin",
      password: "[REDACTED]",
      nested: { api_key: "[REDACTED]", ok: 1 },
      list: [{ token: "[REDACTED]", name: "n" }],
    });
  });
});

describe("redactUrl", () => {
  test("redacts signed query params and userinfo passwords", () => {
    const out = redactUrl("https://e.example/bucket/obj?X-Amz-Signature=abc&X-Amz-Credential=k");
    expect(out).not.toContain("abc");
    expect(out).not.toContain("k=");
    const out2 = redactUrl("https://user:pass@host/path");
    expect(out2).not.toContain("pass");
  });
});
