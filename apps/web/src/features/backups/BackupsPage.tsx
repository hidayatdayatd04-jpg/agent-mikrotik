import { useState } from "react";
import {
  Archive,
  Plus,
  Trash2,
  Download,
  FileDiff,
  Search,
  X,
  RefreshCw,
  Settings,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useBackups,
  useBackup,
  useCreateBackup,
  useCompareBackups,
  useCompareWithLive,
  useDeleteBackup,
} from "./backup-hooks";
import { useConnectors } from "../connectors/connector-hooks";
import { RouterSelector } from "../connectors/RouterSelector";
import { DiffViewer } from "./DiffViewer";
import type { ConfigBackupDTO, DiffResult } from "@shared/index";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function BackupsPage({ initialConnectionId }: { initialConnectionId?: string }) {
  const connectors = useConnectors();
  const availableConnectors = connectors.data ?? [];
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>(initialConnectionId);
  const connectedRouter = availableConnectors.find((c) => c.status === "connected");
  const activeId = selectedConnectionId || connectedRouter?.id || availableConnectors[0]?.id;

  const [search, setSearch] = useState("");
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [activeDiff, setActiveDiff] = useState<{ title: string; result: DiffResult } | null>(null);
  const [viewingBackupId, setViewingBackupId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [newBackupName, setNewBackupName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const backups = useBackups(activeId);
  const createBackup = useCreateBackup();
  const deleteBackup = useDeleteBackup();
  const compareTwo = useCompareBackups();
  const compareLive = useCompareWithLive();
  const backupDetail = useBackup(viewingBackupId);

  const items = (backups.data ?? []).filter((b) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      b.name.toLowerCase().includes(q) ||
      (b.routerIdentity?.toLowerCase().includes(q) ?? false) ||
      (b.boardName?.toLowerCase().includes(q) ?? false)
    );
  });

  function toggleCompareSelection(id: string) {
    if (selectedForCompare.includes(id)) {
      setSelectedForCompare(selectedForCompare.filter((i) => i !== id));
    } else if (selectedForCompare.length < 2) {
      setSelectedForCompare([...selectedForCompare, id]);
    } else {
      setSelectedForCompare([selectedForCompare[1]!, id]);
    }
  }

  async function handleCompareSelected() {
    if (selectedForCompare.length !== 2) return;
    try {
      const res = await compareTwo.mutateAsync({
        backupId1: selectedForCompare[0]!,
        backupId2: selectedForCompare[1]!,
      });
      const b1 = items.find((i) => i.id === selectedForCompare[0]);
      const b2 = items.find((i) => i.id === selectedForCompare[1]);
      setActiveDiff({
        title: `Bandingkan: "${b1?.name}" vs "${b2?.name}"`,
        result: res.diff,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal membandingkan backup");
    }
  }

  async function handleCompareLive(backup: ConfigBackupDTO) {
    if (!activeId) return;
    try {
      const res = await compareLive.mutateAsync({
        backupId: backup.id,
        connectionId: activeId,
      });
      setActiveDiff({
        title: `Bandingkan: "${backup.name}" vs Router Live`,
        result: res.diff,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal membandingkan dengan konfigurasi live");
    }
  }

  async function handleCreate() {
    if (!activeId) return;
    setIsCreating(true);
    try {
      await createBackup.mutateAsync({
        connectionId: activeId,
        name: newBackupName.trim() || undefined,
      });
      setNewBackupName("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal membuat snapshot backup");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-6 py-3.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Archive className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">Backup & Diff Konfigurasi</h1>
            <p className="text-xs text-muted-foreground">
              Manajemen ekspor konfigurasi aman, riwayat perubahan, dan diff RouterOS
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <RouterSelector
            connectors={availableConnectors}
            selectedId={activeId}
            onSelect={(id) => setSelectedConnectionId(id)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
            className="gap-1.5 text-xs h-9 rounded-xl cursor-pointer"
          >
            <Settings className="size-3.5" />
            Pengaturan
          </Button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-7xl mx-auto w-full">
        {/* Actions bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border/60 p-4 rounded-2xl shadow-xs">
          {/* Create Backup Input */}
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <Input
              value={newBackupName}
              onChange={(e) => setNewBackupName(e.target.value)}
              placeholder="Nama backup opsional (mis. Sebelum Upgrade)..."
              className="h-9 text-xs"
              disabled={!activeId || isCreating}
            />
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!activeId || isCreating}
              className="gap-1.5 text-xs h-9 shrink-0 cursor-pointer"
            >
              {isCreating ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Buat Snapshot
            </Button>
          </div>

          {/* Compare Two Button */}
          <div className="flex items-center gap-3">
            {selectedForCompare.length === 2 && (
              <Button
                size="sm"
                variant="default"
                onClick={handleCompareSelected}
                className="gap-1.5 text-xs h-9 bg-cyan-600 hover:bg-cyan-700 text-white cursor-pointer"
              >
                <FileDiff className="size-3.5" />
                Bandingkan 2 Terpilih ({selectedForCompare.length})
              </Button>
            )}

            <div className="relative w-60">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari file backup…"
                className="h-9 rounded-xl pl-8 text-xs border-border/60 bg-muted/30"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Diff Result Box if open */}
        {activeDiff && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">{activeDiff.title}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveDiff(null)}
                className="text-xs h-7 gap-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" /> Tutup Diff
              </Button>
            </div>
            <DiffViewer diff={activeDiff.result} />
          </div>
        )}

        {/* Backups List Table */}
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-border/50 flex items-center justify-between">
            <h3 className="text-xs font-bold text-foreground">Daftar Snapshot Konfigurasi</h3>
            <span className="text-[11px] text-muted-foreground">
              {items.length} Snapshot Tersimpan
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20 text-muted-foreground text-[11px]">
                  <th className="w-10 px-4 py-2.5 text-center">Pilih</th>
                  <th className="px-4 py-2.5 font-semibold">Nama Backup</th>
                  <th className="px-4 py-2.5 font-semibold">Identitas Router</th>
                  <th className="px-4 py-2.5 font-semibold">Ukuran</th>
                  <th className="px-4 py-2.5 font-semibold">Pembuat</th>
                  <th className="px-4 py-2.5 font-semibold">Waktu Pembuatan</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                      {backups.isLoading
                        ? "Memuat daftar backup…"
                        : "Belum ada backup untuk router ini. Klik 'Buat Snapshot' untuk membuat export pertama."}
                    </td>
                  </tr>
                ) : (
                  items.map((b) => {
                    const isSelected = selectedForCompare.includes(b.id);
                    return (
                      <tr
                        key={b.id}
                        className={`hover:bg-accent/30 transition-colors ${
                          isSelected ? "bg-accent/50" : ""
                        }`}
                      >
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleCompareSelection(b.id)}
                            className="rounded border-border cursor-pointer"
                            title="Pilih untuk perbandingan diff"
                          />
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground">
                          {b.name}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {b.routerIdentity || "—"} ({b.boardName || "RouterOS"})
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px]">
                          {formatBytes(b.sizeBytes)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {b.createdBy}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-[11px]">
                          {new Date(b.createdAt).toLocaleString("id-ID")}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                              b.status === "completed"
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : b.status === "failed"
                                  ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                  : "bg-amber-500/10 text-amber-600"
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCompareLive(b)}
                              className="h-7 px-2 text-[11px] gap-1 cursor-pointer"
                              title="Bandingkan dengan konfigurasi berjalan saat ini"
                            >
                              <FileDiff className="size-3" />
                              Diff Live
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setViewingBackupId(b.id)}
                              className="h-7 px-2 text-[11px] cursor-pointer"
                            >
                              Lihat
                            </Button>
                            <a
                              href={`/api/backups/${b.id}/export`}
                              download={`${b.name}.rsc`}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                              title="Unduh file .rsc (aman, password diredaksi)"
                            >
                              <Download className="size-3.5" />
                            </a>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={async () => {
                                if (confirm(`Hapus backup "${b.name}"?`)) {
                                  await deleteBackup.mutateAsync(b.id);
                                }
                              }}
                              className="size-7 text-muted-foreground hover:text-destructive cursor-pointer"
                              title="Hapus backup"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal View Backup Content */}
        {viewingBackupId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl border border-border/80 bg-popover shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60">
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    {backupDetail.data?.name || "Isi Konfigurasi"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Export RouterOS (Kredensial sensitif diredaksi otomatis)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingBackupId(null)}
                  className="rounded-lg p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4 bg-muted/20">
                {backupDetail.isLoading ? (
                  <div className="py-20 text-center text-xs text-muted-foreground">
                    Memuat isi konfigurasi…
                  </div>
                ) : (
                  <pre className="font-mono text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed select-text">
                    {backupDetail.data?.content || "Tidak ada konten."}
                  </pre>
                )}
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-t border-border/60 bg-muted/40">
                <span className="text-[11px] text-muted-foreground">
                  Ukuran: {formatBytes(backupDetail.data?.sizeBytes ?? 0)}
                </span>
                <Button size="sm" onClick={() => setViewingBackupId(null)}>
                  Tutup
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
