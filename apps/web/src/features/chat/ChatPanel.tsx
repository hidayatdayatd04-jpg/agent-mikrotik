import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ThinkingLogo } from "./ThinkingLogo";
import { remarkCleanResponse } from "./clean-response";
import { extractAskBlocks, stripAskBlocks } from "./ask-card";
import { AskCard } from "./AskCard";
import { Button } from "@/components/ui/button";
import {
  Check,
  Copy,
  ArrowDown,
  User,
  FileText,
  Pencil,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import type { MessageDTO, ActivityEventDTO, RunEventDTO } from "./chat-hooks";
import { buildRunTimeline } from "./run-timeline";
import {
  RunPipeline,
  CompactionNotice,
  buildPipeline,
  humanizeTool,
  isCompactionEvent,
  isManualTerminalEvent,
  type PipelineStep,
} from "./ToolActivity";
import { CodeBlock } from "./OutputBlocks";
import { EmptyChatState } from "./EmptyChatState";

export interface ToolActivity {
  id?: string;
  name: string;
  status: "running" | "done" | "failed";
}

function CopyButton({ getText, label = "Salin" }: { getText: () => string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/80 gap-1.5 rounded-md transition-colors"
      aria-label="Salin teks"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? (
        <>
          <Check className="size-3.5 text-emerald-500" aria-hidden />
          <span className="text-emerald-500 font-medium">Tersalin!</span>
        </>
      ) : (
        <>
          <Copy className="size-3.5" aria-hidden />
          <span>{label}</span>
        </>
      )}
    </Button>
  );
}

/** Strip ANSI/OSC escape sequences from model output before render. */
function sanitizeTerminalText(text: string): string {
  return (
    text
      .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
      .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .slice(0, 20000)
  );
}

function Markdown({ text, onSendToTerminal }: { text: string; onSendToTerminal?: (code: string) => void }) {
  const safe = sanitizeTerminalText(text);
  return (
    <div className="chat-markdown prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-pre:rounded-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCleanResponse]}
        components={{
          a: ({ href, children }) => {
            const url = href && /^https?:\/\//i.test(href) ? href : undefined;
            if (!url) return <>{children}</>;
            return (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-indigo-600 hover:text-indigo-500 underline underline-offset-2 dark:text-indigo-400 font-medium"
              >
                {children}
              </a>
            );
          },
          pre: ({ children }) => {
            const codeText = extractText(children);
            return <CodeBlock language={detectLanguage(codeText)} code={codeText} onSendToTerminal={onSendToTerminal} />;
          },
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground font-semibold"
                {...props}
              >
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border border-border/70">
              <table className="w-full text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border bg-muted/50 p-2.5 font-semibold text-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border/50 p-2.5 text-muted-foreground last:border-0">
              {children}
            </td>
          ),
        }}
      >
        {safe}
      </ReactMarkdown>
    </div>
  );
}

function detectLanguage(code: string): string {
  const t = code.trim().toLowerCase();
  if (t.startsWith("/")) return "RouterOS";
  if (t.includes("{") && t.includes(":")) return "JSON";
  if (t.includes("get-") || t.includes("write-host")) return "PowerShell";
  if (t.includes("#!/bin/bash") || t.startsWith("sudo ")) return "Bash";
  return "Code";
}

function extractText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: unknown } }).props;
    return extractText(props?.children);
  }
  return "";
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AssistantBody({ text, onAnswerAsk, onSendToTerminal }: { text: string; onAnswerAsk?: (label: string) => void; onSendToTerminal?: (code: string) => void }) {
  const specs = onAnswerAsk ? extractAskBlocks(text) : null;
  const body = specs ? stripAskBlocks(text) : text;
  return (
    <>
      {body && <Markdown text={body} onSendToTerminal={onSendToTerminal} />}
      {specs && onAnswerAsk
        ? specs.map((spec, i) => (
            <AskCard key={i} spec={spec} onAnswer={onAnswerAsk} />
          ))
        : null}
    </>
  );
}

