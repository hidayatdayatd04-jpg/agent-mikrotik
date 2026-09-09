import { Check, MessageCircleQuestion, Send } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { isOptionRecommended, type AskSpec } from "./ask-card";
import { useAskCard } from "./use-ask-card";

/**
 * Interactive Q&A pop-up card. Each question offers tappable options.
 * All answers are collected first, then sent as ONE combined message
 * when the user clicks "Kirim Jawaban". This avoids multiple round-trips
 * where each click would trigger a separate agent run.
 *
 * If any option has `recommended: true` (or "(rekomendasi)" in label),
 * a "Terapkan Rekomendasi" button auto-selects all recommended options in one click.
 */
export function AskCard({ spec, onAnswer }: { spec: AskSpec; onAnswer: (label: string) => void }) {
  const {
    selected,
    submitted,
    totalQuestions,
    answeredCount,
    allAnswered,
    hasRecommended,
    allRecommendedSelected,
    choose,
    applyRecommended,
    handleSubmit,
  } = useAskCard(spec, onAnswer);

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-indigo-500/40 bg-indigo-500/5 shadow-xs" role="group" aria-label="Pertanyaan dari AI">
      <div className="flex items-center gap-2 border-b border-indigo-500/25 bg-indigo-500/10 px-3.5 py-2">
        <MessageCircleQuestion className="size-4 text-indigo-500" aria-hidden />
        <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
          Perlu keputusanmu ({totalQuestions} pertanyaan)
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!submitted && answeredCount > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {answeredCount}/{totalQuestions} dijawab
            </span>
          )}
          {/* "Terapkan Rekomendasi" quick-fill button */}
          {!submitted && hasRecommended && !allRecommendedSelected && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={applyRecommended}
              className="h-6 gap-1 rounded-full px-2 text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 hover:text-amber-500 transition-colors"
              title="Pilih opsi yang direkomendasikan"
            >
              Terapkan Rekomendasi
            </Button>
          )}
          {!submitted && hasRecommended && allRecommendedSelected && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              <Check className="size-2.5" aria-hidden />
              Rekomendasi terpilih
            </span>
          )}
        </div>
      </div>
      <div className="space-y-4 p-3.5">
        {spec.questions.map((q, qi) => {
          const picked = selected[q.id]?.optionId ?? null;
          return (
            <div key={q.id} className="space-y-2">
              <p className="text-sm font-medium leading-relaxed text-foreground">
                <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-full bg-indigo-500/15 text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                  {qi + 1}
                </span>
                {q.text}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((o) => {
                  const isPicked = picked === o.id;
                  const isOther = !!picked && !isPicked;
                  const isRec = isOptionRecommended(o);
                  return (
                    <Button
                      key={o.id}
                      type="button"
                      size="sm"
                      variant={isPicked ? "default" : "outline"}
                      disabled={submitted}
                      onClick={() => choose(q.id, o.id, o.label)}
                      className={`h-7 gap-1 rounded-full text-xs transition-all ${
                        isPicked
                          ? "bg-indigo-600 text-white hover:bg-indigo-600"
                          : submitted
                            ? "opacity-40"
                            : isOther
                              ? "opacity-50 hover:opacity-80"
                              : isRec
                                ? "border-amber-500/50 bg-amber-500/5 hover:bg-amber-500/15 hover:border-amber-500 text-amber-700 dark:text-amber-400"
                                : "border-indigo-500/40 hover:bg-indigo-500/10 hover:border-indigo-500"
                      }`}
                    >
                      {isPicked && <Check className="size-3" aria-hidden />}
                      {o.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Submit button — appears after all questions answered */}
        {!submitted && (
          <div className="flex items-center justify-between pt-1 border-t border-indigo-500/15">
            <p className="text-[11px] text-muted-foreground">
              {allAnswered ? "Siap dikirim." : "Ketuk jawaban tiap pertanyaan, atau tulis manual di kolom chat."}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={!allAnswered}
              onClick={handleSubmit}
              className={`h-7 gap-1.5 rounded-full text-xs transition-all ${
                allAnswered
                  ? "bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm"
                  : "opacity-40 cursor-not-allowed"
              }`}
            >
              <Send className="size-3" aria-hidden />
              Kirim Jawaban
            </Button>
          </div>
        )}

        {/* Submitted confirmation */}
        {submitted && (
          <div className="flex items-center gap-2 pt-1 border-t border-emerald-500/20">
            <Check className="size-3.5 text-emerald-500" aria-hidden />
            <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Jawaban terkirim.</p>
          </div>
        )}
      </div>
    </div>
  );
}
