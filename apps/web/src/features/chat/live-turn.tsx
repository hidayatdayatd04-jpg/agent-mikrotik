import { ThinkingLogo } from "./ThinkingLogo";
import { buildRunTimeline } from "./run-timeline";
import { RunPipeline, ResearchCard, type PipelineStep } from "./ToolActivity";
import { LiveTextBlock } from "./LiveTextBlock";
import type { RunEventDTO } from "./chat-hooks";

export function LiveTurn(props: {
  runLive: boolean;
  streamText: string;
  liveEvents?: RunEventDTO[];
  liveSteps: PipelineStep[];
  queueStatus?: string | null;
  txStatus?: string | null;
  onSendToTerminal?: (code: string) => void;
}) {
  const { runLive, streamText, liveEvents, liveSteps } = props;
  const showTurn = runLive && (streamText || liveEvents?.some((e) => e.type.startsWith("tool.")) || liveSteps.length > 0);
  const showThinking = runLive && !streamText && !liveEvents?.some((e) => e.type.startsWith("tool.")) && liveSteps.length === 0;
  return (
    <>
      {/* Live in-flight assistant turn */}
      {showTurn && (
        <div className="flex gap-3 justify-start animate-in fade-in duration-200">
          <div className="flex size-9 shrink-0 select-none items-center justify-center rounded-xl overflow-hidden ring-1 ring-cyan-500/40 bg-card shadow-xs">
            <img src="/logo.png" alt="MikroTik AI" className="size-full object-contain p-0.5" />
          </div>
          <div className="max-w-[85%] sm:max-w-[80%] rounded-2xl rounded-tl-xs border border-border/70 bg-card/80 px-4 py-3.5 shadow-xs">
            {liveEvents?.length ? (
              (() => {
                const blocks = buildRunTimeline(liveEvents, true);
                // Streaming halus diterapkan ke blok TEKS terbaru (bukan blok
                // terakhir apa pun) — kartu research di antara teks tidak
                // boleh mematikan animasi ketik pada teks yang mengikuti.
                const lastTextIdx = blocks.reduce((acc, b, i) => (b.kind === "text" ? i : acc), -1);
                return blocks.map((block, idx) => {
                  return (
                    <div key={block.key} className="my-2 first:mt-0 last:mb-0">
                      {block.kind === "text" ? (
                        <LiveTextBlock
                          text={block.text}
                          isLatest={idx === lastTextIdx}
                          live={runLive}
                          onSendToTerminal={props.onSendToTerminal}
                        />
                      ) : block.kind === "research" ? (
                        <ResearchCard research={block.research} status={block.status} />
                      ) : (
                        <RunPipeline
                          steps={block.steps ?? [block.step]}
                          defaultOpen={false}
                          live={(block.steps ?? [block.step]).some((s) => s.status === "running")}
                        />
                      )}
                    </div>
                  );
                });
              })()
            ) : (
              <>
                {liveSteps.length > 0 && (
                  <div className="mb-2">
                    <RunPipeline steps={liveSteps} defaultOpen={false} live />
                  </div>
                )}
                {streamText ? (
                  <LiveTextBlock text={streamText} isLatest={true} live={runLive} onSendToTerminal={props.onSendToTerminal} />
                ) : null}
              </>
            )}
          </div>
        </div>
      )}

      {showThinking && (
        <div className="py-3" role="status" aria-live="polite">
          <ThinkingLogo />
          {(props.queueStatus || props.txStatus) && (
            <p className="mt-1 text-center text-[11px] text-muted-foreground">{props.queueStatus ?? props.txStatus}</p>
          )}
        </div>
      )}
    </>
  );
}
