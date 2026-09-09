import { CheckCircle2, AlertCircle, TriangleAlertIcon, OctagonXIcon } from "@/components/icons";
import type { NotificationType } from "@shared/index";

export function NotificationIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case "critical":
      return <OctagonXIcon className="size-4 text-rose-500 shrink-0" />;
    case "warning":
      return <TriangleAlertIcon className="size-4 text-amber-500 shrink-0" />;
    case "success":
      return <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />;
    default:
      return <AlertCircle className="size-4 text-blue-500 shrink-0" />;
  }
}
