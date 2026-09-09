import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAiProviders, useMessages, useStartRun, useCancelRun } from "./chat-hooks";
import { useRunEvents } from "./use-run-events";
import { readProviderSelection, resolveProviderSelection } from "./provider-selection";
import { REASONING_STORAGE_KEY } from "./composer/use-composer-reasoning";
import { normalizeReasoningEffort } from "@shared/index";

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
    let pendingModel: string | null = null;
    let pendingProvider: string | null = null;
    let pendingReasoning: string | null = null;
    try {
      pending = sessionStorage.getItem(key);
      pendingModel = sessionStorage.getItem(`pending-model-${conversationId}`);
      pendingProvider = sessionStorage.getItem(`pending-provider-${conversationId}`);
      pendingReasoning = sessionStorage.getItem(`pending-reasoning-${conversationId}`);
    } catch {
      pending = null;
    }
    if (pending && !activeRunId && messages.data !== undefined && providers.data !== undefined) {
      queueMicrotask(() => {
        if (cancelled) return;
        try {
          sessionStorage.removeItem(key);
          sessionStorage.removeItem(`pending-model-${conversationId}`);
          sessionStorage.removeItem(`pending-provider-${conversationId}`);
          sessionStorage.removeItem(`pending-reasoning-${conversationId}`);
        } catch {
          /* ignore */
        }
        handleSend(pending!, [], pendingModel ?? undefined, pendingProvider ?? undefined, pendingReasoning ?? undefined);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [conversationId, messages.data, providers.data]);

  function handleSend(text: string, attachmentIds: string[], model?: string, providerId?: string, reasoningEffort?: string) {
    const selected = resolveProviderSelection(providers.data ?? [], readProviderSelection());
    if (opts.terminalOpen) {
      // Terminal state doesn't block chat, but keep draft intact notice.
    }
    const effort =
      reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high" ? reasoningEffort : undefined;
    idemRef.current += 1;
    startRun.mutate(
      {
        text,
        idempotencyKey: `ui-${Date.now()}-${idemRef.current}-${Math.random().toString(36).slice(2, 10)}`,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
        model: model ?? selected?.model,
        providerId: providerId ?? selected?.providerId,
        ...(effort ? { reasoningEffort: effort } : {}),
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

  /**
   * Retry in-place untuk pesan user yang diedit: teks diperbarui pada pesan
   * yang sama dan run diulang tanpa menambah pesan duplikat. Model/provider/
   * reasoning mengikuti pilihan aktif composer (localStorage).
   */
  function handleRetry(editedMessageId: string, text: string) {
    const selected = resolveProviderSelection(providers.data ?? [], readProviderSelection());
    let effort: "low" | "medium" | "high" | undefined;
    try {
      effort = normalizeReasoningEffort(localStorage.getItem(REASONING_STORAGE_KEY)) ?? undefined;
    } catch {
      effort = undefined;
    }
    idemRef.current += 1;
    startRun.mutate(
      {
        text,
        idempotencyKey: `ui-retry-${Date.now()}-${idemRef.current}-${Math.random().toString(36).slice(2, 10)}`,
        editedMessageId,
        model: selected?.model,
        providerId: selected?.providerId,
        ...(effort ? { reasoningEffort: effort } : {}),
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

  return { activeRunId, runEvents, handleSend, handleRetry, handleCancel, cancelling: cancelRun.isPending };
}
