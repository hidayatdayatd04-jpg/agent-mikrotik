import {
  TerminalSquare,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Archive,
  Scissors,
  Download,
  Trash2,
} from "@/components/icons";
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
  onToggleSidebar?: () => void;
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
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-background/80 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-sm font-semibold tracking-tight text-foreground" title={props.title}>
          {props.title}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 rounded-xl px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
          onClick={props.onOpenTerminal}
          aria-label="Buka terminal"
        >
          <TerminalSquare className="size-4" />
          <span className="hidden sm:inline">Terminal</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
              aria-label="Menu percakapan"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-2xl border border-border/60 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md">
            <DropdownMenuItem onClick={props.onRename} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
              <Pencil className="size-4 text-muted-foreground" />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.onPin} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
              {props.pinned ? <PinOff className="size-4 text-amber-500" /> : <Pin className="size-4 text-muted-foreground" />}
              <span>{props.pinned ? "Lepas pin" : "Pin"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.onArchive} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
              <Archive className="size-4 text-muted-foreground" />
              <span>{props.archived ? "Pulihkan dari arsip" : "Arsipkan"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={props.onCompact} disabled={props.compactBusy} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
              <Scissors className="size-4 text-muted-foreground" />
              <span>Compact percakapan</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem onClick={props.onExport} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
              <Download className="size-4 text-muted-foreground" />
              <span>Export Markdown</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              onClick={props.onDelete}
              className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="size-4 text-destructive" />
              <span>Hapus</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

