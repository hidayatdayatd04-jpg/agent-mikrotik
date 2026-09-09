import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ConnectorDTO } from "@shared/index";
import type { TerminalCommandDTO } from "./chat-hooks";

export function useTerminalSession(connector: ConnectorDTO | null, conversationId?: string | null) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [serverCommands, setServerCommands] = useState<TerminalCommandDTO[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  // Open session
  useEffect(() => {
    if (!connector || connector.status !== "connected") {
      setSessionId(null);
      setSessionError(connector ? `Connector ${connector.status} — reconnect dulu.` : "Belum terhubung ke router.");
      return;
    }
    let cancelled = false;
    setSessionError(null);
    (async () => {
      try {
        const res = await apiFetch<{ session: { id: string } }>("/api/terminal/sessions", {
          method: "POST",
          body: JSON.stringify({ connectionId: connector!.id, conversationId: conversationId ?? null }),
        });
        if (!cancelled) {
          setSessionId(res.session.id);
          setServerCommands([]);
          setHiddenIds(new Set());
          setBusyId(null);
        }
      } catch (err) {
        if (!cancelled) setSessionError(err instanceof Error ? err.message : "Gagal membuka sesi terminal.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connector?.id, connector?.status, conversationId]);

  const fetchCommands = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await apiFetch<{ commands: TerminalCommandDTO[] }>(`/api/terminal/sessions/${sessionId}/commands`);
      const sorted = res.commands.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setServerCommands(sorted);
      const running = sorted.find((c) => c.status === "running" || c.status === "queued");
      setBusyId(running ? running.id : null);
    } catch {
      /* keep last */
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    void fetchCommands();
    const t = setInterval(fetchCommands, busyId ? 1000 : 2500);
    return () => clearInterval(t);
  }, [sessionId, busyId, fetchCommands]);

  function clearServerLines() {
    setHiddenIds(new Set(serverCommands.map((c) => c.id)));
  }

  const visible = serverCommands.filter((c) => !hiddenIds.has(c.id));

  return { sessionId, sessionError, serverCommands, visible, busyId, setBusyId, fetchCommands, clearServerLines, setServerCommands };
}
