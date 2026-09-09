import { Check, Trash2, CheckCircle2, AlertCircle, TriangleAlertIcon, OctagonXIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { NotificationDTO } from "@shared/index";

export function NotificationCard({
  item,
  onRead,
  onDelete,
}: {
  item: NotificationDTO;
  onRead: () => void;
  onDelete: () => void;
}) {
  const typeStyles = {
    critical: "border-l-4 border-l-rose-500 bg-rose-500/5 hover:bg-rose-500/10",
    warning: "border-l-4 border-l-amber-500 bg-amber-500/5 hover:bg-amber-500/10",
    success: "border-l-4 border-l-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10",
    info: "border-l-4 border-l-blue-500 bg-blue-500/5 hover:bg-blue-500/10",
  }[item.type];

  return (
    <div
      className={`group flex items-start justify-between gap-4 rounded-xl border border-border/50 p-3.5 transition-all ${typeStyles} ${
        item.read ? "opacity-75" : "shadow-xs"
      }`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="pt-0.5 shrink-0">
          {item.type === "critical" && <OctagonXIcon className="size-4.5 text-rose-500" />}
          {item.type === "warning" && <TriangleAlertIcon className="size-4.5 text-amber-500" />}
          {item.type === "success" && <CheckCircle2 className="size-4.5 text-emerald-500" />}
          {item.type === "info" && <AlertCircle className="size-4.5 text-blue-500" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold ${item.read ? "text-foreground/80" : "text-foreground"}`}>{item.title}</span>
            {item.routerLabel && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{item.routerLabel}</span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {new Date(item.createdAt).toLocaleString("id-ID", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {!item.read && (
              <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[9px] font-bold text-primary">BARU</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed whitespace-pre-wrap">{item.message}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {!item.read && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={onRead}
            title="Tandai telah dibaca"
          >
            <Check className="size-3.5" />
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-7 rounded-lg text-muted-foreground hover:text-destructive cursor-pointer"
          onClick={onDelete}
          title="Hapus notifikasi"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
