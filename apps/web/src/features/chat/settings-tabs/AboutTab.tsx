import { Server, Info, ExternalLink, Cpu } from "@/components/icons";

export function AboutTab() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="rounded-2xl border border-border/70 bg-card/60 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Cpu className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">MikroTik AI Agent</h2>
            <p className="text-xs text-muted-foreground">Autonomous Network Operations Copilot untuk RouterOS v6 & v7.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-background/60 p-4">
            <span className="text-xs text-muted-foreground">Versi Aplikasi</span>
            <p className="mt-1 text-base font-bold font-mono">v0.1.0 (Dev)</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/60 p-4">
            <span className="text-xs text-muted-foreground">Backend Runtime</span>
            <p className="mt-1 text-base font-bold font-mono">Bun + Hono + SQLite</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-background/60 p-4">
            <span className="text-xs text-muted-foreground">Protokol Router</span>
            <p className="mt-1 text-base font-bold font-mono">SSH2 + Safe Mode</p>
          </div>
        </div>

        <div className="pt-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dokumentasi & Referensi</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href="https://help.mikrotik.com/docs/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              <Server className="size-3.5" />
              MikroTik Help Docs
              <ExternalLink className="size-3" />
            </a>
            <a
              href="https://wiki.mikrotik.com/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              <Info className="size-3.5" />
              MikroTik Wiki
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
