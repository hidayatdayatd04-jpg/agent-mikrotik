import { CheckCircle2 } from "@/components/icons";

export function ProviderRemoteModels(props: {
  remoteModels: { id: string; label?: string }[] | null;
  models: string[];
  onAdd: (m: string) => void;
}) {
  const { remoteModels, models, onAdd } = props;
  if (!remoteModels || remoteModels.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
      <span className="text-xs font-semibold flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5" />
        Ditemukan {remoteModels.length} Model dari Provider (Klik untuk menambahkan):
      </span>
      <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
        {remoteModels.map((m) => {
          const alreadyAdded = models.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onAdd(m.id)}
              disabled={alreadyAdded}
              className={`w-full flex items-center justify-between rounded px-2 py-1 text-xs text-left transition-colors ${
                alreadyAdded ? "bg-muted/40 text-muted-foreground cursor-default" : "hover:bg-indigo-500/10 text-foreground"
              }`}
            >
              <span className="font-mono text-[11px] truncate">{m.id}</span>
              {alreadyAdded ? (
                <span className="text-[10px] text-muted-foreground">Sudah ada</span>
              ) : (
                <span className="text-[10px] text-indigo-500 font-medium">+ Tambah</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
