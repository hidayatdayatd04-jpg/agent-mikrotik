import { toast } from "sonner";
import { useSaveAiProvider, useDeleteAiProvider, fetchProviderModels } from "../chat-hooks";
import type { DialogProviderConfig } from "./provider-presets";
import type { ProviderForm } from "./use-provider-form";

export function useProviderActions(
  form: ProviderForm,
  provider: DialogProviderConfig | null,
  onOpenChange: (open: boolean) => void,
) {
  const saveProvider = useSaveAiProvider();
  const deleteProvider = useDeleteAiProvider();
  const currentProvider = provider;
  const kind = form.kind;
  const hasSavedKey = form.hasSavedKey;

  async function handleFetchRemoteModels() {
    if (!currentProvider || !kind) return;
    if (!form.apiKey && !hasSavedKey) {
      toast.error("Isi API key terlebih dahulu untuk mengambil daftar model.");
      return;
    }
    if (kind === "custom" && !form.baseUrl.trim()) {
      toast.error("Isi Base URL terlebih dahulu untuk provider Custom.");
      return;
    }

    form.setFetchingRemote(true);
    try {
      const res = await fetchProviderModels({
        providerId: currentProvider?.id,
        kind,
        baseUrl: form.baseUrl.trim() || undefined,
        apiKey: form.apiKey || undefined,
      });
      form.setRemoteModels(res.models);
      if (res.models.length === 0) {
        toast.info("Provider tidak mengembalikan daftar model otomatis. Anda dapat mengetik manual.");
      } else {
        toast.success(`${res.models.length} model ditemukan dari provider.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengambil daftar model.");
    } finally {
      form.setFetchingRemote(false);
    }
  }

  function handleSave() {
    if (!currentProvider || !kind) return;
    if (form.models.length === 0) {
      toast.error("Tambahkan minimal 1 model untuk provider ini.");
      return;
    }
    const resolvedActive = form.activeModel || form.models[0] || "";
    if (!resolvedActive) {
      toast.error("Pilih model aktif untuk provider ini.");
      return;
    }
    if (!hasSavedKey && !form.apiKey.trim()) {
      toast.error("API Key wajib diisi untuk provider baru.");
      return;
    }

    const providerId = currentProvider.id || (kind === "custom" ? undefined : kind);

    saveProvider.mutate(
      {
        id: providerId,
        kind,
        name: form.name.trim() || currentProvider.name,
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim() || undefined,
        models: form.models,
        activeModel: resolvedActive,
        enabled: currentProvider.enabled ?? true,
      },
      {
        onSuccess: () => {
          toast.success(`Konfigurasi provider ${form.name || currentProvider.name} berhasil disimpan.`);
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error(err.message);
        },
      },
    );
  }

  function handleDelete() {
    if (!currentProvider?.id) return;
    if (confirm(`Apakah Anda yakin ingin menghapus konfigurasi provider ${currentProvider.name}?`)) {
      deleteProvider.mutate(currentProvider.id, {
        onSuccess: () => {
          toast.success(`Provider ${currentProvider.name} berhasil dihapus.`);
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error(err.message);
        },
      });
    }
  }

  return { savePending: saveProvider.isPending, handleFetchRemoteModels, handleSave, handleDelete };
}

export type ProviderActions = ReturnType<typeof useProviderActions>;
