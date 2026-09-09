import { useState } from "react";
import { Archive, Settings, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useBackups } from "./backup-hooks";
import { useConnectors } from "../connectors/connector-hooks";
import { RouterSelector } from "../connectors/RouterSelector";
import { DiffViewer } from "./DiffViewer";
import { useBackupPage } from "./use-backup-page";
import { BackupActionsBar } from "./BackupActionsBar";
import { BackupTable } from "./BackupTable";
import { BackupViewerModal } from "./BackupViewerModal";

export default function BackupsPage({ initialConnectionId }: { initialConnectionId?: string }) {
  const connectors = useConnectors();
  const availableConnectors = connectors.data ?? [];
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>(initialConnectionId);
  const connectedRouter = availableConnectors.find((c) => c.status === "connected");
  const activeId = selectedConnectionId || connectedRouter?.id || availableConnectors[0]?.id;
  const [showSettings, setShowSettings] = useState(false);

  const backups = useBackups(activeId);
  const page = useBackupPage(activeId, backups.data ?? []);

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
            <p className="text-xs text-muted-foreground">Manajemen ekspor konfigurasi aman, riwayat perubahan, dan diff RouterOS</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <RouterSelector connectors={availableConnectors} selectedId={activeId} onSelect={(id) => setSelectedConnectionId(id)} />
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
        <BackupActionsBar
          newBackupName={page.newBackupName}
          onNameChange={page.setNewBackupName}
          onCreate={() => void page.handleCreate()}
          createDisabled={!activeId || page.isCreating}
          creating={page.isCreating}
          compareCount={page.selectedForCompare.length}
          onCompare={() => void page.handleCompareSelected()}
          search={page.search}
          onSearch={page.setSearch}
        />

        {/* Diff Result Box if open */}
        {page.activeDiff && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground">{page.activeDiff.title}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={page.closeDiff}
                className="text-xs h-7 gap-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" /> Tutup Diff
              </Button>
            </div>
            <DiffViewer diff={page.activeDiff.result} />
          </div>
        )}

        <BackupTable
          items={page.items}
          loading={backups.isLoading}
          selectedForCompare={page.selectedForCompare}
          onToggleCompare={page.toggleCompareSelection}
          onCompareLive={(b) => void page.handleCompareLive(b)}
          onView={page.setViewingBackupId}
          onDelete={page.handleDelete}
        />

        {/* Modal View Backup Content */}
        <BackupViewerModal viewingBackupId={page.viewingBackupId} onClose={() => page.setViewingBackupId(null)} />
      </div>
    </div>
  );
}
