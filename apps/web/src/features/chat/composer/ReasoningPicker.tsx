import { Brain, Check } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { REASONING_EFFORTS, reasoningEffortHint, reasoningEffortLabel, type ReasoningEffort } from "@shared/index";
import type { ComposerReasoning } from "./use-composer-reasoning";

/**
 * Pemilih upaya penalaran di composer chat. Hanya dirender bila model
 * aktif mendukung reasoning (induk menyembunyikan bila tidak didukung).
 */
export function ReasoningPicker(props: { reasoning: ComposerReasoning }) {
  const { reasoning } = props;
  if (!reasoning.supported) return null;
  const current = reasoning.effort;
  const active = current !== undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex h-8 items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none cursor-pointer ${
            active
              ? "border-violet-500/50 bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/15"
              : "border-border/70 bg-muted/40 text-foreground hover:bg-muted"
          }`}
          title={active ? `Reasoning: ${reasoningEffortLabel(current)}` : "Reasoning mati — klik untuk atur upaya penalaran"}
          aria-label="Pilih upaya penalaran"
        >
          <Brain className="size-3.5 shrink-0" />
          <span className="text-[11px] font-medium">{active ? reasoningEffortLabel(current) : "Reasoning"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-64 rounded-2xl border border-border/60 bg-popover bg-clip-padding p-1.5 shadow-xl ring-0">
        <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
          Upaya penalaran
        </p>
        <DropdownMenuItem
          onSelect={() => reasoning.setEffort(null)}
          className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-[13px] cursor-pointer select-none ${
            current === undefined ? "bg-violet-500/10 font-medium text-violet-600 dark:text-violet-400" : "text-foreground/90 hover:bg-muted"
          }`}
        >
          <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
            <span>Mati</span>
            <span className="text-[11px] font-normal text-muted-foreground">Tanpa penalaran ekstra.</span>
          </span>
          {current === undefined && <Check className="size-4 shrink-0" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1" />
        {REASONING_EFFORTS.map((level: ReasoningEffort) => {
          const isSelected = current === level;
          return (
            <DropdownMenuItem
              key={level}
              onSelect={() => reasoning.setEffort(level)}
              className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-[13px] cursor-pointer select-none ${
                isSelected ? "bg-violet-500/10 font-medium text-violet-600 dark:text-violet-400" : "text-foreground/90 hover:bg-muted"
              }`}
            >
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span>{reasoningEffortLabel(level)}</span>
                <span className="text-[11px] font-normal text-muted-foreground">{reasoningEffortHint(level)}</span>
              </span>
              {isSelected && <Check className="size-4 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
        <p className="px-2.5 pt-1.5 pb-1 text-[11px] leading-relaxed text-muted-foreground/80">
          Hanya muncul untuk model yang mendukung reasoning.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
