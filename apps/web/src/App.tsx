import { useMemo, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Plug, Settings2, Moon, Sun, Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ConnectorsPanel } from "./features/connectors/ConnectorsPanel";
import { useAuthState } from "./features/auth/AuthGate";
import { useLogout } from "./features/auth/auth-hooks";
import {
  useConversations,
  useCreateConversation,
  useConversation,
} from "./features/chat/chat-hooks";
import { useConnectors } from "./features/connectors/connector-hooks";
import { ChatScreen } from "./features/chat/ChatScreen";
import { ProviderSettingsPage } from "./features/chat/ProviderSettingsPage";

type View = "chat" | "connectors" | "provider";

function LogoutButton() {
  const logout = useLogout();
  return (
    <Button variant="outline" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
      Keluar
    </Button>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? "Ganti ke tema terang" : "Ganti ke tema gelap"} title={dark ? "Tema terang" : "Tema gelap"}>
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </Button>
  );
}

/** Shell: static sidebar on desktop, Sheet drawer on mobile (M10). */
function Shell({ user }: { user: { email: string; name?: string | null } }) {
  const [view, setView] = useState<View>("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const conversations = useConversations();
  const createConversation = useCreateConversation();
  const conversation = useConversation(conversationId);
  const connectors = useConnectors();
  const activeConnId = conversation.data?.activeConnectionId ?? null;
  const activeConnector = useMemo(
    () => (connectors.data ?? []).find((c) => c.id === activeConnId) ?? null,
    [connectors.data, activeConnId],
  );

  const items = useMemo(() => conversations.data ?? [], [conversations.data]);

  function handleNewChat() {
    createConversation.mutate(
      { title: undefined, connectionId: null },
      {
        onSuccess: (res) => {
          setConversationId(res.conversation.id);
          setView("chat");
          setMobileNavOpen(false);
        },
      },
    );
  }

  function selectConversation(id: string) {
    setConversationId(id);
    setView("chat");
    setMobileNavOpen(false);
  }

  function switchView(v: View) {
    setView(v);
    setMobileNavOpen(false);
  }

  const nav = (
    <SidebarContent
      view={view}
      conversationId={conversationId}
      items={items}
      user={user}
      onNewChat={handleNewChat}
      onSelectConversation={selectConversation}
      onSwitchView={switchView}
      creating={createConversation.isPending}
    />
  );

  return (
    <div className="flex h-svh flex-col md:flex-row">
      {/* mobile top bar */}
      <header className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Buka menu navigasi">
              <Menu className="size-5" aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="border-b">
              <SheetTitle className="text-left">MikroTik AI Agent</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">{nav}</div>
          </SheetContent>
        </Sheet>
        <span className="truncate text-sm font-medium">
          {conversation.data?.title ?? "MikroTik AI Agent"}
        </span>
      </header>

      <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/30 md:flex">{nav}</aside>

      <main className="min-w-0 flex-1">
        {view === "connectors" && (
          <div className="mx-auto max-w-3xl p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">Connector Router</h2>
            <ConnectorsPanel />
            {conversationId && (
              <div className="mt-6 rounded-xl border p-4">
                <p className="text-sm font-medium">Percakapan aktif: {conversation.data?.title ?? "—"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Router terhubung: {conversation.data?.activeConnectionId ? "ya" : "tidak ada"}
                </p>
              </div>
            )}
          </div>
        )}
        {view === "provider" && <ProviderSettingsPage />}
        {view === "chat" && (
          <div className="h-[calc(100svh-3.25rem)] md:h-full">
            {conversationId ? (
              <ChatScreen
                conversationId={conversationId}
                activeRouterLabel={
                  activeConnector
                    ? `${activeConnector.label} (${activeConnector.host}${activeConnector.routerIdentity ? ` · ${activeConnector.routerIdentity}` : ""})`
                    : null
                }
                writeMode={activeConnector?.mode === "write"}
                activeConnector={activeConnector}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-lg font-medium">MikroTik AI Agent</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Mulai percakapan baru atau pilih dari riwayat.
                </p>
                <Button onClick={handleNewChat} className="gap-2">
                  <Plus className="size-4" aria-hidden />
                  Chat baru
                </Button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function SidebarContent(props: {
  view: View;
  conversationId: string | null;
  items: { id: string; title: string }[];
  user: { email: string };
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onSwitchView: (v: View) => void;
  creating: boolean;
}) {
  return (
    <>
      <div className="p-3">
        <Button
          onClick={props.onNewChat}
          className="w-full justify-start gap-2"
          disabled={props.creating}
        >
          <Plus className="size-4" aria-hidden />
          Chat baru
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Riwayat
        </p>
        {props.items.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">Belum ada percakapan.</p>
        )}
        <ul className="space-y-0.5">
          {props.items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => props.onSelectConversation(c.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                  props.conversationId === c.id && props.view === "chat"
                    ? "bg-background shadow-sm"
                    : "hover:bg-background/60"
                }`}
              >
                <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{c.title}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t pt-2">
          <button
            type="button"
            onClick={() => props.onSwitchView("connectors")}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
              props.view === "connectors" ? "bg-background shadow-sm" : "hover:bg-background/60"
            }`}
          >
            <Plug className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            Connector
          </button>
          <button
            type="button"
            onClick={() => props.onSwitchView("provider")}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
              props.view === "provider" ? "bg-background shadow-sm" : "hover:bg-background/60"
            }`}
          >
            <Settings2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            Provider AI
          </button>
        </div>
      </nav>
      <div className="border-t p-3">
        <div className="flex items-center justify-between gap-2">
          <ThemeToggle />
          <span className="truncate text-xs text-muted-foreground" title={props.user.email}>
            {props.user.email}
          </span>
          <LogoutButton />
        </div>
      </div>
    </>
  );
}

export function App() {
  const { user } = useAuthState();

  if (!user) {
    return <LoginPlaceholder />;
  }

  return (
    <>
      <Shell user={user} />
      <Toaster position="top-center" richColors />
    </>
  );
}

function LoginPlaceholder() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <p className="text-muted-foreground">Memuat…</p>
    </div>
  );
}
