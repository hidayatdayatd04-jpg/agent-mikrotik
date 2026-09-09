import { X, Copy, Trash2 } from "@/components/icons";
import type { ConnectorDTO } from "@shared/index";
import type { TerminalCommandDTO } from "./chat-hooks";
import type { Line } from "./terminal-helpers";

export function TerminalOutput(props: {
  connector: ConnectorDTO | null;
  connected: boolean;
  headerLabel: string;
  prompt: string;
  sessionError: string | null;
  sessionId: string | null;
  localLines: Line[];
  visible: TerminalCommandDTO[];
  busyId: string | null;
  input: string;
  setInput: (v: string) => void;
  onInputKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onClear: () => void;
  onCopyAll: () => void;
  onClose: () => void;
}) {
  const {
    connector,
    connected,
    headerLabel,
    prompt,
    sessionError,
    sessionId,
    localLines,
    visible,
    busyId,
    input,
    setInput,
    onInputKey,
    inputRef,
    scrollRef,
  } = props;
  return (
    <>
      {/* Title bar ala PowerShell/CMD */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#3e3e3e] bg-[#1e1e1e] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} title={connector?.status ?? "disconnected"} />
          <p className="truncate font-mono text-[11px] text-[#cccccc]">{headerLabel}</p>
          <span className="shrink-0 font-mono text-[10px] text-[#858585]">{connected ? "connected" : (connector?.status ?? "disconnected")}</span>
        </div>
        <div className="flex shrink-0 items-center">
          <button type="button" onClick={props.onClear} className="rounded p-1.5 text-[#858585] hover:bg-[#3e3e3e] hover:text-white" aria-label="Bersihkan layar (clear)" title="Bersihkan layar">
            <Trash2 className="size-3.5" />
          </button>
          <button type="button" onClick={props.onCopyAll} className="rounded p-1.5 text-[#858585] hover:bg-[#3e3e3e] hover:text-white" aria-label="Salin output" title="Salin output">
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
          {connector && (
            <p className="text-[#858585]">
              {connector.label} ({connector.host}
              {connector.routerIdentity ? ` · ${connector.routerIdentity}` : ""})
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
    </>
  );
}
