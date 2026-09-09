import { Plus, FileDiff, Search, X, RefreshCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BackupActionsBar(props: {
  newBackupName: string;
  onNameChange: (v: string) => void;
  onCreate: () => void;
  createDisabled: boolean;
  creating: boolean;
  compareCount: number;
  onCompare: () => void;
  search: string;
  onSearch: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border/60 p-4 rounded-2xl shadow-xs">
      {/* Create Backup Input */}
      <div className="flex items-center gap-2 flex-1 max-w-md">
        <Input
          value={props.newBackupName}
          onChange={(e) => props.onNameChange(e.target.value)}
          placeholder="Nama backup opsional (mis. Sebelum Upgrade)..."
          className="h-9 text-xs"
          disabled={props.createDisabled}
        />
        <Button
          size="sm"
          onClick={props.onCreate}
          disabled={props.createDisabled}
          className="gap-1.5 text-xs h-9 shrink-0 cursor-pointer"
        >
          {props.creating ? <RefreshCw className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Buat Snapshot
        </Button>
      </div>

      {/* Compare Two Button */}
      <div className="flex items-center gap-3">
        {props.compareCount === 2 && (
          <Button
            size="sm"
            variant="default"
            onClick={props.onCompare}
            className="gap-1.5 text-xs h-9 bg-cyan-600 hover:bg-cyan-700 text-white cursor-pointer"
          >
            <FileDiff className="size-3.5" />
            Bandingkan 2 Terpilih ({props.compareCount})
          </Button>
        )}

        <div className="relative w-60">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={props.search}
            onChange={(e) => props.onSearch(e.target.value)}
            placeholder="Cari file backup…"
            className="h-9 rounded-xl pl-8 text-xs border-border/60 bg-muted/30"
          />
          {props.search && (
            <button
              type="button"
              onClick={() => props.onSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
