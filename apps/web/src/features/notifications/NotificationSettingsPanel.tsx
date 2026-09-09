import { X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotificationSettings, useUpdateNotificationSettings } from "./notification-hooks";

export function NotificationSettingsPanel(props: {
  settings: ReturnType<typeof useNotificationSettings>;
  updateSettings: ReturnType<typeof useUpdateNotificationSettings>;
  onClose: () => void;
}) {
  const { settings, updateSettings, onClose } = props;
  return (
    <aside className="w-80 border-l border-border/60 bg-sidebar/50 p-5 overflow-y-auto">
      <div className="flex items-center justify-between pb-3 border-b border-border/50">
        <h2 className="text-sm font-bold">Pengaturan Ambang Batas</h2>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-4 space-y-4 text-xs">
        <div>
          <label className="block font-semibold mb-1">Ambang CPU (Warning/Kritis)</label>
          <div className="flex items-center gap-2">
            <Input type="number" min={10} max={100} defaultValue={settings.data?.cpuThreshold ?? 90} className="h-8 text-xs" id="cpu-threshold-input" />
            <span className="text-muted-foreground">%</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Alert dipicu jika beban CPU melebihi nilai ini.</p>
        </div>

        <div>
          <label className="block font-semibold mb-1">Ambang RAM (Memory)</label>
          <div className="flex items-center gap-2">
            <Input type="number" min={10} max={100} defaultValue={settings.data?.ramThreshold ?? 85} className="h-8 text-xs" id="ram-threshold-input" />
            <span className="text-muted-foreground">%</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Alert dipicu jika penggunaan RAM melebihi nilai ini.</p>
        </div>

        <div>
          <label className="block font-semibold mb-1">Cooldown Deduplikasi</label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={60}
              defaultValue={Math.round((settings.data?.cooldownMs ?? 300_000) / 60_000)}
              className="h-8 text-xs"
              id="cooldown-input"
            />
            <span className="text-muted-foreground">menit</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Jeda minimum agar alert yang sama tidak berulang.</p>
        </div>

        <Button
          size="sm"
          className="w-full mt-4 cursor-pointer"
          onClick={() => {
            const cpu = parseInt((document.getElementById("cpu-threshold-input") as HTMLInputElement)?.value ?? "90", 10);
            const ram = parseInt((document.getElementById("ram-threshold-input") as HTMLInputElement)?.value ?? "85", 10);
            const cd = parseInt((document.getElementById("cooldown-input") as HTMLInputElement)?.value ?? "5", 10) * 60_000;
            updateSettings.mutate({ cpuThreshold: cpu, ramThreshold: ram, cooldownMs: cd });
          }}
        >
          Simpan Preferensi
        </Button>
      </div>
    </aside>
  );
}
