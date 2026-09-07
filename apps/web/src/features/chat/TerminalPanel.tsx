import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type { ConnectorDTO } from "@shared/index";
import type { TerminalCommandDTO } from "./chat-hooks";

const LOCAL_HELP = `Perintah RouterOS (contoh):
  /system identity print          info router
  /interface print                daftar interface
  /ip address print               alamat IP
  /ip route print                 tabel routing
  ping 8.8.8.8                    ping (otomatis count=4)
  /log print                      log sistem
  /export                         konfigurasi

Lokal: clear, history, help, exit`;

interface Line {
  key: string;
  kind: "input" | "output" | "error" | "info" | "running";
  text: string;
}

function promptLabel(connector: ConnectorDTO | null): string {
  if (!connector) return "[disconnected] >";
  const user = connector.username || "admin";
  const host = connector.routerIdentity || connector.host;
  return `[${user}@${host}] >`;
}

export function TerminalPanel(props: {
  connector: ConnectorDTO | null;
  conversationId?: string | null;
  initialDraft?: string;
  onClose: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [serverCommands, setServerCommands] = useState<TerminalCommandDTO[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [input, setInput] = useState(props.initialDraft ?? "");
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("terminal-history") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [histIdx, setHistIdx] = useState<number>(-1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localLines, setLocalLines] = useState<Line[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useMemo(() => promptLabel(props.connector), [props.connector]);
  const connected = props.connector?.status === "connected";

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    setInput(props.initialDraft ?? "");
    if (props.initialDraft) focusInput();
  }, [props.initialDraft, focusInput]);

  // Open session
  useEffect(() => {
    if (!props.connector || props.connector.status !== "connected") {
      setSessionId(null);
      setSessionError(
        props.connector ? `Connector ${props.connector.status} — reconnect dulu.` : "Belum terhubung ke router.",
      );
      return;
    }
    let cancelled = false;
    setSessionError(null);
    (async () => {
      try {
        const res = await apiFetch<{ session: { id: string } }>("/api/terminal/sessions", {
          method: "POST",
          body: JSON.stringify({ connectionId: props.connector!.id, conversationId: props.conversationId ?? null }),
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
  }, [props.connector?.id, props.connector?.status, props.conversationId]);

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

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [serverCommands.length, localLines.length, busyId]);

  useEffect(() => {
    focusInput();
  }, [sessionId, focusInput]);

  function pushHistory(cmd: string) {
    setHistory((prev) => {
      const next = [cmd, ...prev.filter((h) => h !== cmd)].slice(0, 50);
      try {
        localStorage.setItem("terminal-history", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setHistIdx(-1);
  }

  function handleClear() {
    setHiddenIds(new Set(serverCommands.map((c) => c.id)));
    setLocalLines([]);
  }

  function copyAll() {
    const visible = serverCommands.filter((c) => !hiddenIds.has(c.id));
    const text = visible.map((c) => `${prompt} ${c.command}\n${c.outputPreview}`).join("\n\n") || "(kosong)";
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Output terminal disalin."))
      .catch(() => toast.error("Gagal menyalin."));
  }

  async function cancelRunning() {
    if (!busyId) {
      setInput("");
      return;
    }
    try {
      await apiFetch(`/api/terminal/commands/${busyId}/cancel`, { method: "POST" });
      toast.info("Cancel dikirim — menunggu status final dari server.");
      void fetchCommands();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membatalkan.");
    }
  }

  async function submit(rawInput: string) {
    const cmd = rawInput.trim();
    if (!cmd) return;
    const lower = cmd.toLowerCase();
    // Local commands — never hit the router.
    if (lower === "clear" || lower === "cls") {
      pushHistory(cmd);
      handleClear();
      setInput("");
      return;
    }
    if (lower === "help") {
      pushHistory(cmd);
      setLocalLines((prev) => [
        ...prev,
        { key: `h-in-${Date.now()}`, kind: "input", text: `${prompt} ${cmd}` },
        { key: `h-out-${Date.now()}`, kind: "output", text: LOCAL_HELP },
      ]);
      setInput("");
      return;
    }
    if (lower === "history") {
      pushHistory(cmd);
      const text = history.length > 0 ? history.slice().reverse().map((h, i) => `  ${i + 1}  ${h}`).join("\n") : "  (kosong)";
      setLocalLines((prev) => [
        ...prev,
        { key: `hist-in-${Date.now()}`, kind: "input", text: `${prompt} ${cmd}` },
        { key: `hist-out-${Date.now()}`, kind: "output", text },
      ]);
      setInput("");
      return;
    }
    if (lower === "exit") {
      props.onClose();
      return;
    }
    if (!sessionId || !connected) {
      toast.error("Terminal nonaktif — hubungkan router (SSH) dulu.");
      return;
    }
    if (busyId) {
      toast.error("Masih ada command berjalan — tunggu atau Ctrl+C untuk batalkan.");
      return;
    }
    pushHistory(cmd);
    setInput("");
    try {
      const res = await apiFetch<{ commandId: string }>(`/api/terminal/sessions/${sessionId}/commands`, {
        method: "POST",
        body: JSON.stringify({ command: cmd, conversationId: props.conversationId ?? null }),
      });
      setBusyId(res.commandId);
      void fetchCommands();
      // Fast re-poll until terminal state for snappy UX.
      const poll = async () => {
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            const cur = await apiFetch<{ commands: TerminalCommandDTO[] }>(`/api/terminal/sessions/${sessionId}/commands`);
            const sorted = cur.commands.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            setServerCommands(sorted);
            const target = sorted.find((c) => c.id === res.commandId);
            if (target && !["queued", "running"].includes(target.status)) {
              setBusyId((b) => (b === res.commandId ? null : b));
              break;
            }
          } catch {
            break;
          }
        }
      };
      void poll();
    } catch (err) {
      // Show rejection inline in terminal style + toast.
      const msg = err instanceof Error ? err.message : "Command ditolak.";
      setLocalLines((prev) => [
        ...prev,
        { key: `rej-in-${Date.now()}`, kind: "input", text: `${prompt} ${cmd}` },
        { key: `rej-out-${Date.now()}`, kind: "error", text: msg },
      ]);
      toast.error(msg);
      void fetchCommands();
    }
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      setInput(history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx <= 0) {
        setHistIdx(-1);
        setInput("");
      } else {
        const next = histIdx - 1;
        setHistIdx(next);
        setInput(history[next] ?? "");
      }
    } else if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
      // Ctrl+C: cancel running, else clear input.
      e.preventDefault();
      void cancelRunning();
    } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleClear();
    }
  }

  const visible = serverCommands.filter((c) => !hiddenIds.has(c.id));
  const headerLabel = props.connector
    ? `Terminal - ${props.connector.label} (${props.connector.host})`
    : "Terminal - Belum terhubung";

  return (
    <aside
      className="flex h-full w-full flex-col overflow-hidden border-l border-[#3e3e3e] bg-[#0c0c0c] text-[#cccccc] sm:max-w-md"
      aria-label="Terminal RouterOS"
      onClick={focusInput}
    >
      {/* Title bar ala PowerShell/CMD */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#3e3e3e] bg-[#1e1e1e] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} title={props.connector?.status ?? "disconnected"} />
          <p className="truncate font-mono text-[11px] text-[#cccccc]">{headerLabel}</p>
          <span className="shrink-0 font-mono text-[10px] text-[#858585]">{connected ? "connected" : props.connector?.status ?? "disconnected"}</span>
        </div>
        <div className="flex shrink-0 items-center">
          <button type="button" onClick={handleClear} className="rounded p-1.5 text-[#858585] hover:bg-[#3e3e3e] hover:text-white" aria-label="Bersihkan layar (clear)" title="Bersihkan layar">
            <Trash2 className="size-3.5" />
          </button>
          <button type="button" onClick={copyAll} className="rounded p-1.5 text-[#858585] hover:bg-[#3e3e3e] hover:text-white" aria-label="Salin output" title="Salin output">
            <Copy className="size-3.5" />
          </button>
          <button type="button" onClick={props.onClose} className="rounded p-1.5 text-[#858585] hover:bg-[#e81123] hover:text-white" aria-label="Tutup terminal" title="Tutup">
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Body terminal */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[12.5px] leading-[1.55]" role="log" aria-live="polite">
        {/* Banner */}
        <div className="select-text whitespace-pre-wrap break-words">
          <p className="text-[#4ec9b0]">MikroTik RouterOS Terminal — User</p>
          {props.connector && (
            <p className="text-[#858585]">
              {props.connector.label} ({props.connector.host}
              {props.connector.routerIdentity ? ` · ${props.connector.routerIdentity}` : ""})
            </p>
          )}
          <p className="text-[#858585]">Ketik &apos;help&apos; untuk bantuan. ↑/↓ riwayat · Ctrl+C batal · Ctrl+L bersih.</p>
        </div>

        {sessionError && !sessionId && <p className="mt-2 whitespace-pre-wrap break-words text-[#f48771]">{sessionError}</p>}

        {/* Local lines (help/history/rejected) */}
        {localLines.map((l) =>
          l.kind === "input" ? (
            <p key={l.key} className="whitespace-pre-wrap break-all">
              <span className="text-[#4ec9b0]">{prompt} </span>
              <span className="text-[#d4d4d4]">{l.text.slice(prompt.length + 1)}</span>
            </p>
          ) : (
            <pre key={l.key} className={`whitespace-pre-wrap break-words ${l.kind === "error" ? "text-[#f48771]" : "text-[#9cdcfe]"}`}>
              {l.text}
            </pre>
          ),
        )}

        {/* Server commands — continuous, no cards */}
        {visible.map((c) => {
          const failed = ["failed", "rejected", "cancelled"].includes(c.status);
          const running = ["queued", "running"].includes(c.status);
          return (
            <div key={c.id} className="select-text">
              <p className="whitespace-pre-wrap break-all">
                <span className="text-[#4ec9b0]">{prompt} </span>
                <span className="text-[#d4d4d4]">{c.command}</span>
              </p>
              {running ? (
                <p className="animate-pulse text-[#dcdcaa]">… menjalankan (Ctrl+C untuk batal)</p>
              ) : (
                <>
                  {c.outputPreview && (
                    <pre className={`whitespace-pre-wrap break-words ${failed ? "text-[#f48771]" : "text-[#cccccc]"}`}>
                      {c.outputPreview.slice(0, 6000)}
                    </pre>
                  )}
                  <p className={`text-[11px] ${failed ? "text-[#f48771]" : "text-[#6a9955]"}`}>
                    {c.status}
                    {c.durationMs != null ? ` · ${(c.durationMs / 1000).toFixed(1)}s` : ""} · Exit code: {c.exitCode ?? "tidak tersedia"}
                    {c.truncated ? " · terpotong" : ""}
                  </p>
                </>
              )}
            </div>
          );
        })}

        {visible.length === 0 && localLines.length === 0 && sessionId && (
          <p className="mt-1 text-[#6a9955]"># siap — coba: /system identity print</p>
        )}

        {/* Inline prompt — seperti terminal pada umumnya, bukan textarea terpisah */}
        <div className="flex items-start gap-0 py-0.5">
          <span className="shrink-0 whitespace-pre text-[#4ec9b0]">{prompt} </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKey}
            disabled={!connected || !sessionId}
            placeholder={!connected || !sessionId ? "hubungkan router dulu…" : ""}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label="Input terminal"
            className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-[#d4d4d4] caret-white outline-none placeholder:text-[#555]"
          />
        </div>
        {busyId && <p className="text-[11px] text-[#858585]">Ctrl+C untuk membatalkan command berjalan.</p>}
      </div>
    </aside>
  );
}
