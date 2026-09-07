import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api";
import { navigate } from "@/lib/router";

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  loginAlias: string | null;
}

interface AuthState {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

async function fetchMe(): Promise<Profile> {
  const res = await apiFetch<{ profile: Profile }>("/api/auth/me");
  return res.profile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const p = await fetchMe();
      setProfile(p);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setProfile(null);
      } else {
        setError(err instanceof Error ? err.message : "Gagal memuat session.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Global 401 -> force login (except when already on /login).
  useEffect(() => {
    const onUnauthorized = () => {
      setProfile(null);
      // Preserve non-secret draft for restore after login.
      try {
        const draft = sessionStorage.getItem("composer-draft") ?? localStorage.getItem("composer-draft") ?? "";
        if (draft) sessionStorage.setItem("pending-draft", draft);
      } catch {
        /* ignore */
      }
      if (window.location.pathname !== "/login") {
        const next = encodeURIComponent(window.location.pathname);
        navigate({ name: "login" });
        sessionStorage.setItem("intended-route", decodeURIComponent(next));
      }
      qc.clear();
    };
    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, [qc]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      await apiFetch<{ profile: Profile }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      });
      const p = await fetchMe();
      setProfile(p);
      setError(null);
      qc.clear();
      const intended = sessionStorage.getItem("intended-route");
      sessionStorage.removeItem("intended-route");
      const target = intended && intended.startsWith("/") && !intended.startsWith("//") && !intended.includes("://") ? intended : "/chat";
      window.history.replaceState(null, "", target);
      window.dispatchEvent(new PopStateEvent("popstate"));
      // Restore draft.
      try {
        const pending = sessionStorage.getItem("pending-draft");
        if (pending) {
          localStorage.setItem("composer-draft", pending);
          sessionStorage.removeItem("pending-draft");
        }
      } catch {
        /* ignore */
      }
    },
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setProfile(null);
    qc.clear();
    // Clear account-bound caches from the screen.
    try {
      localStorage.removeItem("composer-draft");
      sessionStorage.removeItem("pending-draft");
    } catch {
      /* ignore */
    }
    navigate({ name: "login" }, { replace: true });
  }, [qc]);

  return <AuthCtx.Provider value={{ profile, loading, error, login, logout, refresh }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useProfile() {
  return useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });
}