export function ChatPanel(props: {
  messages: MessageDTO[];
  streamText: string;
  liveEvents?: RunEventDTO[];
  toolActivity: ToolActivity[];
  persistedActivities?: ActivityEventDTO[];
  txStatus?: string | null;
  runLive: boolean;
  emptyTitle?: string;
  onSelectPrompt?: (prompt: string) => void;
  onResendPrompt?: (prompt: string) => void;
  onAnswerAsk?: (label: string) => void;
  onSendToTerminal?: (code: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      nearBottomRef.current = near;
      setShowJump(!near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [props.messages.length, props.streamText, props.toolActivity.length, props.runLive, props.persistedActivities?.length]);

  function startEdit(id: string, text: string) {
    setEditingMessageId(id);
    setEditingContent(text);
  }

  function submitEdit() {
    const trimmed = editingContent.trim();
    if (!trimmed) return;
    setEditingMessageId(null);
    if (props.onResendPrompt) {
      props.onResendPrompt(trimmed);
    }
  }

  const showEmpty = props.messages.length === 0 && !props.runLive && !props.streamText;

  // Group persisted run events by runId. Manual terminal sessions (no runId)
  // belong to the terminal panel, never to an AI pipeline. Compaction notices
  // render as standalone system rows interleaved by time.
  const persisted = props.persistedActivities ?? [];
  const byRun = new Map<string, ActivityEventDTO[]>();
  for (const ev of persisted) {
    if (ev.type === "run.started" || isManualTerminalEvent(ev) || isCompactionEvent(ev)) continue;
    if (!ev.runId) continue;
    const arr = byRun.get(ev.runId);
    if (arr) arr.push(ev);
    else byRun.set(ev.runId, [ev]);
  }
  const compactions = persisted
    .filter((ev) => isCompactionEvent(ev))
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  type Row = { kind: "message"; m: MessageDTO } | { kind: "compaction"; ev: ActivityEventDTO };
  const rows: Row[] = [];
  let ci = 0;
  for (const m of props.messages) {
    while (ci < compactions.length && compactions[ci]!.createdAt <= m.createdAt) {
      rows.push({ kind: "compaction", ev: compactions[ci]! });
      ci += 1;
    }
    rows.push({ kind: "message", m });
  }
  while (ci < compactions.length) {
    rows.push({ kind: "compaction", ev: compactions[ci]! });
    ci += 1;
  }

  const liveSteps: PipelineStep[] = props.toolActivity.map((t, i) => ({
    key: t.id ?? `live-${i}`,
    index: i + 1,
    label: humanizeTool(t.name),
    tool: t.name,
    status: t.status === "done" ? "completed" : t.status,
    durationMs: null,
  }));

  return (
    <div className="relative flex h-full flex-col">
      {showJump && (
        <Button
          variant="outline"
          size="sm"
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 gap-1.5 rounded-full border-border/80 bg-card/90 px-4 shadow-lg backdrop-blur-md hover:bg-card"
          onClick={() => {
            nearBottomRef.current = true;
            setShowJump(false);
            bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
          }}
          aria-label="Lompat ke pesan terbaru"
        >
          <ArrowDown className="size-3.5 text-indigo-500" />
          <span className="text-xs font-medium">Ke pesan terbaru</span>
        </Button>
      )}

      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-[850px] flex-col gap-6">
          {showEmpty && <EmptyChatState />}

          {rows.map((row) => {
            if (row.kind === "compaction") {
              return <CompactionNotice key={row.ev.id} event={row.ev} />;
            }
            const m = row.m;
            const isUser = m.role === "user";
            const isEditingThis = editingMessageId === m.id;
            const runActs = !isUser && m.content.runId ? byRun.get(m.content.runId) : undefined;
            const pipeline = runActs && runActs.length > 0 ? buildPipeline(runActs) : null;
            const showPipeline = !!pipeline && pipeline.steps.length > 0;
            const timeline = m.content.timeline?.length ? buildRunTimeline(m.content.timeline) : null;
            // Status run keseluruhan: pipeline tool yang selesai tidak boleh
            // berlabel "Selesai" bila jawaban akhirnya gagal/dibatalkan.
            const overall = m.status === "failed" ? "failed" as const : m.status === "cancelled" ? "cancelled" as const : null;

            return (
              <div
                key={m.id}
                className={`group flex gap-3 animate-in fade-in duration-200 ${
                  isUser ? "justify-end" : "justify-start"
                }`}
              >
                {!isUser && (
                  <div className="flex size-9 shrink-0 select-none items-center justify-center rounded-xl overflow-hidden ring-1 ring-cyan-500/30 bg-card shadow-xs">
                    <img
                      src="/logo.png"
                      alt="MikroTik AI"
                      className="size-full object-contain p-0.5"
                    />
                  </div>
                )}

                <div className="max-w-[85%] sm:max-w-[80%] space-y-1">
                  {isUser ? (
                    <div>
                      {isEditingThis ? (
                        <div className="rounded-2xl border border-indigo-500/80 bg-card p-3 shadow-md space-y-2">
                          <textarea
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            className="w-full min-h-[70px] resize-none bg-transparent p-1 text-sm outline-none text-foreground"
                            autoFocus
                          />
                          <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/60">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => setEditingMessageId(null)}
                            >
                              <X className="size-3 mr-1" /> Batal
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-indigo-600 hover:bg-indigo-500 text-white gap-1"
                              onClick={submitEdit}
                              disabled={!editingContent.trim()}
                            >
                              <Send className="size-3" /> Kirim Ulang
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-2xl rounded-tr-xs bg-indigo-600 px-4 py-3 text-white shadow-sm">
                          <p className="whitespace-pre-wrap text-sm leading-relaxed font-normal">
                            {m.content.text}
                          </p>
                          {m.content.attachments && m.content.attachments.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {m.content.attachments.map((a) => (
                                <span
                                  key={a.id}
                                  className="flex items-center gap-1 rounded-md bg-white/20 px-2.5 py-0.5 text-xs text-white"
                                >
                                  <FileText className="size-3" />
                                  {a.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {!isEditingThis && (
                        <div className="mt-1 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <CopyButton getText={() => m.content.text ?? ""} label="Salin" />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/80 gap-1 rounded-md transition-colors"
                            onClick={() => startEdit(m.id, m.content.text ?? "")}
                            title="Edit pesan ini"
                          >
                            <Pencil className="size-3" />
                            <span>Edit</span>
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="rounded-2xl rounded-tl-xs border border-border/70 bg-card/80 px-4 py-3.5 shadow-xs">
                        {m.content.attachments && m.content.attachments.length > 0 && (
                          <div className="mb-2.5 flex flex-wrap gap-1">
                            {m.content.attachments.map((a) => (
                              <span
                                key={a.id}
                                className="flex items-center gap-1 rounded-md border border-border/80 bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                              >
                                <FileText className="size-3 text-cyan-500" />
                                {a.name}
                              </span>
                            ))}
                          </div>
                        )}

                        {timeline ? timeline.map((block) => (
                          <div key={block.key} className="my-2 first:mt-0 last:mb-0">
                            {block.kind === "text" ? <AssistantBody text={block.text} onAnswerAsk={props.onAnswerAsk} onSendToTerminal={props.onSendToTerminal} /> : <RunPipeline steps={block.steps ?? [block.step]} defaultOpen overall={overall} />}
                          </div>
                        )) : <>
                        {showPipeline && <div className="mb-3"><RunPipeline steps={pipeline!.steps} tx={pipeline!.tx} defaultOpen={false} overall={overall} /></div>}
                        {m.content.text ? (
                          <AssistantBody text={m.content.text} onAnswerAsk={props.onAnswerAsk} onSendToTerminal={props.onSendToTerminal} />
                        ) : (
                          <span className="text-xs text-muted-foreground">{m.status === "cancelled" ? "Jawaban dihentikan." : "Tidak ada teks jawaban."}</span>
                        )}
                        </>}

                        {m.status && m.status !== "complete" && m.status !== "completed" && (
                          <p className="mt-1 text-[11px] text-muted-foreground/80">
                            Status: {m.status === "failed" ? "Gagal" : m.status === "cancelled" ? "Dibatalkan" : m.status}
                          </p>
                        )}
                      </div>

                      <div className="mt-1 flex items-center justify-start gap-2 text-[11px] text-muted-foreground">
                        {m.content.text && <CopyButton getText={() => m.content.text ?? ""} label="Salin Jawaban" />}
                        {props.onResendPrompt && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/80 gap-1 rounded-md transition-colors"
                            onClick={() => {
                              const idx = props.messages.findIndex((msg) => msg.id === m.id);
                              if (idx > 0 && props.messages[idx - 1]?.content.text) {
                                props.onResendPrompt?.(props.messages[idx - 1]!.content.text!);
                              }
                            }}
                            title={m.status === "failed" ? "Coba lagi pemeriksaan" : "Kirim ulang pertanyaan ini"}
                          >
                            <RotateCcw className="size-3" />
                            <span>{m.status === "failed" ? "Coba Lagi" : "Regenerate"}</span>
                          </Button>
                        )}
                        {(m.status === "failed" || m.status === "cancelled") && props.onSendToTerminal && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-indigo-500 hover:text-indigo-400 hover:bg-indigo-500/10 gap-1 rounded-md transition-colors"
                            onClick={() => {
                              props.onSendToTerminal?.("/system resource print");
                            }}
                            title="Buka status router di terminal"
                          >
                            <span>Periksa di Terminal</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="flex size-8 shrink-0 select-none items-center justify-center rounded-xl bg-muted text-muted-foreground shadow-xs border border-border/60">
                    <User className="size-4" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Live pipeline for the in-flight run — attached here, not piled at the end later */}
          {props.runLive && !props.liveEvents?.length && liveSteps.length > 0 && (
            <RunPipeline
              steps={liveSteps}
              defaultOpen
              live
              headerRight={
                props.txStatus ? <span className="text-[11px] text-muted-foreground">{props.txStatus}</span> : undefined
              }
            />
          )}

          {props.runLive && (props.streamText || props.liveEvents?.some((e) => e.type.startsWith("tool."))) && (
            <div className="flex gap-3 justify-start animate-in fade-in duration-200">
              <div className="flex size-9 shrink-0 select-none items-center justify-center rounded-xl overflow-hidden ring-1 ring-cyan-500/40 bg-card shadow-xs">
                <img src="/logo.png" alt="MikroTik AI" className="size-full object-contain p-0.5" />
              </div>
              <div className="max-w-[85%] sm:max-w-[80%] rounded-2xl rounded-tl-xs border border-border/70 bg-card/80 px-4 py-3.5 shadow-xs">
                {props.liveEvents?.length ? buildRunTimeline(props.liveEvents, true).map((block) => (
                  <div key={block.key} className="my-2 first:mt-0 last:mb-0">
                    {block.kind === "text" ? <Markdown text={stripAskBlocks(block.text)} onSendToTerminal={props.onSendToTerminal} /> : <RunPipeline steps={block.steps ?? [block.step]} defaultOpen live={(block.steps ?? [block.step]).some((s) => s.status === "running")} />}
                  </div>
                )) : <Markdown text={stripAskBlocks(props.streamText)} onSendToTerminal={props.onSendToTerminal} />}
                <span className="inline-block w-1.5 h-4 bg-cyan-500 animate-pulse ml-1 align-middle" />
              </div>
            </div>
          )}

          {props.runLive && (!props.streamText || props.toolActivity.some((tool) => tool.status === "running")) && (
            <div className="py-3"><ThinkingLogo /></div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>


    </div>
  );
}
