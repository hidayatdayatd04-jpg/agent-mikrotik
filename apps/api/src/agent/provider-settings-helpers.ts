import { AppError } from "../lib/errors";
import type { AiProviderPublicDTO, ProviderKind, SaveProviderInput } from "./provider-settings-types";

export function defaultBaseUrl(kind: ProviderKind): string {
  switch (kind) {
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/openai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "custom":
      return "";
  }
}

export function defaultProviderName(kind: ProviderKind): string {
  switch (kind) {
    case "gemini":
      return "Google Gemini";
    case "openrouter":
      return "OpenRouter";
    case "custom":
      return "Custom Endpoint";
  }
}

export function assertUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("protocol");
    }
  } catch {
    throw new AppError("VALIDATION_FAILED", "Base URL provider tidak valid (harus http/https absolut).", 422);
  }
}

export function assertModelName(model: string): void {
  if (!/^[A-Za-z0-9._:\/-]{1,255}$/.test(model)) {
    throw new AppError("VALIDATION_FAILED", `Nama model '${model}' tidak valid (hanya huruf, angka, titik, garis, titik dua, garis miring).`, 422);
  }
}

/** Parse kolom models DB (array JSON atau string JSON) + fallback activeModel. */
export function parseModelsList(models: unknown, activeModel: string): string[] {
  let modelsList: string[] = [];
  try {
    if (Array.isArray(models)) {
      modelsList = models as string[];
    } else if (typeof models === "string") {
      modelsList = JSON.parse(models);
    }
  } catch {
    modelsList = [];
  }
  if (modelsList.length === 0 && activeModel) {
    modelsList = [activeModel];
  }
  return modelsList;
}

type ProviderRow = {
  id: string;
  kind: string;
  name: string;
  baseUrl: string;
  models: unknown;
  activeModel: string;
  enabled: unknown;
  apiKeyCiphertext: unknown;
  updatedAt: Date;
  modelLimits: unknown;
};

/** Petakan baris DB → DTO publik (tanpa plaintext key). */
export function toPublicDTO(r: ProviderRow): AiProviderPublicDTO {
  return {
    id: r.id,
    kind: r.kind as AiProviderPublicDTO["kind"],
    name: r.name,
    baseUrl: r.baseUrl,
    models: parseModelsList(r.models, r.activeModel),
    activeModel: r.activeModel,
    enabled: Boolean(r.enabled),
    hasKey: Boolean(r.apiKeyCiphertext),
    updatedAt: r.updatedAt.toISOString(),
    modelLimits: (r.modelLimits ?? {}) as AiProviderPublicDTO["modelLimits"],
  };
}

/** Siapkan daftar models + activeModel dari input save (validasi nama). */
export function buildSaveModels(input: SaveProviderInput): { models: string[]; activeModel: string } {
  let models = input.models?.map((m) => m.trim()).filter(Boolean) ?? [];
  if (models.length === 0) {
    const fallback = input.activeModel?.trim() || input.model?.trim() || "";
    if (fallback) models = [fallback];
  }
  if (models.length === 0) {
    throw new AppError("VALIDATION_FAILED", "Minimal sertakan satu model untuk provider ini.", 422);
  }
  for (const m of models) {
    assertModelName(m);
  }

  const activeModel = input.activeModel?.trim() || input.model?.trim() || models[0]!;
  assertModelName(activeModel);
  if (!models.includes(activeModel)) {
    models.unshift(activeModel);
  }
  return { models, activeModel };
}
