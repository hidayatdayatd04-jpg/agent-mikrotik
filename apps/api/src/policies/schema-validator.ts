import { z } from "zod";
import type { SchemaValidator } from "./dispatcher";

/**
 * Validates tool args against a JSON schema. Custom tools carry Zod schemas;
 * upstream tools carry JSON Schema. Zod handles both: .parse for Zod objects,
 * loose pass-through with required-field checks for plain JSON Schema.
 */
export class ZodSchemaValidator implements SchemaValidator {
  validate(schema: unknown, input: unknown): { ok: boolean; message?: string } {
    if (schema instanceof z.ZodType) {
      const result = schema.safeParse(input);
      if (!result.success) {
        const first = result.error.issues[0];
        return { ok: false, message: first ? `${first.path.join(".")}: ${first.message}` : "input tidak valid" };
      }
      return { ok: true };
    }
    // JSON Schema (upstream): enforce required fields only — full JSON Schema
    // validation happens inside the upstream tool itself before execution.
    if (schema && typeof schema === "object") {
      const required = (schema as { required?: unknown }).required;
      if (Array.isArray(required) && input && typeof input === "object" && !Array.isArray(input)) {
        for (const r of required) {
          if (typeof r === "string" && !(r in (input as Record<string, unknown>))) {
            return { ok: false, message: `argumen "${r}" wajib diisi` };
          }
        }
      }
    }
    return { ok: true };
  }
}
