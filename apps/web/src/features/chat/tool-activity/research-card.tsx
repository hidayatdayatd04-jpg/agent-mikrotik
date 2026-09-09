import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Globe, ExternalLink } from "@/components/icons";
import type { ResearchResult } from "@shared/index";

/**
 * Kartu Deep Research — tampilan khusus hasil tool web:search di chat canvas.
 * Sengaja DIBEDAKAN dari pipeline tool router (RunPipeline): isi berupa kartu
 * sumber yang bisa diklik (judul + domain + cuplikan), bukan output monokrom.
 */
export function ResearchCard(props: { research: ResearchResult | null; status: "running" | "completed" | "failed" }) {
  const [open, setOpen] = useState(props.status === "running");
  useEffect(() => {
    // Saat riset selesai, kartu otomatis diciutkan — header tetap menunjukkan
    // jumlah sumber; pengguna bisa membuka kembali kapan pun.
    if (props.status !== "running") setOpen(false);
  }, [props.status]);
  const research = props.research;
  const sources = research?.sources ?? [];
  const domainOf = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };
  const statusLabel =
    props.status === "running" ? "Menelusuri…" : props.status === "failed" ? "Gagal" : `${sources.length} sumber`;
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.04]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs"
        aria-expanded={open}
        aria-label="Detail Deep Research"
      >
        <span className="flex min-w-0 items-center gap-2 font-medium">
          {props.status === "running" ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-indigo-500" />
          ) : (
            <Globe className="size-3.5 shrink-0 text-indigo-500" />
          )}
          <span className="truncate">Deep Research{research?.query ? ` · ${research.query}` : ""}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={
              props.status === "failed" ? "text-destructive" : props.status === "running" ? "text-indigo-500" : "text-emerald-600 dark:text-emerald-400"
            }
          >
            {statusLabel}
          </span>
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-indigo-500/20 px-3 py-2.5">
          {props.status === "failed" && <p className="text-xs text-destructive">Pencarian web gagal dijalankan.</p>}
          {props.status === "running" && sources.length === 0 && (
            <p className="text-xs text-muted-foreground">Mencari informasi terkini di internet…</p>
          )}
          {research?.answer && (
            <p className="rounded-lg bg-background/70 px-2.5 py-2 text-xs leading-relaxed text-foreground/90">{research.answer}</p>
          )}
          {sources.map((s, i) => (
            <a
              key={`${s.url}-${i}`}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-border/60 bg-background/70 px-2.5 py-2 transition-colors hover:border-indigo-500/40 hover:bg-background"
            >
              <span className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                <Globe className="size-3 shrink-0" />
                <span className="truncate">{s.title || domainOf(s.url)}</span>
                <ExternalLink className="size-3 shrink-0 opacity-60" />
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{domainOf(s.url)}</span>
              {s.snippet && <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground">{s.snippet}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
