import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Server, Plus, CheckCircle2, Copy, Check } from "@/components/icons";
import type { DiscoveredRouterDTO } from "./connector-hooks";

export function DiscoveredRouterCard({
  device,
  onConnect,
}: {
  device: DiscoveredRouterDTO;
  onConnect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const targetIp = device.ipv4 || device.ip;

  function copyIp() {
    navigator.clipboard.writeText(targetIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative flex flex-col justify-between rounded-xl border border-indigo-500/20 bg-card/90 p-4 shadow-xs transition-all hover:border-indigo-500/50 hover:shadow-md">
      <div>
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
              <Server className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-sm text-foreground truncate max-w-[140px]">
                  {device.identity || "MikroTik Router"}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground font-semibold">
                  {device.board || "CHR"}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground font-mono block truncate">MAC: {device.mac}</span>
            </div>
          </div>

          <span
            className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
              device.sshAvailable
                ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/30"
                : "text-amber-500 bg-amber-500/10 border-amber-500/30"
            }`}
          >
            <span className={`size-1.5 rounded-full ${device.sshAvailable ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
            {device.sshAvailable ? "SSH Port 22 Siap" : "SSH Belum Aktif"}
          </span>
        </div>

        <div className="space-y-1.5 pt-2 border-t border-border/50 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">IP Address:</span>
            <div className="flex items-center gap-1">
              <span className="font-mono font-bold text-foreground bg-muted/70 px-1.5 py-0.5 rounded text-xs">{targetIp}</span>
              <button
                type="button"
                onClick={copyIp}
                className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                title="Salin IP"
              >
                {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">RouterOS:</span>
            <span className="text-foreground font-mono truncate max-w-[170px]" title={device.version}>
              {device.version || "RouterOS v7"}
            </span>
          </div>

          {device.interface && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Interface:</span>
              <span className="text-muted-foreground font-mono">{device.interface}</span>
            </div>
          )}
        </div>
      </div>

      <div className="pt-3 mt-3 border-t border-border/50">
        {device.alreadyAdded ? (
          <div className="flex items-center justify-center gap-1.5 py-1 text-xs font-semibold text-emerald-500 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <CheckCircle2 className="size-3.5 text-emerald-500" />
            <span>Sudah Ditambahkan</span>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={onConnect}
            className="w-full h-8 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5 rounded-lg shadow-xs transition-colors"
          >
            <Plus className="size-3.5" />
            Hubungkan Router Ini
          </Button>
        )}
      </div>
    </div>
  );
}
