import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAiProviders, useMessages, useStartRun, useCancelRun } from "./chat-hooks";
import { useRunEvents } from "./use-run-events";
import { readProviderSelection, resolveProviderSelection } from "./provider-selection";

export function useChatRun(conversationId: string, opts: { terminalOpen: boolean; onRunStarted: () => void }) {
  const qc = useQueryClient();
  const providers = useAiProviders();
  const messages = useMessages(conversationId);
  const startRun = useStartRun(conversationId);
  const cancelRun = useCancelRun();
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const runEvents = useRunEvents(
    activeRunId,
    useCallback(() => {
      setActiveRunId(null);
      qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
      qc.invalidateQueries({ queryKey: ["activities", conversationId] });
    }, [qc, conversationId]),
  );
  const idemRef = useRef(0);

  useEffect(() => {
    setActiveRunId(null);
  }, [conversationId]);

  // Pending prompt from new-chat flow (sessionStorage) — auto-send once.
  useEffect(() => {
    let cancelled = false;
    const key = `pending-prompt-${conversationId}`;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(key);
    } catch {
      pending = null;
    }
    if (pending && !activeRunId && messages.data !== undefined && providers.data !== undefined) {
      queueMicrotask(() => {
        if (cancelled) return;
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* ignore */
        }
        handleSend(pending!, []);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [conversationId, messages.data, providers.data]);

  function handleSend(text: string, attachmentIds: string[], model?: string, providerId?: string) {
    const selected = resolveProviderSelection(providers.data ?? [], readProviderSelection());
    if (opts.terminalOpen) {
      // Terminal state doesn't block chat, but keep draft intact notice.
    }
    idemRef.current += 1;
    startRun.mutate(
      {
        text,
        idempotencyKey: `ui-${Date.now()}-${idemRef.current}-${Math.random().toString(36).slice(2, 10)}`,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
        model: model ?? selected?.model,
        providerId: providerId ?? selected?.providerId,
      },
      {
        onSuccess: (res) => {
          opts.onRunStarted();
          if (res.resumed) toast.info("Run yang sama sudah ada — melanjutkan run tersebut.");
          setActiveRunId(res.runId);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handleCancel() {
    if (activeRunId) cancelRun.mutate(activeRunId, { onError: (err) => toast.error(err.message) });
  }

  return { activeRunId, runEvents, handleSend, handleCancel, cancelling: cancelRun.isPending };
}
