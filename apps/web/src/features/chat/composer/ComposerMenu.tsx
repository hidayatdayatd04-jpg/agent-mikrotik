import { Button } from "@/components/ui/button";
import { Loader2, Plus, FileText, ImagePlus, ShieldCheck, Scissors } from "@/components/icons";
import { ConnectorPicker } from "../ConnectorPicker";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import type { ConnectorDTO } from "@shared/index";

export function ComposerMenu(props: {
  uploading: boolean;
  running: boolean;
  connectors: ConnectorDTO[];
  selectedId: string | null;
  onSelectConnector?: (id: string) => void;
  onAddRouter?: () => void;
  uploadDisabled: boolean;
  onPickFile: (images: boolean) => void;
  writeEnabled: boolean;
  onToggleWrite: (enabled: boolean) => void;
  writeDisabled: boolean;
  onCompact?: () => void;
  connector?: ConnectorDTO | null;
}) {
  const { connector, writeEnabled } = props;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer"
          aria-label="Lampiran, connector, izin, dan Tambah router"
          title="Lampiran, connector, izin, dan Tambah router"
        >
          {props.uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={12}
        className="w-84 max-w-[calc(100vw-2rem)] rounded-2xl border border-border/60 bg-popover/95 p-2 shadow-xl backdrop-blur-md"
      >
        <ConnectorPicker
          connectors={props.connectors}
          selectedId={props.selectedId}
          onSelect={(id) => props.onSelectConnector?.(id)}
          onAddRouter={() => props.onAddRouter?.()}
          disabled={props.running}
        />
        <DropdownMenuItem disabled={props.uploadDisabled} onSelect={() => props.onPickFile(false)} className="gap-3 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
          <FileText className="size-4 text-muted-foreground" />
          Tambahkan file
        </DropdownMenuItem>
        <DropdownMenuItem disabled={props.uploadDisabled} onSelect={() => props.onPickFile(true)} className="gap-3 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
          <ImagePlus className="size-4 text-muted-foreground" />
          Tambahkan gambar
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuCheckboxItem
          checked={writeEnabled}
          onCheckedChange={props.onToggleWrite}
          onSelect={(event) => event.preventDefault()}
          disabled={props.writeDisabled}
          className="gap-2 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
        >
          <ShieldCheck className="size-4 text-amber-500" />
          <span className="flex-1 text-xs">Izinkan perubahan</span>
          <span
            aria-hidden="true"
            className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${writeEnabled ? "bg-amber-500" : "bg-muted-foreground/25"}`}
          >
            <span className={`size-4 rounded-full bg-white shadow-sm transition-transform ${writeEnabled ? "translate-x-4" : "translate-x-0"}`} />
          </span>
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem onSelect={() => props.onCompact?.()} className="gap-3 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
          <Scissors className="size-4 text-muted-foreground" /> Compact percakapan
        </DropdownMenuItem>
        <p className="px-2 pt-1 pb-1 text-[11px] leading-relaxed text-muted-foreground/80">
          {!connector
            ? "Belum terhubung — chat umum tetap berfungsi."
            : writeEnabled
              ? "Perubahan melalui transaksi Safe Mode."
              : "Read-only. Konfigurasi router tidak diubah."}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
