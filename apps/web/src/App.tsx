import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Plus,
  MessageSquare,
  Menu,
  Search,
  Moon,
  Sun,
  PanelLeftClose,
  MoreHorizontal,
  Pin,
  PinOff,
  Archive,
  Pencil,
  Trash2,
  Download,
  Check,
  X,
  User,
  Settings,
  LogOut,
  Network,
  BarChart3,
  Bell,
} from "@/components/icons";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AuthProvider, useAuth } from "./features/auth/auth";
import { LoginPage } from "./features/auth/LoginPage";
import { useRoute, navigate } from "./lib/router";
import {
  useConversations,
  useCreateConversation,
  useConversation,
  useUpdateConversation,
  useDeleteConversation,
  groupConversations,
  usePreferences,
  useSavePreferences,
  type ConversationDTO,
} from "./features/chat/chat-hooks";
import { useConnectors } from "./features/connectors/connector-hooks";
import { ChatScreen } from "./features/chat/ChatScreen";
import { SettingsShell } from "./features/settings/SettingsShell";
import { ChatComposer } from "./features/chat/ChatComposer";
import { NotificationBell } from "./features/notifications/NotificationBell";
const NetworkMapPage = lazy(() => import("./features/network-map/NetworkMapPage"));
const MonitoringDashboard = lazy(() => import("./features/monitoring/MonitoringDashboard"));
const NotificationsPage = lazy(() => import("./features/notifications/NotificationsPage"));
const BackupsPage = lazy(() => import("./features/backups/BackupsPage"));

function ThemeToggle({ compact }: { compact?: boolean }) {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
      setDark(true);
    } else if (saved === "light") {
      document.documentElement.classList.remove("dark");
      setDark(false);
    }
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }
  if (compact) {
    return (
      <button type="button" onClick={toggle} className="rounded-md p-1.5 text-xs text-muted-foreground hover:text-foreground" aria-label={dark ? "Tema terang" : "Tema gelap"}>
        {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        {dark ? "Terang" : "Gelap"}
      </button>
    );
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} className="size-8" aria-label={dark ? "Ganti ke tema terang" : "Ganti ke tema gelap"}>
      {dark ? <Sun className="size-4 text-amber-400" /> : <Moon className="size-4" />}
    </Button>
  );
}

function ThemeToggleMenuItem() {
  const [dark, setDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
      setDark(true);
    } else if (saved === "light") {
      document.documentElement.classList.remove("dark");
      setDark(false);
    }
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }
  return (
    <DropdownMenuItem onClick={toggle} className="gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer">
      {dark ? <Sun className="size-4 text-amber-500" /> : <Moon className="size-4 text-muted-foreground" />}
      <span>{dark ? "Tema Terang" : "Tema Gelap"}</span>
    </DropdownMenuItem>
  );
}

