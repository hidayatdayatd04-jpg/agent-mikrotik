import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePreferences, useSavePreferences, useCompactionStatus } from "@/features/chat/chat-hooks";

export function ContextSection() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  // Show last compaction status for active conversation? Use global explanation + per-chat via header.
  const status = useCompactionStatus(null);
  void status;
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6">
      <h2 className="text-base font-semibold">Konteks / compact</h2>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Compact meringkas history yang dikirim ke model agar percakapan dapat berlanjut. History asli tidak dihapus, transcript visual tidak dipotong,
        dan export tetap lengkap. Ambang awal 80% dari input budget efektif; target setelah compact 50–60%.
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">Compact otomatis (default ON)</span>
        <Switch checked={prefs.data?.autoCompact ?? true} onCheckedChange={(v) => save.mutate({ autoCompact: v })} aria-label="Compact otomatis" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="compact-threshold" className="text-xs font-medium">
          Ambang pemakaian ({prefs.data?.compactThreshold ?? 80}%)
        </label>
        <Input
          id="compact-threshold"
          type="number"
          min={50}
          max={95}
          value={prefs.data?.compactThreshold ?? 80}
          onChange={(e) => save.mutate({ compactThreshold: Number(e.target.value) || 80 })}
        />
      </div>
    </div>
  );
}
