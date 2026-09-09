import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useUploadAttachment,
  useDeleteAttachment,
  useUpdateConversation,
  type AttachmentDTO,
} from "./chat-hooks";

export function useChatTarget(conversationId: string) {
  const qc = useQueryClient();
  const upload = useUploadAttachment(conversationId);
  const removeAttachment = useDeleteAttachment(conversationId);
  const updateConversation = useUpdateConversation(conversationId);
  const [attachments, setAttachments] = useState<AttachmentDTO[]>([]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalDraft, setTerminalDraft] = useState<string>("");
  const runLiveRef = useRef(false);

  useEffect(() => {
    setAttachments([]);
    setTerminalOpen(false);
  }, [conversationId]);

  function handleSelectConnector(id: string) {
    if (runLiveRef.current) {
      toast.error("Run sedang aktif — tunggu selesai sebelum mengganti connector.");
      return;
    }
    if (terminalOpen) {
      // Check terminal active commands via query? Optimistic guard.
      toast.error("Terminal aktif — hentikan command dulu sebelum mengganti target.");
      return;
    }
    updateConversation.mutate(
      { connectionId: id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
          qc.invalidateQueries({ queryKey: ["conversations"] });
          toast.success("Connector diperbarui.");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function handlePickFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File melebihi 10 MiB.");
      return;
    }
    upload.mutate(file, {
      onSuccess: (res) => setAttachments((prev) => [...prev, res.attachment]),
      onError: (err) => toast.error(err.message),
    });
  }

  function handleRemoveAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    removeAttachment.mutate(id, { onError: (err) => toast.error(err.message) });
  }

  function setRunLive(v: boolean) {
    runLiveRef.current = v;
  }

  function clearAttachments() {
    setAttachments([]);
  }

  return {
    attachments,
    uploading: upload.isPending,
    terminalOpen,
    setTerminalOpen,
    terminalDraft,
    setTerminalDraft,
    setRunLive,
    handleSelectConnector,
    handlePickFile,
    handleRemoveAttachment,
    clearAttachments,
  };
}
