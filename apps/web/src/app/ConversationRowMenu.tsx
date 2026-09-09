import { Pencil, Pin, PinOff, Archive, Download, Trash2, MoreHorizontal } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ConversationRowMenu(props: {
  title: string;
  pinned: boolean;
  onRename: () => void;
  onPin: () => void;
  onArchive: () => void;
  onExport: () => void;
  onDelete: () => void;
  onTriggerClick: (e: React.MouseEvent) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-lg p-1 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100 cursor-pointer"
          aria-label={`Menu ${props.title}`}
          onClick={props.onTriggerClick}
        >
          <MoreHorizontal className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 rounded-2xl border border-border/60 bg-popover/95 p-1.5 shadow-xl backdrop-blur-md">
        <DropdownMenuItem onClick={props.onRename} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
          <Pencil className="size-3.5 text-muted-foreground" />
          <span>Rename</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={props.onPin} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
          {props.pinned ? <PinOff className="size-3.5 text-amber-500" /> : <Pin className="size-3.5 text-muted-foreground" />}
          <span>{props.pinned ? "Lepas pin" : "Pin"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={props.onArchive} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
          <Archive className="size-3.5 text-muted-foreground" />
          <span>Arsipkan</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={props.onExport} className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer">
          <Download className="size-3.5 text-muted-foreground" />
          <span>Export .md</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuItem
          onClick={props.onDelete}
          className="gap-2.5 px-2.5 py-2 text-xs font-medium rounded-xl cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="size-3.5 text-destructive" />
          <span>Hapus</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
