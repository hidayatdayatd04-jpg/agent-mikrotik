import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { ConnectorsPanel } from "./features/connectors/ConnectorsPanel";
import { useAuthState } from "./features/auth/AuthGate";
import { useLogout } from "./features/auth/auth-hooks";

function LogoutButton() {
  const logout = useLogout();
  return (
    <Button variant="outline" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
      Keluar
    </Button>
  );
}

export function App() {
  const { user } = useAuthState();
  const [live, setLive] = useState<"checking" | "ok" | "down">("checking");

  useEffect(() => {
    fetch("/api/health/ready")
      .then((r) => setLive(r.ok ? "ok" : "down"))
      .catch(() => setLive("down"));
  }, []);

  return (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">MikroTik AI Agent</h1>
            <span className={`text-xs ${live === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
              {live === "ok" ? "API siap" : live === "checking" ? "…" : "API tidak terjangkau"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground hidden text-sm sm:inline">{user?.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <ConnectorsPanel />
      </main>
      <Toaster position="top-center" richColors />
    </div>
  );
}
