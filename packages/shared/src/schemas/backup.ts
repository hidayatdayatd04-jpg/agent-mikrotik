import { z } from "zod";

// ── Backup Types ──────────────────────────────────────────────

export const ConfigBackupDTOSchema = z.object({
  id: z.string().uuid(),
  connectionId: z.string().uuid(),
  name: z.string(),
  type: z.enum(["export_text", "binary_backup"]),
  routerIdentity: z.string().nullable(),
  rosVersion: z.string().nullable(),
  boardName: z.string().nullable(),
  sizeBytes: z.number().int(),
  status: z.enum(["completed", "failed", "in_progress"]),
  createdBy: z.enum(["user", "system", "agent"]),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ConfigBackupDTO = z.infer<typeof ConfigBackupDTOSchema>;

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  lineNumber: { left: number | null; right: number | null };
  content: string;
}

export interface DiffResult {
  added: number;
  removed: number;
  changed: number;
  lines: DiffLine[];
}
