export interface RateLimitModelSnapshot {
  modelKey: string;
  providerKind: string;
  rpmUsed: number;
  rpmLimit: number;
  tpmUsed: number;
  tpmLimit: number;
  rpdStatus: { limit: number | null; remaining: number | null; resetAt: string | null } | null;
  queueLength: number;
  nextRetryAt: string | null;
  blockedReason: string | null;
  fallbackReason: string | null;
  isDailyQuotaExhausted: boolean;
}

export interface RateLimitsResponse {
  defaults: { rpm: number; tpm: number };
  activeModel: string | null;
  activeProviderId: string | null;
  globalQueue: number;
  models: RateLimitModelSnapshot[];
  checkpoints: {
    id: string;
    primaryModelKey: string | null;
    reason: string;
    nextRetryAt: string | null;
    createdAt: string;
  }[];
  note: string;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("id-ID");
  } catch {
    return iso;
  }
}

export function RateLimitStatusPanel({ data, loading }: { data?: RateLimitsResponse | null; loading?: boolean }) {
  if (loading) return <p className="text-xs text-muted-foreground">Memuat status rate limit…</p>;
  if (!data) return <p className="text-xs text-muted-foreground">Status rate limit belum tersedia.</p>;

  return (
    <div className="space-y-3 rounded-xl border p-4" aria-label="Status rate limit AI">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">Model aktif: {data.activeModel ?? "belum ada"}</span>
        <span className="text-muted-foreground">
          Default global (estimasi lokal): {data.defaults.rpm} RPM · {data.defaults.tpm.toLocaleString("id-ID")} TPM
        </span>
        <span className="text-muted-foreground">Antrean global: {data.globalQueue}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Angka RPM/TPM di bawah adalah estimasi lokal (rolling 60 detik), bukan kuota resmi provider. Status RPD hanya
        ditampilkan bila provider menyediakannya.
      </p>

      {data.models.length === 0 && (
        <p className="text-xs text-muted-foreground">Belum ada aktivitas model tercatat.</p>
      )}
      <div className="space-y-2">
        {data.models.map((m) => (
          <div key={m.modelKey} className="rounded-lg border border-border/60 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono font-medium">{m.modelKey}</span>
              {m.isDailyQuotaExhausted ? (
                <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-semibold text-red-600 dark:text-red-400">
                  Kuota harian habis
                </span>
              ) : m.nextRetryAt ? (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-600 dark:text-amber-400">
                  Dibatasi sementara
                </span>
              ) : (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                  Tersedia
                </span>
              )}
            </div>
            <div className="mt-1.5 grid gap-1 text-[11px] text-muted-foreground">
              <span>
                RPM (estimasi lokal): {m.rpmUsed} / {m.rpmLimit} · TPM (estimasi lokal): {m.tpmUsed.toLocaleString("id-ID")} /{" "}
                {m.tpmLimit.toLocaleString("id-ID")}
              </span>
              <span>
                RPD (kuota provider):{" "}
                {m.rpdStatus && (m.rpdStatus.limit !== null || m.rpdStatus.remaining !== null)
                  ? `${m.rpdStatus.remaining ?? "?"} tersisa / ${m.rpdStatus.limit ?? "?"}${m.rpdStatus.resetAt ? ` · reset ${fmtTime(m.rpdStatus.resetAt)}` : ""}`
                  : "tidak disediakan provider"}
              </span>
              <span>Antrean: {m.queueLength} · Retry berikutnya: {fmtTime(m.nextRetryAt)}</span>
              {m.fallbackReason && <span>Alasan fallback: {m.fallbackReason}</span>}
              {m.blockedReason && <span>Penyebab blokir: {m.blockedReason}</span>}
            </div>
          </div>
        ))}
      </div>

      {data.checkpoints.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <p className="font-semibold text-amber-600 dark:text-amber-400">
            {data.checkpoints.length} task menunggu kuota (checkpoint tersimpan, tanpa crash)
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[11px] text-muted-foreground">
            {data.checkpoints.slice(0, 5).map((cp) => (
              <li key={cp.id}>
                {cp.primaryModelKey ?? "model"} · {cp.reason.slice(0, 140)} · retry {fmtTime(cp.nextRetryAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
