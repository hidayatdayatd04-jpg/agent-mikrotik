import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Loader2, Square, Wrench, Check, Copy, ArrowDown } from "lucide-react";
import type { MessageDTO } from "./chat-hooks";

export interface ToolActivity {
  name: string;
  status: "running" | "done" | "failed";
}

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label="Salin kode"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </Button>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-muted prose-pre:rounded-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            // only http(s) links are rendered; other schemes are dropped
            const safe = href && /^https?:\/\//i.test(href) ? href : undefined;
            if (!safe) return <>{children}</>;
            return (
              <a href={safe} target="_blank" rel="noreferrer noopener" className="underline">
                {children}
              </a>
            );
          },
          pre: ({ children }) => {
            const codeText = extractText(children);
            return (
              <div className="group relative">
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{children}</pre>
                <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <CopyButton getText={() => codeText} />
                </div>
              </div>
            );
          },
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return <code className={className} {...props}>{children}</code>;
            }
            return <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]" {...props}>{children}</code>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Recursively extract raw text from React children of a <pre> block. */
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

function ToolRow({ activity }: { activity: ToolActivity }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
      {activity.status === "running" ? (
        <Loader2 className="size-3.5 animate-spin" aria-label="tool berjalan" />
      ) : (
        <Wrench className="size-3.5" aria-hidden />
      )}
      <span className="font-mono text-xs">
        {activity.name}
        {activity.status === "failed" ? " — gagal/ ditolak" : activity.status === "done" ? " — selesai" : ""}
      </span>
    </div>
  );
}

export function ChatPanel(props: {
  messages: MessageDTO[];
  streamText: string;
  toolActivity: ToolActivity[];
  runLive: boolean;
  onCancel: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
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
  }, [props.messages.length, props.streamText, props.toolActivity.length]);

  return (
    <div className="relative flex h-full flex-col">
      {showJump && (
        <Button
          variant="outline"
          size="sm"
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 gap-1.5 rounded-full shadow-md"
          onClick={() => {
            nearBottomRef.current = true;
            setShowJump(false);
            bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
          }}
          aria-label="Lompat ke pesan terbaru"
        >
          <ArrowDown className="size-3.5" aria-hidden />
          Ke pesan terbaru
        </Button>
      )}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {props.messages.length === 0 && !props.runLive && (
            <div className="mx-auto mt-16 max-w-md text-center text-muted-foreground">
              <p className="text-lg font-medium text-foreground">MikroTik AI Agent</p>
              <p className="mt-2">
                Tanyakan apa pun tentang RouterOS — konfigurasi, dokumentasi, atau analisis config. Hubungkan router
                lewat menu Connector untuk operasi perangkat.
              </p>
            </div>
          )}
          {props.messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground whitespace-pre-wrap"
                    : "max-w-[85%]"
                }
              >
                {m.role === "assistant" ? (
                  <>
                    {m.content.attachments && m.content.attachments.length > 0 && (
                      <div className="mb-1 flex flex-wrap gap-1">
                        {m.content.attachments.map((a) => (
                          <span key={a.id} className="rounded bg-muted px-2 py-0.5 text-xs">
                            {a.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.content.text ? (
                      <Markdown text={m.content.text} />
                    ) : (
                      <span className="text-sm text-muted-foreground">…</span>
                    )}
                    {m.status && m.status !== "complete" && m.status !== "completed" && (
                      <p className="mt-1 text-xs text-muted-foreground">status: {m.status}</p>
                    )}
                  </>
                ) : (
                  <>
                    {m.content.text}
                    {m.content.attachments && m.content.attachments.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {m.content.attachments.map((a) => (
                          <span key={a.id} className="rounded bg-primary-foreground/15 px-2 py-0.5 text-xs">
                            {a.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}

          {props.toolActivity.length > 0 &&
            props.toolActivity.map((t, i) => <ToolRow key={`${t.name}-${i}`} activity={t} />)}

          {props.streamText && (
            <div className="flex justify-start">
              <div className="max-w-[85%]">
                <Markdown text={props.streamText} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      {props.runLive && (
        <div className="border-t px-4 py-2">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Agent sedang bekerja…
            </span>
            <Button variant="outline" size="sm" onClick={props.onCancel} className="gap-1.5">
              <Square className="size-3" aria-hidden />
              Stop
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
