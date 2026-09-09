import { SettingsPage } from "@/features/chat/SettingsPage";

export function ProvidersSection() {
  // Reuse existing provider settings UI (business component) inside settings shell.
  return <SettingsPage initialTab="provider" />;
}
