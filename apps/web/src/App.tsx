import { useMemo, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Plug, Settings2, Moon, Sun } from "lucide-react";
import { ConnectorsPanel } from "./features/connectors/ConnectorsPanel";
import { useAuthState } from "./features/auth/AuthGate";
import { useLogout } from "./features/auth/auth-hooks";
import {
  useConversations,
  useCreateConversation,
  useConversation,
} from "./features/chat/chat-hooks";
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

/** Desktop-ish shell: sidebar history + main content area (M9). */
function Shell({ user }: { user: { email: string; name?: string | null } }) {
  const [view, setView] = useState<View>("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversations = useConversations();
  const createConversation = useCreateConversation();
  const conversation = useConversation(conversationId);
  const activeConnId = conversation.data?.activeConnectionId ?? null;

  const items = useMemo(() => conversations.data ?? [], [conversations.data]);

  function handleNewChat() {
    createConversation.mutate(
      { title: undefined, connectionId: null },
      {
        onSuccess: (res) => {
          setConversationId(res.conversation.id);
          setView("chat");
        },
      },
    );
  }

  return (
    <div className="flex h-svh">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/30">
        <div className="p-3">
          <Button
            onClick={handleNewChat}
            className="w-full justify-start gap-2"
            disabled={createConversation.isPending}
          >
            <Plus className="size-4" aria-hidden />
            Chat baru
          </Button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Riwayat
          </p>
          {items.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">Belum ada percakapan.</p>
          )}
          <ul className="space-y-0.5">
            {items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setConversationId(c.id);
                    setView("chat");
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                    conversationId === c.id && view === "chat"
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
              onClick={() => setView("connectors")}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                view === "connectors" ? "bg-background shadow-sm" : "hover:bg-background/60"
              }`}
            >
              <Plug className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              Connector
            </button>
            <button
              type="button"
              onClick={() => setView("provider")}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                view === "provider" ? "bg-background shadow-sm" : "hover:bg-background/60"
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
            <span className="truncate text-xs text-muted-foreground" title={user.email}>
              {user.email}
            </span>
            <LogoutButton />
          </div>
        </div>
      </aside>

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
          <div className="h-full">
            {conversationId ? (
              <ChatScreen
                conversationId={conversationId}
                activeRouterLabel={activeConnId ? "Router terhubung" : null}
                writeMode={false}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-lg font-medium">MikroTik AI Agent</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Mulai percakapan baru atau pilih dari riwayat di sebelah kiri.
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
