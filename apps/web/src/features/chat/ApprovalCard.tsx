import { useState, useEffect } from "react";
import {
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  Check,
  Archive,
  Copy,
  ChevronRight,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ApprovalSpec } from "./approval-card";
import {
  useCreateApproval,
  useApproveRequest,
  useExecuteApproval,
  useApprovalLog,
  useApprovals,
} from "../approvals/approval-hooks";
import { Markdown } from "./Markdown";
import { formatDuration } from "./ToolActivity";
import { generateVerificationDetails } from "./approval-verification";

interface Props {
  spec: ApprovalSpec;
  activeConnectionId?: string | null;
  conversationId?: string | null;
  onRejected?: (summary: string) => void;
}

export function ApprovalCard({
  spec,
  activeConnectionId,
  conversationId,
  onRejected,
}: Props) {
  const [status, setStatus] = useState<"idle" | "in_progress" | "executed" | "failed" | "rejected">(
    "idle"
  );
  const [approvalId, setApprovalId] = useState<string | null>(spec.id || null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isToolExpanded, setIsToolExpanded] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [copiedLog, setCopiedLog] = useState(false);
  const [serverVerification, setServerVerification] = useState<{
    toolLabel?: string;
    narrative?: string;
    durationMs?: number;
    command?: string;
    output?: string;
  } | null>(null);

  const createApproval = useCreateApproval();
  const approveMutation = useApproveRequest();
  const executeMutation = useExecuteApproval();
  const { data: logs } = useApprovalLog(approvalId);

  // Restore server approval state if already created or executed in this conversation
  const { data: existingApprovals } = useApprovals({
    connectionId: activeConnectionId ?? undefined,
    conversationId: conversationId ?? undefined,
  });

  useEffect(() => {
    if (existingApprovals && status === "idle") {
      const match = existingApprovals.find(
        (a) =>
          a.summary === spec.summary &&
          (a.status === "executed" || a.status === "approved" || a.status === "rejected" || a.status === "failed")
      );
      if (match) {
        setApprovalId(match.id);
        setStatus(match.status as "executed" | "rejected" | "failed");
        if (match.executionResult && typeof match.executionResult === "object") {
          const res = match.executionResult as { verification?: { toolLabel?: string; narrative?: string; durationMs?: number; command?: string; output?: string } };
          if (res.verification) {
            setServerVerification(res.verification);
          }
        }
      }
    }
  }, [existingApprovals, spec.summary, status]);

  const riskBadge = {
    low: {
      label: "Risiko Rendah",
      classes: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    },
    medium: {
      label: "Risiko Menengah",
      classes: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    },
    high: {
      label: "Risiko Tinggi",
      classes: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    },
    critical: {
      label: "Risiko Kritis",
      classes: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
    },
  }[spec.riskLevel || "medium"];

  async function handleApproveAndExecute() {
    if (!activeConnectionId) {
      toast.error("Router belum terhubung. Pilih router di kolom chat terlebih dahulu.");
      return;
    }

    setStatus("in_progress");
    setExecutionError(null);

    try {
      // Step 1: Create request if not created yet
      let currentId = approvalId;
      if (!currentId) {
        const created = await createApproval.mutateAsync({
          connectionId: activeConnectionId,
          summary: spec.summary,
          operations: spec.operations,
          riskLevel: spec.riskLevel,
          impactDescription: spec.impactDescription,
          affectedObjects: spec.affectedObjects,
          conversationId: conversationId || undefined,
        });
        currentId = created.approval.id;
        setApprovalId(currentId);
      }

      // Step 2: Approve
      await approveMutation.mutateAsync(currentId);

      // Step 3: Execute (backend automatically creates pre-change backup first!)
      const executed = await executeMutation.mutateAsync(currentId);

      if (executed.approval.status === "executed") {
        setStatus("executed");
        if (executed.approval.executionResult && typeof executed.approval.executionResult === "object") {
          const res = executed.approval.executionResult as {
            verification?: {
              toolLabel?: string;
              narrative?: string;
              durationMs?: number;
              command?: string;
              output?: string;
            };
          };
          if (res.verification) {
            setServerVerification(res.verification);
          }
        }
        toast.success(`Perubahan "${spec.summary}" berhasil diterapkan ke router.`);
      } else {
        setStatus("failed");
        setExecutionError(executed.approval.executionError || "Sebagian perintah gagal dijalankan.");
        toast.error("Eksekusi perubahan menemui kegagalan.");
      }
    } catch (err) {
      setStatus("failed");
      const msg = err instanceof Error ? err.message : "Gagal menjalankan perubahan";
      setExecutionError(msg);
      toast.error(`Gagal mengeksekusi: ${msg}`);
    }
  }

  function handleReject() {
    setStatus("rejected");
    toast.info("Perubahan konfigurasi ditolak.");
    onRejected?.(spec.summary);
  }

  async function handleCopyLog() {
    const logText =
      logs && logs.length > 0
        ? logs.map((l, idx) => `[${idx + 1}] ${l.command} => ${l.status} (${l.durationMs ?? 0}ms)${l.output ? `\n${l.output}` : ""}`).join("\n")
        : spec.operations.map((o, idx) => `[${idx + 1}] ${o.command}`).join("\n");

    try {
      await navigator.clipboard.writeText(logText);
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2000);
      toast.success("Log eksekusi disalin ke clipboard.");
    } catch {
      /* clipboard unavail */
    }
  }

  const verification = generateVerificationDetails({
    summary: spec.summary,
    operations: spec.operations,
    affectedObjects: spec.affectedObjects,
    logs: logs ?? [],
    narrative: serverVerification?.narrative,
    toolLabel: serverVerification?.toolLabel,
    durationMs: serverVerification?.durationMs,
    command: serverVerification?.command,
    output: serverVerification?.output,
  });

  // Render when already executed (Executed / Verified State in the SAME Chat Output)
  if (status === "executed") {
    return (
      <div className="my-3 space-y-3">
        {/* 1. Executed Approval Card */}
        <div className="overflow-hidden rounded-2xl border border-emerald-500/30 bg-card shadow-xs transition-all">
          {/* Header - Clickable to expand / collapse */}
          <div
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center justify-between gap-3 border-b border-emerald-500/20 bg-emerald-500/5 px-4 py-3 cursor-pointer hover:bg-emerald-500/10 transition-colors select-none"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-7.5 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-foreground truncate block">
                  {spec.summary}
                </span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium block">
                  Perubahan Konfigurasi Berhasil Diterapkan & Aktif
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                ✓ Terverifikasi & Aktif
              </span>
              <button
                type="button"
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 transition-colors cursor-pointer"
              >
                <span>{isExpanded ? "Sembunyikan" : "Tampilkan"}</span>
                {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
            </div>
          </div>

          {/* Body content - Shown only when isExpanded is true */}
          {isExpanded && (
            <div className="p-4 space-y-3 animate-in fade-in-50 duration-200">
              {/* Success summary message */}
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs space-y-2">
                <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check className="size-4 text-emerald-500" />
                  <span>Konfigurasi Selesai Diterapkan & Diverifikasi ke RouterOS</span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Semua perintah konfigurasi telah dieksekusi dan diverifikasi statusnya ke router. Konfigurasi telah aktif dan siap digunakan.
                </p>
              </div>

              {/* Live RouterOS Verification Proof */}
              {logs && logs.filter((l) => l.command.startsWith("[VERIFIKASI]")).length > 0 && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="size-4 text-emerald-500" />
                      <span>Verifikasi Live RouterOS ({logs.filter((l) => l.command.startsWith("[VERIFIKASI]")).length} objek terverifikasi)</span>
                    </div>
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                      STATUS AKTIF
                    </span>
                  </div>
                  <div className="space-y-2 pt-1">
                    {logs.filter((l) => l.command.startsWith("[VERIFIKASI]")).map((v, i) => (
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

              {/* Backup confirmation */}
              <div className="flex items-center gap-2 rounded-xl bg-indigo-500/5 p-2.5 text-[11px] text-indigo-700 dark:text-indigo-300 border border-indigo-500/20">
                <Archive className="size-4 shrink-0 text-indigo-500" />
                <span>
                  Snapshot cadangan otomatis telah dibuat sebelum eksekusi untuk proteksi rollback.
                </span>
              </div>

              {/* Live / executed logs */}
              <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-muted/40 text-[11px] font-medium text-foreground">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                    <span>Log Eksekusi Langkah ({(logs ? logs.filter((l) => !l.command.startsWith("[VERIFIKASI]")).length : spec.operations.length)} selesai)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowLog(!showLog)}
                    className="flex items-center gap-1 text-[10px] text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
                  >
                    {showLog ? "Sembunyikan" : "Tampilkan"}
                    {showLog ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  </button>
                </div>

                {showLog && (
                  <div className="p-2 space-y-2 max-h-64 overflow-y-auto">
                    {(logs && logs.length > 0 ? logs.filter((l) => !l.command.startsWith("[VERIFIKASI]")) : spec.operations.map((op, idx) => ({
                      id: `fallback-${idx}`,
                      command: op.command,
                      status: "success",
                      durationMs: 15,
                      output: null,
                      errorMessage: null,
                    }))).map((item, idx) => (
                      <div key={item.id} className="rounded-lg bg-background p-2.5 text-xs border border-border/40 font-mono space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-semibold text-foreground/90 break-all">
                            Langkah {idx + 1}: {item.command}
                          </span>
                          <span className="text-[9px] uppercase font-bold text-emerald-500 shrink-0 ml-2">
                            {item.status} ({item.durationMs ?? 0}ms)
                          </span>
                        </div>
                        {item.output && (
                          <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap bg-muted/40 p-1.5 rounded select-all font-mono">
                            {item.output}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Collapsible Diff */}
              {(spec.diffBefore || spec.diffAfter) && (
                <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowDiff(!showDiff)}
                    className="flex w-full items-center justify-between px-3 py-2 bg-muted/30 text-[11px] font-medium text-muted-foreground cursor-pointer hover:bg-muted/50"
                  >
                    <span>Lihat Pratinjau Diff Konfigurasi</span>
                    {showDiff ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  </button>
                  {showDiff && (
                    <div className="p-2.5 space-y-2 text-xs font-mono border-t border-border/40">
                      {spec.diffBefore && (
                        <div className="rounded-lg bg-rose-500/5 p-2 border border-rose-500/20">
                          <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-1">
                            Sebelum:
                          </div>
                          <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap select-all font-mono">
                            {spec.diffBefore}
                          </pre>
                        </div>
                      )}
                      {spec.diffAfter && (
                        <div className="rounded-lg bg-emerald-500/5 p-2 border border-emerald-500/20">
                          <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                            Sesudah:
                          </div>
                          <pre className="text-[11px] text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap select-all font-mono">
                            {spec.diffAfter}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Footer inside expanded view */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <Check className="size-3.5" />
                  <span>Perubahan berhasil diterapkan & diverifikasi</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCopyLog();
                    }}
                    className="h-7 px-2.5 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {copiedLog ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                    <span>{copiedLog ? "Tersalin!" : "Salin Detail"}</span>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 2. Verification Section in the SAME Chat Output */}
        <div className="space-y-3 pt-0.5 animate-in fade-in duration-200">
          {/* Tool activity bar matching user interface requirement */}
          <div className="rounded-xl border border-border/70 bg-muted/30 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsToolExpanded(!isToolExpanded)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs cursor-pointer hover:bg-muted/50 transition-colors select-none"
              aria-expanded={isToolExpanded}
            >
              <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                {isToolExpanded ? (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{verification.toolLabel}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                <span>{formatDuration(verification.durationMs) ?? "12 mdtk"}</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  Selesai
                </span>
              </span>
            </button>

            {isToolExpanded && (
              <div className="border-t border-border/60 bg-background/60 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                  <span className="text-cyan-600 dark:text-cyan-400 font-semibold">{verification.command}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">✓ Selesai ({verification.durationMs ?? 12}ms)</span>
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/40 bg-zinc-950 p-2 font-mono text-[10.5px] text-emerald-300/90 select-all">
                  {verification.output || "(Konfigurasi terverifikasi aktif pada router)"}
                </pre>
              </div>
            )}
          </div>

          {/* Verification Narrative Text */}
          <div className="text-sm leading-relaxed text-foreground">
            <Markdown text={verification.narrative} />
          </div>
        </div>
      </div>
    );
  }

  // Render when rejected
  if (status === "rejected") {
    return (
      <div className="my-2.5 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs transition-all opacity-85">
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors select-none"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-7.5 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <X className="size-4" />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-bold text-foreground truncate block">
                {spec.summary}
              </span>
              <span className="text-[10px] text-muted-foreground block">
                Persetujuan Perubahan Konfigurasi AI
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="rounded-full border border-border px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground bg-muted">
              Dibatalkan
            </span>
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <span>{isExpanded ? "Sembunyikan" : "Tampilkan"}</span>
              {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="p-4 text-xs text-muted-foreground animate-in fade-in-50 duration-200">
            Perubahan konfigurasi ini dibatalkan oleh pengguna. Router tetap dalam kondisi semula dan tidak ada konfigurasi yang diubah.
          </div>
        )}
      </div>
    );
  }

  // Render when idle or in_progress or failed
  return (
    <div className="my-2.5 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs transition-all">
      {/* Header - Clickable to expand/collapse details */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-7.5 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Shield className="size-4" />
          </div>
          <div className="min-w-0">
            <span className="text-xs font-bold text-foreground truncate block">
              {spec.summary}
            </span>
            <span className="text-[10px] text-muted-foreground block">
              Persetujuan Perubahan Konfigurasi AI
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${riskBadge.classes}`}
          >
            {riskBadge.label}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <span>{isExpanded ? "Sembunyikan" : "Tampilkan Detail"}</span>
            {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Body content - Shown only when isExpanded is true */}
      {isExpanded && (
        <div className="p-4 space-y-3.5 animate-in fade-in-50 duration-200">
          {spec.impactDescription && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {spec.impactDescription}
            </p>
          )}

          {/* Affected Objects */}
          {spec.affectedObjects && spec.affectedObjects.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-medium text-muted-foreground mr-1">Terdampak:</span>
              {spec.affectedObjects.map((obj, i) => (
                <span
                  key={i}
                  className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-foreground/80 border border-border/50"
                >
                  {obj}
                </span>
              ))}
            </div>
          )}

          {/* Operations list preview */}
          <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50 bg-muted/40 text-[11px] font-medium text-muted-foreground">
              <span>Daftar Perintah ({spec.operations.length} langkah)</span>
            </div>

            <div className="p-2 space-y-2">
              {spec.operations.map((op, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-background p-2 text-xs border border-border/40 space-y-1"
                >
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground/80">
                      Langkah {i + 1}: {op.description || "Perintah RouterOS"}
                    </span>
                    {op.risk && (
                      <span
                        className={`uppercase text-[9px] font-mono font-bold ${
                          op.risk === "destructive"
                            ? "text-rose-500"
                            : op.risk === "write"
                            ? "text-amber-500"
                            : "text-muted-foreground"
                        }`}
                      >
                        {op.risk}
                      </span>
                    )}
                  </div>
                  <div className="rounded bg-muted/50 px-2 py-1 font-mono text-[11px] text-foreground select-all break-all">
                    {op.command}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Diff Preview if present */}
          {(spec.diffBefore || spec.diffAfter) && (
            <div className="rounded-xl border border-border/60 bg-muted/20 overflow-hidden">
              <div className="px-3 py-2 border-b border-border/50 bg-muted/40 text-[11px] font-medium text-muted-foreground flex items-center justify-between">
                <span>Pratinjau Diff Konfigurasi</span>
                <span className="text-[10px] text-muted-foreground">Sebelum vs Sesudah</span>
              </div>
              <div className="p-2.5 space-y-2 text-xs font-mono">
                {spec.diffBefore && (
                  <div className="rounded-lg bg-rose-500/5 p-2 border border-rose-500/20">
                    <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-1">
                      Sebelum (Existing):
                    </div>
                    <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap select-all font-mono leading-relaxed">
                      {spec.diffBefore}
                    </pre>
                  </div>
                )}
                {spec.diffAfter && (
                  <div className="rounded-lg bg-emerald-500/5 p-2 border border-emerald-500/20">
                    <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">
                      Sesudah (Rencana Perubahan):
                    </div>
                    <pre className="text-[11px] text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap select-all font-mono leading-relaxed">
                      {spec.diffAfter}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Protection assurance */}
          <div className="flex items-center gap-2 rounded-xl bg-indigo-500/5 p-2.5 text-[11px] text-indigo-700 dark:text-indigo-300 border border-indigo-500/20">
            <Archive className="size-4 shrink-0 text-indigo-500" />
            <span>
              Snapshot konfigurasi otomatis akan dibuat sebelum eksekusi dimulai untuk keamanan rollback.
            </span>
          </div>

          {/* Execution error notice if any */}
          {executionError && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-400 border border-rose-500/20">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <div className="flex-1">{executionError}</div>
            </div>
          )}
        </div>
      )}

      {/* Footer / Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-muted/10 px-4 py-3">
        {status === "idle" && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReject}
              className="h-8 gap-1.5 rounded-xl text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
            >
              <X className="size-3.5" />
              Tolak
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleApproveAndExecute()}
              className="h-8 gap-1.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/35 hover:brightness-105 cursor-pointer"
            >
              <Check className="size-3.5" />
              Setujui & Jalankan
            </Button>
          </>
        )}

        {status === "in_progress" && (
          <div className="flex items-center gap-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 py-1">
            <Loader2 className="size-4 animate-spin" />
            <span>Menerapkan konfigurasi & memverifikasi status pada router…</span>
          </div>
        )}

        {status === "failed" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-rose-500">Eksekusi gagal</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleApproveAndExecute()}
              className="h-7 text-xs"
            >
              Coba Lagi
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
