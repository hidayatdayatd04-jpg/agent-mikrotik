import { useState } from "react";
import { Check, Copy, Send } from "@/components/icons";
import { Button } from "@/components/ui/button";

export function CodeBlock({ language, code, onSendToTerminal }: { language: string; code: string; onSendToTerminal?: (code: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-sm">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-3 py-1.5 text-xs">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{language || "Code"}</span>
        <div className="flex items-center gap-1">
          {onSendToTerminal && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => onSendToTerminal(code)}
              title="Isi draft terminal saja (tidak langsung dieksekusi)"
            >
              <Send className="size-3" />
              Kirim ke terminal
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* ignore */
              }
            }}
          >
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            {copied ? "Tersalin" : "Salin"}
          </Button>
        </div>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">Contoh/script — belum berarti dieksekusi.</p>
    </div>
  );
}

export function TerminalOutput(props: {
  target: string;
  actor: "AI" | "User";
  command: string;
  output: string;
  status: string;
  durationMs?: number | null;
  exitCode?: number | null;
  timestamp?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/90 px-3 py-1.5 text-xs">
        <span className="font-mono text-[11px] font-semibold">
          RouterOS terminal · {props.target} · {props.actor}
        </span>
        <span className="flex items-center gap-2 text-[11px] text-zinc-400">
          <span>{props.status}</span>
          {props.timestamp && <span>{new Date(props.timestamp).toLocaleTimeString("id-ID")}</span>}
          <button
            type="button"
            className="rounded p-1 hover:bg-zinc-800"
            aria-label="Salin output terminal"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`$ ${props.command}\n${props.output}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* ignore */
              }
            }}
          >
            {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          </button>
        </span>
      </div>
      <div className="p-3 font-mono text-xs leading-relaxed">
        <p className="whitespace-pre-wrap break-all text-cyan-300">$ {props.command}</p>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-zinc-200">{props.output || "(tidak ada output)"}</pre>
        <p className="mt-2 text-[11px] text-zinc-500">
          Status: {props.status}
          {props.durationMs != null ? ` · ${(props.durationMs / 1000).toFixed(1)} dtk` : ""} · Exit code:{" "}
          {props.exitCode ?? "tidak tersedia"}
        </p>
      </div>
    </div>
  );
}
