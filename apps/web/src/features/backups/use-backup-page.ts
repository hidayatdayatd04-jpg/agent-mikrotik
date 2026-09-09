import { useState } from "react";
import { useCreateBackup, useCompareBackups, useCompareWithLive, useDeleteBackup } from "./backup-hooks";
import type { ConfigBackupDTO, DiffResult } from "@shared/index";

export function useBackupPage(activeId: string | undefined, backups: ConfigBackupDTO[]) {
  const [search, setSearch] = useState("");
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [activeDiff, setActiveDiff] = useState<{ title: string; result: DiffResult } | null>(null);
  const [viewingBackupId, setViewingBackupId] = useState<string | null>(null);
  const [newBackupName, setNewBackupName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const createBackup = useCreateBackup();
  const deleteBackup = useDeleteBackup();
  const compareTwo = useCompareBackups();
  const compareLive = useCompareWithLive();

  const items = backups.filter((b) => {
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

  async function handleDelete(backup: ConfigBackupDTO) {
    if (confirm(`Hapus backup "${backup.name}"?`)) {
      await deleteBackup.mutateAsync(backup.id);
    }
  }

  return {
    search,
    setSearch,
    items,
    selectedForCompare,
    toggleCompareSelection,
    activeDiff,
    closeDiff: () => setActiveDiff(null),
    viewingBackupId,
    setViewingBackupId,
    newBackupName,
    setNewBackupName,
    isCreating,
    handleCreate,
    handleCompareSelected,
    handleCompareLive,
    handleDelete,
  };
}
