import { Button } from "@/components/ui/button";
import { FileText, RotateCcw } from "@/components/icons";
import type { MessageDTO, ActivityEventDTO } from "./chat-hooks";
import { buildRunTimeline } from "./run-timeline";
import { RunPipeline, buildPipeline, ResearchCard } from "./ToolActivity";
import { AssistantBody } from "./AssistantBody";
import { CopyButton } from "./CopyButton";

export function AssistantMessage(props: {
  m: MessageDTO;
  messages: MessageDTO[];
  runActs: ActivityEventDTO[] | undefined;
  onAnswerAsk?: (label: string) => void;
  onSendToTerminal?: (code: string) => void;
  onResendPrompt?: (prompt: string) => void;
  activeConnectionId?: string | null;
  conversationId?: string | null;
}) {
  const { m } = props;
  const pipeline = props.runActs && props.runActs.length > 0 ? buildPipeline(props.runActs) : null;
  const showPipeline = !!pipeline && pipeline.steps.length > 0;
  const timeline = m.content.timeline?.length ? buildRunTimeline(m.content.timeline) : null;
  // Status run keseluruhan: pipeline tool yang selesai tidak boleh
  // berlabel "Selesai" bila jawaban akhirnya gagal/dibatalkan.
  const overall = m.status === "failed" ? ("failed" as const) : m.status === "cancelled" ? ("cancelled" as const) : null;

  return (
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

        {timeline ? (
          timeline.map((block) => (
            <div key={block.key} className="my-2 first:mt-0 last:mb-0">
              {block.kind === "text" ? (
                <AssistantBody
                  text={block.text}
                  onAnswerAsk={props.onAnswerAsk}
                  onSendToTerminal={props.onSendToTerminal}
                  activeConnectionId={props.activeConnectionId}
                  conversationId={props.conversationId}
                />
              ) : block.kind === "research" ? (
                <ResearchCard research={block.research} status={block.status} />
              ) : (
                <RunPipeline steps={block.steps ?? [block.step]} defaultOpen={false} overall={overall} />
              )}
            </div>
          ))
        ) : (
          <>
            {showPipeline && (
              <div className="mb-3">
                <RunPipeline steps={pipeline!.steps} tx={pipeline!.tx} defaultOpen={false} overall={overall} />
              </div>
            )}
            {m.content.text ? (
              <AssistantBody
                text={m.content.text}
                onAnswerAsk={props.onAnswerAsk}
                onSendToTerminal={props.onSendToTerminal}
                activeConnectionId={props.activeConnectionId}
                conversationId={props.conversationId}
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                {m.status === "cancelled" ? "Jawaban dihentikan." : "Tidak ada teks jawaban."}
              </span>
            )}
          </>
        )}

        {m.status && m.status !== "complete" && m.status !== "completed" && (
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            Status: {m.status === "failed" ? "Gagal" : m.status === "cancelled" ? "Dibatalkan" : m.status}
          </p>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-start gap-2 text-[11px] text-muted-foreground">
        {m.content.text && <CopyButton getText={() => m.content.text ?? ""} label="Salin Jawaban" />}
        {props.onResendPrompt && m.status !== "failed" && m.status !== "cancelled" && (
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
            title="Kirim ulang pertanyaan ini"
          >
            <RotateCcw className="size-3" />
            <span>Regenerate</span>
          </Button>
        )}
      </div>
    </div>
  );
}
