import { useEffect, useState } from "react";
import {
  normalizeReasoningEffort,
  supportsReasoning,
  type ReasoningEffort,
} from "@shared/index";

const STORAGE_KEY = "composer-reasoning-effort";
/** Kunci localStorage pilihan reasoning — dipakai ulang oleh retry pesan. */
export const REASONING_STORAGE_KEY = STORAGE_KEY;

/**
 * Pilihan reasoning_effort per composer. Tersimpan di localStorage dan
 * hanya berlaku bila model aktif mendukung reasoning (lihat
 * supportsReasoning) — bila model diganti ke yang tak mendukung,
 * nilai tersimpan dipertahankan tapi tidak dikirim.
 */
export function useComposerReasoning(effectiveModel: string) {
  const [effort, setEffortState] = useState<ReasoningEffort | null>(() => {
    try {
      return normalizeReasoningEffort(localStorage.getItem(STORAGE_KEY)) ?? null;
    } catch {
      return null;
    }
  });

  const supported = supportsReasoning(effectiveModel);

  // Bila model tak mendukung reasoning, jangan kirim apapun (UI disembunyikan).
  const activeEffort: ReasoningEffort | undefined = supported ? (effort ?? undefined) : undefined;

  function setEffort(next: ReasoningEffort | null) {
    setEffortState(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  // Bersihkan nilai basi bila suatu saat tersimpan nilai tak valid.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null && normalizeReasoningEffort(raw) === undefined) localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { effort: activeEffort, storedEffort: effort, setEffort, supported };
}

export type ComposerReasoning = ReturnType<typeof useComposerReasoning>;
