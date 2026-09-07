import { describe, expect, test } from "vitest";
import { extractAskBlocks, isOptionRecommended, stripAskBlocks } from "./ask-card";

const VALID = [
  "```ask",
  '{"questions":[{"id":"q1","text":"Blokir HTTPS saja atau termasuk HTTP?","options":[{"id":"a","label":"HTTPS saja","recommended":true},{"id":"b","label":"Semua"}]}]}',
  "```",
].join("\n");

describe("ask-card wire format", () => {
  test("valid block parses to a spec with recommended flags", () => {
    const specs = extractAskBlocks(`Halo\n\n${VALID}\n\nSilakan jawab manual juga bisa.`);
    expect(specs?.length).toBe(1);
    const opts = specs?.[0]?.questions[0]?.options;
    expect(opts?.map((o) => o.label)).toEqual(["HTTPS saja", "Semua"]);
    expect(opts?.[0]?.recommended).toBe(true);
    expect(opts?.[1]?.recommended).toBeUndefined();
  });

  test("no fence returns null", () => {
    expect(extractAskBlocks("1. Apakah router sudah terhubung?\n2. Mau blokir apa?")).toBe(null);
  });

  test("invalid JSON is ignored, not a spec", () => {
    expect(extractAskBlocks("```ask\n{not json\n```")).toBe(null);
  });

  test("schema violations rejected (too many questions, one option, invalid recommended type)", () => {
    const tooMany = `{"questions":[${Array.from({ length: 4 }, (_, i) => `{"id":"q${i}","text":"t","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}`).join(",")}]}`;
    expect(extractAskBlocks(`\`\`\`ask\n${tooMany}\n\`\`\``)).toBe(null);

    const oneOption = '{"questions":[{"id":"q1","text":"t","options":[{"id":"a","label":"A"}]}]}';
    expect(extractAskBlocks(`\`\`\`ask\n${oneOption}\n\`\`\``)).toBe(null);

    // invalid recommended type (string instead of boolean) should be rejected
    const invalidRecType = '{"questions":[{"id":"q1","text":"t","options":[{"id":"a","label":"A","recommended":"yes"},{"id":"b","label":"B"}]}]}';
    expect(extractAskBlocks(`\`\`\`ask\n${invalidRecType}\n\`\`\``)).toBe(null);
  });

  test("strip removes valid fences but keeps prose", () => {
    const stripped = stripAskBlocks(`Halo\n\n${VALID}\n\nTerima kasih.`);
    expect(stripped).not.toContain("```ask");
    expect(stripped).toContain("Halo");
    expect(stripped).toContain("Terima kasih.");
  });

  test("strip keeps inner text when JSON is invalid", () => {
    const stripped = stripAskBlocks("Awal\n```ask\nmaaf {rusak}\n```\nAkhir");
    expect(stripped).not.toContain("```ask");
    expect(stripped).toContain("maaf {rusak}");
  });

  test("isOptionRecommended detects recommended: true or recommendation in label", () => {
    expect(isOptionRecommended({ id: "1", label: "Opsi A", recommended: true })).toBe(true);
    expect(isOptionRecommended({ id: "2", label: "Opsi B (rekomendasi)" })).toBe(true);
    expect(isOptionRecommended({ id: "3", label: "Opsi C (recommended)" })).toBe(true);
    expect(isOptionRecommended({ id: "4", label: "Opsi D rekomendasi" })).toBe(true);
    expect(isOptionRecommended({ id: "5", label: "Opsi E", recommended: false })).toBe(false);
    expect(isOptionRecommended({ id: "6", label: "Opsi F" })).toBe(false);
  });
});
