import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { navigate } from "../lib/router";
import { useCreateConversation, useConversation } from "../features/chat/chat-hooks";
import { useConnectors } from "../features/connectors/connector-hooks";
import { ChatScreen } from "../features/chat/ChatScreen";
import { NewChatView } from "./NewChatView";

export function ChatRoute({ conversationId, onToggleSidebar }: { conversationId: string | null; onToggleSidebar: () => void }) {
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
  if (conversation.isLoading)
    return <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Memuat percakapan…</div>;
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
