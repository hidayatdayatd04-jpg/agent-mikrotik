import type { ModelLimitStatus } from "@shared/index";

export function modelLimitLabel(data?: ModelLimitStatus, now = Date.now()): string {
  if (!data) return "Belum diketahui";
  if (data.retryAt && Date.parse(data.retryAt) <= now) return "Waktu tunggu lewat · coba ulang";
  if (now - Date.parse(data.observedAt) > 15 * 60_000) return "Data lama · coba ulang";
  return data.status === "limited" ? "Terkena limit" : data.status === "available" ? "Permintaan terakhir berhasil" : "Permintaan terakhir gagal";
}

export function ModelLimitIndicator({ data, compact = false }: { data?: ModelLimitStatus; compact?: boolean }) {
  const label = modelLimitLabel(data);
  const fresh = data && Date.now() - Date.parse(data.observedAt) <= 15 * 60_000 && (!data.retryAt || Date.parse(data.retryAt) > Date.now());
  return <div className="space-y-1 text-[10px] font-sans font-normal text-muted-foreground">
    <span className={fresh && data.status === "limited" ? "text-amber-600 dark:text-amber-400" : ""}>{label}</span>
    {!compact && <>
      {fresh && data && [["Permintaan", data.requestsLimit, data.requestsRemaining], ["Token", data.tokensLimit, data.tokensRemaining]].map(([title, limit, remaining]) => {
        if (typeof limit !== "number" || typeof remaining !== "number" || limit <= 0) return null;
        const used = Math.min(limit, Math.max(0, limit - remaining));
        return <div key={title}>
          <div>{title}: {used} / {limit} terpakai ({Math.round(used / limit * 100)}%) · jendela kuota provider</div>
          <progress aria-label={`Kuota ${title}`} value={used} max={limit} className="h-1.5 w-full accent-indigo-500" />
        </div>;
      })}
      {data?.retryAt && Date.parse(data.retryAt) > Date.now() && <p>Coba lagi setelah {new Date(data.retryAt).toLocaleString("id-ID")}</p>}
      {data && <p>Terakhir diperiksa: {new Date(data.observedAt).toLocaleString("id-ID")}</p>}
      {(!fresh || (data?.requestsLimit == null && data?.tokensLimit == null)) && <p>Persentase kuota belum tersedia dari provider.</p>}
    </>}
  </div>;
}
