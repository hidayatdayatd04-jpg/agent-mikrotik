import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./features/auth/auth";
import { LoginPage } from "./features/auth/LoginPage";
import { useRoute, navigate } from "./lib/router";
import { useSidebarCollapsed } from "./app/app-hooks";
import { MobileTopBar } from "./app/MobileTopBar";
import { DesktopSidebar } from "./app/DesktopSidebar";
import { SettingsRoute } from "./app/SettingsRoute";
import { MainRoutes } from "./app/MainRoutes";

function Shell() {
  const route = useRoute();
  const { profile, loading, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { collapsed, setCollapsedPersist } = useSidebarCollapsed();

  // Auth gating
  useEffect(() => {
    if (!loading && !profile && route.name !== "login") {
      navigate({ name: "login" }, { replace: true });
    }
    if (!loading && profile && route.name === "login") {
      navigate({ name: "chat-new" }, { replace: true });
    }
  }, [loading, profile, route.name]);

  if (route.name === "login") {
    if (loading) return <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">Memuat…</div>;
    if (profile) return null;
    return <LoginPage />;
  }
  if (loading) return <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">Memuat session…</div>;
  if (!profile) return null;

  if (route.name === "settings") {
    return <SettingsRoute section={route.section} />;
  }

  const conversationId = route.name === "chat" ? route.id : null;
  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground md:flex-row">
      {/* Mobile top bar */}
      <MobileTopBar
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        search={search}
        setSearch={setSearch}
        conversationId={conversationId}
        profileName={profile.displayName}
        profileUsername={profile.username}
        onLogout={() => void logout()}
      />

      {/* Desktop sidebar */}
      <DesktopSidebar
        collapsed={collapsed}
        onCollapse={() => setCollapsedPersist(true)}
        onExpand={() => setCollapsedPersist(false)}
        onExpandAndFocusSearch={() => {
          setCollapsedPersist(false);
          setTimeout(() => document.getElementById("sidebar-search")?.focus(), 60);
        }}
        search={search}
        setSearch={setSearch}
        conversationId={conversationId}
        profileName={profile.displayName}
        profileUsername={profile.username}
        onLogout={() => void logout()}
      />

      <MainRoutes conversationId={conversationId} onToggleSidebar={() => setCollapsedPersist(!collapsed)} />
      <Toaster position="top-center" richColors />
    </div>
  );
}

export function App() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate({ name: "chat-new" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
