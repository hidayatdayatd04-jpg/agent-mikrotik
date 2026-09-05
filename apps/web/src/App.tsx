import { useEffect, useState } from "react";
import { apiFetch } from "./lib/api";

export function App() {
  const [live, setLive] = useState<"checking" | "ok" | "down">("checking");

  useEffect(() => {
    apiFetch<{ status: string }>("/api/ping")
      .then(() => setLive("ok"))
      .catch(() => setLive("down"));
  }, []);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">MikroTik AI Agent</h1>
      <p className="text-muted-foreground">Fondasi M1 — server dan UI berjalan.</p>
      <p className="text-sm">
        API:{" "}
        {live === "checking" && <span className="text-muted-foreground">memeriksa…</span>}
        {live === "ok" && <span className="text-emerald-600 dark:text-emerald-400">terhubung</span>}
        {live === "down" && <span className="text-destructive">tidak terjangkau</span>}
      </p>
    </div>
  );
}
