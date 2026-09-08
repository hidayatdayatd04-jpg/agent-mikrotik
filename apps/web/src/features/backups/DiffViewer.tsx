import { useState } from "react";
import type { DiffResult } from "@shared/index";

export function DiffViewer({ diff }: { diff: DiffResult }) {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  return (
    <div className="flex flex-col rounded-xl border border-border/60 bg-card overflow-hidden">
      {/* Diff Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border/50 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-foreground">Perbandingan Konfigurasi</span>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
              +{diff.added} baris
            </span>
            <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
              -{diff.removed} baris
            </span>
          </div>
        </div>

        <div className="flex items-center bg-background rounded-lg p-0.5 border border-border/50">
          <button
            type="button"
            onClick={() => setViewMode("unified")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
              viewMode === "unified"
                ? "bg-accent text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Unified
          </button>
          <button
            type="button"
            onClick={() => setViewMode("split")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
              viewMode === "split"
                ? "bg-accent text-foreground font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Side-by-Side
          </button>
        </div>
      </div>

      {/* Diff Body */}
      <div className="max-h-[500px] overflow-auto font-mono text-xs leading-relaxed p-2">
        {diff.lines.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            Tidak ada perbedaan konfigurasi.
          </div>
        ) : viewMode === "unified" ? (
          <div className="divide-y divide-border/20">
            {diff.lines.map((line, idx) => {
              const isAdded = line.type === "added";
              const isRemoved = line.type === "removed";
              const rowStyle = isAdded
                ? "bg-emerald-500/10 text-emerald-950 dark:text-emerald-200"
                : isRemoved
                  ? "bg-rose-500/10 text-rose-950 dark:text-rose-200"
                  : "text-foreground/90";

              return (
                <div key={idx} className={`flex items-start px-2 py-0.5 hover:bg-accent/40 ${rowStyle}`}>
                  <span className="w-9 shrink-0 text-right pr-2 text-muted-foreground/60 select-none text-[10px]">
                    {line.lineNumber.left ?? ""}
                  </span>
                  <span className="w-9 shrink-0 text-right pr-2 text-muted-foreground/60 select-none text-[10px]">
                    {line.lineNumber.right ?? ""}
                  </span>
                  <span className="w-5 shrink-0 text-center select-none font-bold">
                    {isAdded ? "+" : isRemoved ? "-" : " "}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all">{line.content}</span>
                </div>
              );
            })}
          </div>
        ) : (
          /* Split View */
          <div className="grid grid-cols-2 divide-x divide-border/40">
            <div className="space-y-0.5">
              <div className="text-[10px] font-bold text-muted-foreground px-2 py-1 bg-muted/20 border-b border-border/30">
                Sebelumnya / Live
              </div>
              {diff.lines.filter((l) => l.type !== "added").map((line, idx) => (
                <div
                  key={idx}
                  className={`flex items-start px-2 py-0.5 ${
                    line.type === "removed" ? "bg-rose-500/10 text-rose-950 dark:text-rose-200" : ""
                  }`}
                >
                  <span className="w-8 shrink-0 text-right pr-2 text-muted-foreground/60 select-none text-[10px]">
                    {line.lineNumber.left ?? ""}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all">{line.content}</span>
                </div>
              ))}
            </div>

            <div className="space-y-0.5 pl-1">
              <div className="text-[10px] font-bold text-muted-foreground px-2 py-1 bg-muted/20 border-b border-border/30">
                Backup Terpilih
              </div>
              {diff.lines.filter((l) => l.type !== "removed").map((line, idx) => (
                <div
                  key={idx}
                  className={`flex items-start px-2 py-0.5 ${
                    line.type === "added" ? "bg-emerald-500/10 text-emerald-950 dark:text-emerald-200" : ""
                  }`}
                >
                  <span className="w-8 shrink-0 text-right pr-2 text-muted-foreground/60 select-none text-[10px]">
                    {line.lineNumber.right ?? ""}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all">{line.content}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
