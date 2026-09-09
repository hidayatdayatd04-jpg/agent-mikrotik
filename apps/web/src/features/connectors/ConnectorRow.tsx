import { Server, Clock } from "@/components/icons";
import type { ConnectorDTO } from "@shared/index";
import { StatusBadge } from "./StatusBadge";
import { ConnectorRowActions } from "./ConnectorRowActions";

export function ConnectorRow({ connector }: { connector: ConnectorDTO }) {
  const connected = connector.status === "connected";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card/70 p-4 transition-all hover:border-border sm:flex-row sm:items-center sm:justify-between shadow-xs">
      <div className="flex min-w-0 items-start gap-3.5">
        <div
          className={`mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl ${
            connected ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
          }`}
        >
          <Server className="size-5" />
        </div>

        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{connector.label}</span>
            {connector.routerIdentity && (
              <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                {connector.routerIdentity}
              </span>
            )}
            <StatusBadge status={connector.status} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-mono">
            <span>
              {connector.username}@{connector.host}:{connector.port}
            </span>
          </div>

          {connector.lastVerifiedAt && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="size-3" />
              <span>
                Terakhir diperiksa:{" "}
                {new Date(connector.lastVerifiedAt).toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Action Controls */}
      <ConnectorRowActions connector={connector} />
    </div>
  );
}
