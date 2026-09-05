import { useEffect, useState } from "react";
import { useMe, useLogout } from "./auth-hooks";
import type { SessionUser } from "@shared/index";

export function useAuthState() {
  const me = useMe();
  return { user: me.data?.user ?? null, isLoading: me.isLoading };
}

export function LoginGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthState();
  const [booted, setBooted] = useState(false);
  useEffect(() => setBooted(true), []);

  if (isLoading && !booted) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-muted-foreground">Memuat…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthRequired />
    );
  }

  return <>{children}</>;
}

function AuthRequired() {
  const { Login } = useLazyLogin();
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">MikroTik AI Agent</h1>
        <p className="text-muted-foreground text-sm">Masuk untuk melanjutkan.</p>
      </div>
      <Login />
    </div>
  );
}

function useLazyLogin() {
  const [mod, setMod] = useState<{ Login: React.ComponentType } | null>(null);
  useEffect(() => {
    let alive = true;
    import("./LoginForm").then((m) => {
      if (alive) setMod({ Login: m.LoginForm });
    });
    return () => {
      alive = false;
    };
  }, []);
  return mod ?? { Login: () => <div className="text-muted-foreground text-sm">Memuat form…</div> };
}
