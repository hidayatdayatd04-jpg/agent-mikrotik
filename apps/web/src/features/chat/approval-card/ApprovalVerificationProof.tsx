import { CheckCircle2, Check } from "@/components/icons";
import type { ApprovalSpec } from "../approval-card";
import type { OperationLogDTO } from "@shared/index";

export function ApprovalVerificationProof(props: { spec: ApprovalSpec; logs: OperationLogDTO[] | undefined }) {
  const { spec, logs } = props;
  const verified = (logs ?? []).filter((l) => l.command.startsWith("[VERIFIKASI]"));
  return (
    <>
      {/* Live RouterOS Verification Proof */}
      {verified.length > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-4 text-emerald-500" />
              <span>Verifikasi Live RouterOS ({verified.length} objek terverifikasi)</span>
            </div>
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
              STATUS AKTIF
            </span>
          </div>
          <div className="space-y-2 pt-1">
            {verified.map((v, i) => (
              <div key={i} className="rounded-lg border border-emerald-500/20 bg-zinc-950 p-2.5 font-mono text-[11px] text-zinc-200">
                <div className="flex items-center justify-between text-zinc-400 text-[10px] mb-1">
                  <span className="text-emerald-400 font-semibold">{v.command.replace("[VERIFIKASI] ", "")}</span>
                  <span className="text-emerald-400 font-medium">✓ Terverifikasi ({v.durationMs ?? 0}ms)</span>
                </div>
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-emerald-300/90 text-[10.5px]">
                  {v.output || "(Output kosong / status resource terdaftar)"}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Affected objects badges */}
      {spec.affectedObjects && spec.affectedObjects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[10px] font-medium text-muted-foreground mr-1">Objek Aktif:</span>
          {spec.affectedObjects.map((obj, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
            >
              <Check className="size-2.5" />
              {obj}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