function Shell() {
  const route = useRoute();
  const { profile, loading, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "1");
  const prefs = usePreferences();
  const savePrefs = useSavePreferences();

  useEffect(() => {
    if (prefs.data && profile) {
      const key = `sidebar-collapsed-${profile.username}`;
      const stored = localStorage.getItem(key);
      if (stored !== null) setCollapsed(stored === "1");
      else if (typeof prefs.data.sidebarCollapsed === "boolean") setCollapsed(prefs.data.sidebarCollapsed);
    }
  }, [prefs.data, profile]);

  function setCollapsedPersist(v: boolean) {
    setCollapsed(v);
    try {
      localStorage.setItem("sidebar-collapsed", v ? "1" : "0");
      if (profile) localStorage.setItem(`sidebar-collapsed-${profile.username}`, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    savePrefs.mutate({ sidebarCollapsed: v });
  }

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
    const params = new URLSearchParams(window.location.search);
    const autoAdd = params.get("add") === "1";
    const returnTo = params.get("returnTo");
    return (
      <div className="flex h-svh w-full overflow-hidden bg-background text-foreground">
        <SettingsShell
          section={route.section}
          autoAdd={autoAdd}
          returnTo={returnTo}
          onUseInChat={(id) => {
            if (returnTo) {
              try {
                sessionStorage.setItem("pending-connector", id);
              } catch {
                /* ignore */
              }
              window.location.href = returnTo;
            }
          }}
          onBack={() => {
            if (returnTo) window.location.href = returnTo;
            else navigate({ name: "chat-new" });
          }}
        />
        <Toaster position="top-center" richColors />
      </div>
    );
  }

  const conversationId = route.name === "chat" ? route.id : null;
  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground md:flex-row">
      {/* Mobile top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur-md md:hidden">
        <div className="flex items-center gap-2">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="size-9" aria-label="Buka menu navigasi">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0">
              <SheetHeader className="flex flex-row items-center justify-between border-b border-border/60 px-4 py-3 text-left">
                <SheetTitle className="text-sm font-semibold">MikroTik AI Agent</SheetTitle>
                <NotificationBell onNavigate={() => setMobileOpen(false)} />
              </SheetHeader>
              <div className="flex h-[calc(100svh-4rem)] flex-col overflow-hidden">
                <SidebarContent
                  search={search}
                  setSearch={setSearch}
                  activeId={conversationId}
                  onNavigate={() => setMobileOpen(false)}
                  profileName={profile.displayName}
                  profileUsername={profile.username}
                  onLogout={() => void logout()}
                />
              </div>
            </SheetContent>
          </Sheet>
          <span className="truncate text-sm font-semibold">MikroTik AI Agent</span>
        </div>
        <ThemeToggle />
      </header>

      {/* Desktop sidebar */}
      {!collapsed ? (
        <aside className="hidden w-[272px] shrink-0 flex-col border-r border-border/60 bg-sidebar/95 md:flex" aria-label="Sidebar chat">
          <div className="flex items-center justify-between border-b border-border/50 px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center overflow-hidden rounded-xl bg-card p-1 shadow-xs ring-1 ring-cyan-500/30">
                <img src="/logo.png" alt="MikroTik AI" className="size-full object-contain" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight text-foreground">MikroTik AI</span>
                <span className="rounded-md bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                  Agent
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <NotificationBell onNavigate={() => {}} />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer"
                onClick={() => setCollapsedPersist(true)}
                aria-label="Tutup sidebar"
                title="Tutup sidebar"
              >
                <PanelLeftClose className="size-4" />
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <SidebarContent
              search={search}
              setSearch={setSearch}
              activeId={conversationId}
              onNavigate={() => {}}
              profileName={profile.displayName}
              profileUsername={profile.username}
              onLogout={() => void logout()}
            />
          </div>
        </aside>
      ) : (
        <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-border/60 bg-sidebar/95 py-3.5 md:flex" aria-label="Sidebar ringkas">
          {/* Website Logo as the sidebar expand button */}
          <button
            type="button"
            onClick={() => setCollapsedPersist(false)}
            className="group relative flex size-9 items-center justify-center rounded-xl bg-card p-1 shadow-xs ring-1 ring-border/80 transition-all hover:scale-105 hover:ring-cyan-500/60 active:scale-95 cursor-pointer"
            aria-label="Buka sidebar"
            title="Buka sidebar (MikroTik AI)"
          >
            <img src="/logo.png" alt="MikroTik AI" className="size-full object-contain transition-transform group-hover:scale-105" />
            <span className="sr-only">Buka sidebar</span>
          </button>

          <div className="my-2.5 h-px w-6 bg-border/60" />

          <div className="flex flex-col items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer"
              onClick={() => navigate({ name: "chat-new" })}
              aria-label="Chat baru (Ctrl+K)"
              title="Chat baru (Ctrl+K)"
            >
              <Plus className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer"
              aria-label="Cari percakapan"
              title="Cari percakapan"
              onClick={() => {
                setCollapsedPersist(false);
                setTimeout(() => document.getElementById("sidebar-search")?.focus(), 60);
              }}
            >
              <Search className="size-4" />
            </Button>
            <NotificationBell collapsed onNavigate={() => {}} />
          </div>

          <div className="flex-1" />
          <ProfileAvatar name={profile.displayName} username={profile.username} onLogout={() => void logout()} collapsed />
        </aside>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {route.name === "network-map" ? (
          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Memuat Network Map…</div>}>
            <NetworkMapPage connectionId={route.id} />
          </Suspense>
        ) : route.name === "monitoring" ? (
          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Memuat Monitoring Dashboard…</div>}>
            <MonitoringDashboard initialConnectionId={route.id} />
          </Suspense>
        ) : route.name === "notifications" ? (
          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Memuat Notifikasi…</div>}>
            <NotificationsPage />
          </Suspense>
        ) : route.name === "backups" ? (
          <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Memuat Backup & Diff…</div>}>
            <BackupsPage initialConnectionId={route.id} />
          </Suspense>
        ) : <ChatRoute conversationId={conversationId} onToggleSidebar={() => setCollapsedPersist(!collapsed)} />}
      </main>
      <Toaster position="top-center" richColors />
    </div>
  );
}

