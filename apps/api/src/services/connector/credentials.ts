import { openSecret, type SealedSecret } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import type { routerConnections } from "../../db/schema";
import { requireOwned } from "./ownership";
import type { ConnectorCtx } from "./types";

export function openExisting(ctx: ConnectorCtx, userId: string, row: typeof routerConnections.$inferSelect): string {
  if (row.passwordCiphertext === null || !row.passwordNonce || !row.passwordAuthTag) {
    throw new AppError("INTERNAL_ERROR", "Kredensial tersimpan tidak lengkap.", 500);
  }
  const sealed: SealedSecret = {
    ciphertext: row.passwordCiphertext,
    nonce: row.passwordNonce,
    authTag: row.passwordAuthTag,
    keyVersion: row.keyVersion,
  };
  const pw = openSecret(ctx.keyRing, sealed, userId, row.id);
  if (pw === null) throw new AppError("INTERNAL_ERROR", "Dekripsi kredensial gagal (key rotated?).", 500);
  return pw;
}

export async function decryptCredential(ctx: ConnectorCtx, userId: string, connectionId: string): Promise<string> {
  const row = await requireOwned(ctx, userId, connectionId)();
  return openExisting(ctx, userId, row);
}
