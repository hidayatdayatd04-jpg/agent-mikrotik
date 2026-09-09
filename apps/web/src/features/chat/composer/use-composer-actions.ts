import { useRef } from "react";
import { toast } from "sonner";
import type { ConnectorDTO } from "@shared/index";
import { useSetConnectorMode, useWriteReadiness } from "@/features/connectors/connector-hooks";

export function useComposerActions(opts: {
  connector?: ConnectorDTO | null;
  disabled?: boolean;
  running: boolean;
  uploading: boolean;
  attachmentCount: number;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setMode = useSetConnectorMode(opts.connector?.id ?? "");
  const readiness = useWriteReadiness(opts.connector?.id ?? null);
  const writeEnabled = opts.connector?.mode === "write";
  const uploadDisabled = opts.disabled || opts.running || opts.uploading || opts.attachmentCount >= 4;

  function pickFile(images: boolean) {
    if (!fileInputRef.current) return;
    fileInputRef.current.accept = images ? ".png,.jpg,.jpeg,.webp" : ".pdf,.txt,.csv,.log,.rsc";
    fileInputRef.current.click();
  }

  function toggleWrite(enabled: boolean) {
    if (!opts.connector) return;
    // Never auto-enable Write on connector switch; explicit toggle only.
    setMode.mutate(
      { mode: enabled ? "write" : "read-only", expectedVersion: opts.connector.modeVersion },
      {
        onSuccess: (res) => {
          if (res.connector.mode === "write") {
            void readiness.refetch().then(({ data }) => {
              if (data?.blocked === "empty-credential") {
                toast.warning("Mode Write aktif, tetapi password admin masih kosong — tulis tetap diblokir. Isi password admin dulu.");
              } else {
                toast.success("Mode Write aktif — perintah perubahan dijalankan dalam Safe Mode.");
              }
            });
          } else {
            toast.info("Mode Read-Only aktif — konfigurasi router tidak diubah.");
          }
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return { fileInputRef, setMode, readiness, writeEnabled, uploadDisabled, pickFile, toggleWrite };
}

export type ComposerActions = ReturnType<typeof useComposerActions>;
