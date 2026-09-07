import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "./auth";

export function LoginPage() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center overflow-hidden rounded-xl bg-card ring-1 ring-cyan-500/40">
            <img src="/logo.png" alt="MikroTik AI" className="size-full object-contain p-0.5" />
          </div>
          <div>
            <h1 className="text-base font-bold">MikroTik AI Agent</h1>
            <p className="text-xs text-muted-foreground">Masuk untuk mengelola router lokal.</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="login-id" className="text-xs font-medium">
              Username atau email
            </label>
            <Input
              id="login-id"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="mikrotik-agent"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="login-pw" className="text-xs font-medium">
              Password
            </label>
            <div className="relative">
              <Input
                id="login-pw"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={busy}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                aria-label={show ? "Sembunyikan password" : "Tampilkan password"}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full gap-2" disabled={busy || !identifier.trim() || !password}>
          <LogIn className="size-4" />
          {busy ? "Memeriksa…" : "Masuk"}
        </Button>
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Akun lokal di perangkat ini. Kredensial default tidak ditampilkan di sini.
        </p>
      </form>
    </div>
  );
}
