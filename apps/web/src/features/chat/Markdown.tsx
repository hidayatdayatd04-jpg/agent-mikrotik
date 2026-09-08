import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkCleanResponse } from "./clean-response";
import { CodeBlock } from "./OutputBlocks";

/** Strip ANSI/OSC escape sequences from model output before render. */
export function sanitizeTerminalText(text: string): string {
  return text
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .slice(0, 20000);
}

export function detectLanguage(code: string): string {
  const t = code.trim().toLowerCase();
  if (t.startsWith("/")) return "RouterOS";
  if (t.includes("{") && t.includes(":")) return "JSON";
  if (t.includes("get-") || t.includes("write-host")) return "PowerShell";
  if (t.includes("#!/bin/bash") || t.startsWith("sudo ")) return "Bash";
  return "Code";
}

export function extractText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: unknown } }).props;
    return extractText(props?.children);
  }
  return "";
}

export function Markdown({
  text,
  onSendToTerminal,
}: {
  text: string;
  onSendToTerminal?: (code: string) => void;
}) {
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
            return (
              <CodeBlock
                language={detectLanguage(codeText)}
                code={codeText}
                onSendToTerminal={onSendToTerminal}
              />
            );
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
