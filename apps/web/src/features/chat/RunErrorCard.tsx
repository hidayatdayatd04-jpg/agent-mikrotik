import { Button } from "@/components/ui/button";
import { RotateCcw, TriangleAlertIcon } from "@/components/icons";
import { runErrorHint, runErrorProgress, runErrorTitle, type RunErrorInfo } from "./run-error";

/**
 * Kartu error run — tampilan khusus yang BERBEDA dari bubble chat.
 * Dipakai untuk kegagalan provider/limit/kuota agar detail error tidak
 * tercampur dengan jawaban AI. Satu tombol "Coba lagi" otomatis mengirim
 * "continue" agar run meneruskan sisa yang belum selesai (lihat resume
 * assist di backend), bukan mengulang dari nol.
 */
export function RunErrorCard(props: {
  error: RunErrorInfo;
  onRetry?: () => void;
}) {
  const { error } = props;
  const hint = runErrorHint(error.code);
  const progress = runErrorProgress(error);
  return (
    <div
      role="alert"
      aria-live="polite"
      className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3.5 dark:bg-rose-500/[0.1]"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-rose-500/15">
          <TriangleAlertIcon className="size-4 text-rose-600 dark:text-rose-400" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{runErrorTitle(error.code)}</p>
            <span className="rounded-md bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-rose-600 dark:text-rose-400">
              {error.code}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground/80">{error.reason}</p>
          {progress && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{progress}</p>}
          {hint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
          {props.onRetry && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-xl border-rose-500/30 text-xs hover:bg-rose-500/10"
                onClick={props.onRetry}
                title="Lanjutkan otomatis sisa pekerjaan yang belum selesai"
              >
                <RotateCcw className="size-3.5" />
                <span>Coba lagi</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
