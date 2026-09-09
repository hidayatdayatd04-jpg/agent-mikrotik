import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useConnectors } from "../features/connectors/connector-hooks";
import { useCreateConversation } from "../features/chat/chat-hooks";
import { ChatComposer } from "../features/chat/ChatComposer";

export function NewChatView({
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
  const selected =
    (pendingConnector !== null
      ? (connectors.data ?? []).find((c) => c.id === pendingConnector)
      : ((connectors.data ?? []).find((c) => c.status === "connected") ?? connectors.data?.[0])) ??
    null;

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
