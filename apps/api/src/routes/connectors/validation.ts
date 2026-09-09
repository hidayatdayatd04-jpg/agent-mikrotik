import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import type { Env } from "../../types";
import { RouterModeSchema } from "@shared/index";

export const HostSchema = z
  .string({ required_error: "Host / IP address wajib diisi" })
  .min(1, "Host / IP address tidak boleh kosong")
  .max(255, "Host maksimal 255 karakter")
  .regex(/^[a-zA-Z0-9._-]+$/, "Host hanya boleh berisi huruf, angka, titik, strip, underscore");

export const CreateSchema = z.object({
  label: z.string().min(1, "Nama router tidak boleh kosong").max(200, "Nama router maksimal 200 karakter"),
  host: HostSchema,
  port: z.coerce.number().int("Port harus bilangan bulat").min(1, "Port minimal 1").max(65535, "Port maksimal 65535").default(22),
  username: z.string().min(1, "Username SSH tidak boleh kosong").max(128),
  password: z.string().max(512).default(""),
});

export const PatchSchema = z.object({
  label: z.string().min(1, "Nama router tidak boleh kosong").max(200).optional(),
  host: HostSchema.optional(),
  port: z.coerce.number().int("Port harus bilangan bulat").min(1).max(65535).optional(),
  username: z.string().min(1, "Username SSH tidak boleh kosong").max(128).optional(),
  password: z.string().max(512).optional(),
});

export const ModeSchema = z.object({
  mode: RouterModeSchema,
  expectedVersion: z.coerce.number().int().min(1),
});

export function validateJson<T extends z.ZodTypeAny>(schema: T) {
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