function SidebarContent(props: {
  search: string;
  setSearch: (v: string) => void;
  activeId: string | null;
  onNavigate: () => void;
  profileName: string;
  profileUsername: string;
  onLogout: () => void;
}) {
  const conversations = useConversations({ search: props.search || undefined });
  const items = useMemo(() => conversations.data ?? [], [conversations.data]);
  const groups = useMemo(() => groupConversations(items), [items]);

  function newChat() {
    navigate({ name: "chat-new" });
    props.onNavigate();
  }

  function openChat(id: string) {
    navigate({ name: "chat", id });
    props.onNavigate();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5 p-3">
        <button
          type="button"
          onClick={newChat}
          className="group relative flex w-full items-center justify-between overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/20 transition-all duration-150 hover:shadow-indigo-500/35 hover:brightness-105 active:scale-[0.98] cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Plus className="size-4 transition-transform group-hover:rotate-90" />
            <span>Chat baru</span>
          </span>
          <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-white/90">Ctrl+K</kbd>
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            id="sidebar-search"
            value={props.search}
            onChange={(e) => props.setSearch(e.target.value)}
            placeholder="Cari percakapan…"
            className="h-8.5 rounded-xl border-border/50 bg-muted/40 pl-8.5 pr-7 text-xs placeholder:text-muted-foreground/60 focus:bg-background transition-colors"
            aria-label="Cari percakapan"
          />
          {props.search && (
            <button
              type="button"
              onClick={() => props.setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
              aria-label="Hapus pencarian"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-2" aria-label="Daftar percakapan">
        {conversations.isLoading && <p className="px-3 py-4 text-xs text-muted-foreground">Memuat…</p>}
        {conversations.isError && <p className="px-3 py-4 text-xs text-destructive">Gagal memuat daftar chat.</p>}
        {!conversations.isLoading && items.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">Belum ada percakapan.</p>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{g.label}</p>
            <ul className="space-y-1.5">
              {g.items.map((c) => (
                <ConversationRow key={c.id} conv={c} active={props.activeId === c.id} onOpen={() => openChat(c.id)} />
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border/50 p-2">
        <ProfileAvatar name={props.profileName} username={props.profileUsername} onLogout={props.onLogout} onNavigate={props.onNavigate} />
      </div>
    </div>
  );
}

function ConversationRow({ conv, active, onOpen }: { conv: ConversationDTO; active: boolean; onOpen: () => void }) {
  const update = useUpdateConversation(conv.id);
  const del = useDeleteConversation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conv.title);

  async function doPin(pinned: boolean) {
    try {
      await update.mutateAsync({ pinned });
      toast.success(pinned ? "Chat disematkan." : "Pin dilepas.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal.");
    }
  }
  async function doArchive(archived: boolean) {
    try {
      await update.mutateAsync({ archived });
      toast.success(archived ? "Chat diarsipkan." : "Chat dipulihkan.");
      if (archived && active) navigate({ name: "chat-new" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal. Hentikan run/terminal dulu.");
    }
  }
  async function doDelete() {
    if (!confirm("Hapus percakapan ini secara permanen?")) return;
    try {
      await del.mutateAsync(conv.id);
      toast.success("Percakapan dihapus.");
      if (active) navigate({ name: "chat-new" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus.");
    }
  }
  async function doExport() {
    try {
      const res = await fetch(`/api/conversations/${conv.id}/export?format=md`, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Export gagal.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${conv.title.slice(0, 40)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export gagal.");
    }
  }

  if (editing) {
    return (
      <li className="flex items-center gap-1 rounded-xl border border-indigo-500 bg-background p-1">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-7 text-xs" autoFocus aria-label="Nama percakapan" />
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Simpan nama"
          onClick={() => {
            const t = title.trim();
            if (!t) return;
            update.mutate(
              { title: t },
              {
                onSuccess: () => {
                  setEditing(false);
                  toast.success("Nama diubah.");
                },
                onError: (e) => toast.error(e.message),
              },
            );
          }}
        >
          <Check className="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="size-7" aria-label="Batal" onClick={() => setEditing(false)}>
          <X className="size-3.5" />
        </Button>
      </li>
    );
  }

  return (
    <li className="group relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-2.5 py-2.5 text-left transition-all ${
          active
            ? "bg-accent/80 text-foreground font-medium shadow-xs ring-1 ring-border/70"
            : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        }`}
        title={`${conv.title} · dibuat ${new Date(conv.createdAt).toLocaleString("id-ID")}`}
      >
        <span className="flex min-w-0 items-center gap-2 flex-1">
          {conv.pinnedAt ? (
            <Pin className="size-3.5 shrink-0 text-amber-500 fill-amber-500/20" />
          ) : (
            <MessageSquare className={`size-3.5 shrink-0 ${active ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground/60"}`} />
          )}
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-xs ${active ? "font-semibold text-foreground" : "font-medium"}`}>{conv.title}</span>
            <span className="block truncate text-[10px] text-muted-foreground/75 mt-1">
              {new Date(conv.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded-lg p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100 cursor-pointer"
              aria-label={`Menu ${conv.title}`}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-2xl border border-border/60 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md">
            <DropdownMenuItem
              onClick={() => {
                setTitle(conv.title);
                setEditing(true);
              }}
              className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer"
            >
              <Pencil className="size-3.5 text-muted-foreground" />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void doPin(!conv.pinnedAt)} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
              {conv.pinnedAt ? <PinOff className="size-3.5 text-amber-500" /> : <Pin className="size-3.5 text-muted-foreground" />}
              <span>{conv.pinnedAt ? "Lepas pin" : "Pin"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void doArchive(true)} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
              <Archive className="size-3.5 text-muted-foreground" />
              <span>Arsipkan</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void doExport()} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
              <Download className="size-3.5 text-muted-foreground" />
              <span>Export .md</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              onClick={() => void doDelete()}
              className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="size-3.5 text-destructive" />
              <span>Hapus</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function ProfileAvatar({
  name,
  username,
  onLogout,
  collapsed,
  onNavigate,
}: {
  name: string;
  username: string;
  onLogout: () => void;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const route = useRoute();
  const conversation = useConversation(route.name === "chat" ? route.id : null);
  const initials = (name || username || "MA").slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={
            collapsed
              ? "group flex size-9 items-center justify-center rounded-xl border-0 p-0.5 transition-all outline-none hover:bg-accent/70 focus-visible:outline-none active:scale-95 cursor-pointer data-[state=open]:bg-accent/70"
              : "group flex w-full items-center gap-2.5 rounded-xl border-0 p-2 text-left transition-all outline-none hover:bg-accent/50 focus-visible:outline-none active:scale-[0.99] cursor-pointer data-[state=open]:bg-accent/50"
          }
          aria-label="Menu profil"
          data-network-map-active={route.name === "network-map" || undefined}
          title={`${name} (@${username})`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 text-[11px] font-bold text-white shadow-xs ring-1 ring-white/20 transition-transform group-hover:scale-105">
            {initials}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-foreground">{name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">@{username}</span>
              </span>
              <MoreHorizontal className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={collapsed ? "end" : "start"}
        side="top"
        sideOffset={8}
        className="w-56 rounded-2xl border border-border/60 bg-popover/95 p-2 shadow-xl backdrop-blur-md space-y-1"
      >
        <div className="flex items-center gap-2.5 px-2.5 py-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 text-[11px] font-bold text-white shadow-xs">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold leading-tight text-foreground">{name}</p>
            <p className="truncate text-[11px] text-muted-foreground">@{username}</p>
          </div>
        </div>
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem
          aria-current={route.name === "network-map" ? "page" : undefined}
          onClick={() => {
            navigate({ name: "network-map", id: route.name === "network-map" ? route.id : conversation.data?.activeConnectionId ?? undefined });
            onNavigate?.();
          }}
          className={`gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer ${route.name === "network-map" ? "bg-accent text-foreground" : ""}`}
        >
          <Network className="size-4 text-cyan-600 dark:text-cyan-400" />
          <span>Network Map</span>
          {route.name === "network-map" && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          aria-current={route.name === "monitoring" ? "page" : undefined}
          onClick={() => {
            navigate({ name: "monitoring", id: route.name === "monitoring" ? route.id : conversation.data?.activeConnectionId ?? undefined });
            onNavigate?.();
          }}
          className={`gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer ${route.name === "monitoring" ? "bg-accent text-foreground" : ""}`}
        >
          <BarChart3 className="size-4 text-emerald-600 dark:text-emerald-400" />
          <span>Monitoring Dashboard</span>
          {route.name === "monitoring" && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          aria-current={route.name === "notifications" ? "page" : undefined}
          onClick={() => {
            navigate({ name: "notifications" });
            onNavigate?.();
          }}
          className={`gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer ${route.name === "notifications" ? "bg-accent text-foreground" : ""}`}
        >
          <Bell className="size-4 text-rose-500" />
          <span>Notifikasi</span>
          {route.name === "notifications" && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          aria-current={route.name === "backups" ? "page" : undefined}
          onClick={() => {
            navigate({ name: "backups", id: route.name === "backups" ? route.id : conversation.data?.activeConnectionId ?? undefined });
            onNavigate?.();
          }}
          className={`gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer ${route.name === "backups" ? "bg-accent text-foreground" : ""}`}
        >
          <Archive className="size-4 text-indigo-500" />
          <span>Backup & Diff</span>
          {route.name === "backups" && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate({ name: "settings", section: "profile" })}
          className="gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer"
        >
          <User className="size-4 text-muted-foreground" />
          <span>Profil</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate({ name: "settings", section: "connectors" })}
          className="gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer"
        >
          <Settings className="size-4 text-muted-foreground" />
          <span>Pengaturan</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1.5" />
        <ThemeToggleMenuItem />
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem
          onClick={onLogout}
          className="gap-2.5 px-2.5 py-2.5 text-xs font-medium rounded-xl cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <LogOut className="size-4 text-destructive" />
          <span>Keluar</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChatRoute({ conversationId, onToggleSidebar }: { conversationId: string | null; onToggleSidebar: () => void }) {
  const createConversation = useCreateConversation();
  const conversation = useConversation(conversationId);
  const connectors = useConnectors();
  // No silent fallback: exact binding only.
  const activeConnector = useMemo(() => {
    const id = conversation.data?.activeConnectionId ?? null;
    if (!id) return null;
    return (connectors.data ?? []).find((c) => c.id === id) ?? null;
  }, [connectors.data, conversation.data?.activeConnectionId]);

  // Draft for new chat is preserved across Tambah router navigation.
  const [draftKey] = useState("composer-draft-new");

  if (!conversationId) {
    return (
      <NewChatView
        draftKey={draftKey}
        onCreated={(id) => navigate({ name: "chat", id })}
        createConversation={createConversation}
      />
    );
  }
  if (conversation.isLoading) return <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Memuat percakapan…</div>;
  if (conversation.isError || !conversation.data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm">
        <p>Percakapan tidak ditemukan.</p>
        <Button size="sm" onClick={() => navigate({ name: "chat-new" })}>
          Chat baru
        </Button>
      </div>
    );
  }
  return (
    <ChatScreen
      key={conversationId}
      conversationId={conversationId}
      activeConnector={activeConnector}
      onToggleSidebar={onToggleSidebar}
    />
  );
}

function NewChatView({
  draftKey,
  onCreated,
  createConversation,
}: {
  draftKey: string;
  onCreated: (id: string) => void;
  createConversation: ReturnType<typeof useCreateConversation>;
}) {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  const [pendingConnector, setPendingConnector] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem("pending-connector");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem("pending-connector");
    } catch {
      /* ignore */
    }
  }, []);
  const connectors = useConnectors();
  const selected = (pendingConnector !== null
    ? (connectors.data ?? []).find((c) => c.id === pendingConnector)
    : (connectors.data ?? []).find((c) => c.status === "connected") ?? connectors.data?.[0]) ?? null;

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, text);
      sessionStorage.setItem("composer-draft", text);
    } catch {
      /* ignore */
    }
  }, [text, draftKey]);

  async function handleSend(message: string, attachmentIds: string[]) {
    const trimmed = message.trim();
    if (!trimmed) return;
    // Persist draft for returnTo flow before navigation.
    try {
      sessionStorage.setItem("composer-draft", "");
    } catch {
      /* ignore */
    }
    const res = await createConversation.mutateAsync({ title: trimmed.slice(0, 40), connectionId: selected?.id ?? null });
    // Uploads for new chat are handled inside ChatScreen after navigation; here we have no files yet.
    void attachmentIds;
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    // Store pending prompt to auto-send after navigation.
    try {
      sessionStorage.setItem(`pending-prompt-${res.conversation.id}`, trimmed);
      if (selected) sessionStorage.setItem("pending-connector", selected.id);
    } catch {
      /* ignore */
    }
    onCreated(res.conversation.id);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-card p-2 shadow-sm ring-1 ring-border/80">
          <img src="/logo.png" alt="MikroTik AI" className="size-full object-contain" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Apa yang ingin Anda kerjakan?</h1>
        <div className="mt-8 w-full max-w-2xl">
          <ChatComposer
            running={createConversation.isPending}
            connector={selected}
            connectors={connectors.data ?? []}
            selectedConnectorId={selected?.id ?? null}
            onSelectConnector={setPendingConnector}
            attachments={[]}
            uploading={false}
            externalText={text}
            onClearExternalText={() => setText("")}
            onPickFile={() => toast.info("Lampirkan file setelah chat dibuat, atau via chat tersimpan.")}
            onRemoveAttachment={() => {}}
            onSend={(t, ids) => void handleSend(t, ids)}
            onCancel={() => {}}
            onAddRouter={() => {
              try {
                localStorage.setItem(draftKey, text);
                sessionStorage.setItem("composer-draft", text);
              } catch {
                /* ignore */
              }
              const returnTo = window.location.pathname;
              window.location.href = `/settings/connectors?add=1&returnTo=${encodeURIComponent(returnTo)}`;
            }}
            onCompact={() => toast.info("Buat chat dulu sebelum compact.")}
            draftKey={draftKey}
          />
        </div>
      </div>
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
