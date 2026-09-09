import { Suspense, lazy } from "react";
import { useRoute } from "../lib/router";
import { ChatRoute } from "./ChatRoute";

const NetworkMapPage = lazy(() => import("../features/network-map/NetworkMapPage"));
const MonitoringDashboard = lazy(() => import("../features/monitoring/MonitoringDashboard"));
const NotificationsPage = lazy(() => import("../features/notifications/NotificationsPage"));
const BackupsPage = lazy(() => import("../features/backups/BackupsPage"));

export function MainRoutes(props: { conversationId: string | null; onToggleSidebar: () => void }) {
  const route = useRoute();
  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      {route.name === "network-map" ? (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Memuat Network Map…</div>}>
          <NetworkMapPage connectionId={route.id} />
        </Suspense>
      ) : route.name === "monitoring" ? (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Memuat Monitoring Dashboard…</div>}>
          <MonitoringDashboard initialConnectionId={route.id} />
        </Suspense>
      ) : route.name === "notifications" ? (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Memuat Notifikasi…</div>}>
          <NotificationsPage />
        </Suspense>
      ) : route.name === "backups" ? (
        <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Memuat Backup & Diff…</div>}>
          <BackupsPage initialConnectionId={route.id} />
        </Suspense>
      ) : (
        <ChatRoute conversationId={props.conversationId} onToggleSidebar={props.onToggleSidebar} />
      )}
    </main>
  );
}
