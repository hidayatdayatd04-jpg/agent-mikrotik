import type { AiProviderDTO } from "./chat-hooks";

export interface ProviderSelection { providerId: string; model: string }
export const SELECTION_KEY = "selected_ai_provider_model";
export function readProviderSelection(): ProviderSelection | null {
  try {
    const value = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "null");
    return typeof value?.providerId === "string" && typeof value?.model === "string" ? value : null;
  } catch { return null; }
}
export function resolveProviderSelection(providers: AiProviderDTO[], selected: ProviderSelection | null): ProviderSelection | null {
  const enabled = providers.filter((p) => p.enabled);
  if (selected && enabled.some((p) => p.id === selected.providerId && p.models.includes(selected.model))) return selected;
  const first = enabled.find((p) => p.models.length > 0);
  return first ? { providerId: first.id, model: first.activeModel || first.models[0]! } : null;
}
