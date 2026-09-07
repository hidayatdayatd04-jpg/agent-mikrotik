import { Menu, TerminalSquare, Download, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ChatHeader(props: {
  title: string;
  onToggleSidebar: () => void;
  onOpenTerminal: () => void;
  onExport: () => void;
  onRename: () => void;
  onPin: () => void;
  pinned: boolean;
  onArchive: () => void;
  archived: boolean;
  onCompact: () => void;
  onDelete: () => void;
  compactBusy?: boolean;
}) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-2 bg-transparent px-3 py-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={props.onToggleSidebar} aria-label="Buka/tutup sidebar">
          <Menu className="size-4" />
        </Button>
        <h1 className="truncate text-sm font-semibold">{props.title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={props.onOpenTerminal} aria-label="Buka terminal">
          <TerminalSquare className="size-4" />
          <span className="hidden sm:inline">Terminal</span>
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={props.onExport} aria-label="Export Markdown">
          <Download className="size-4" />
          <span className="hidden sm:inline">Export .md</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Menu percakapan">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={props.onRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={props.onPin}>{props.pinned ? "Lepas pin" : "Pin"}</DropdownMenuItem>
            <DropdownMenuItem onClick={props.onArchive}>{props.archived ? "Pulihkan dari arsip" : "Arsipkan"}</DropdownMenuItem>
            <DropdownMenuItem onClick={props.onCompact} disabled={props.compactBusy}>
              Compact percakapan
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={props.onExport}>Export Markdown</DropdownMenuItem>
            <DropdownMenuItem onClick={props.onDelete} className="text-destructive">
              Hapus
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
