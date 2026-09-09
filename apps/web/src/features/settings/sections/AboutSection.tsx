import { useQuery } from "@tanstack/react-query";
import { SettingsPage } from "@/features/chat/SettingsPage";
import { apiFetch } from "@/lib/api";

export function AboutSection() {
  const diag = useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<{ status: string; checks: { database: string } }>("/health/ready"),
    retry: 1,
  });
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6">
      <h2 className="text-base font-semibold">Tentang dan diagnostik</h2>
      <p className="text-xs text-muted-foreground">MikroTik AI Agent v0.1.0 — Bun + Hono + SQLite/Drizzle, child MCP MikroTik, transaksi RouterOS Safe Mode.</p>
      <p className="font-mono text-xs">
        DB: {diag.data?.checks.database ?? "…"} · status {diag.data?.status ?? "…"}
      </p>
      <SettingsPage initialTab="about" hideHeader />
    </div>
  );
}
