import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import type { TerminalCommandDTO } from "./chat-hooks";
import type { Line } from "./terminal-helpers";
import { handleLocalCommand } from "./terminal-local-commands";
import { createInputKeyHandler } from "./terminal-keymap";
import { copyTerminalOutput } from "./terminal-clipboard";
import { pollTerminalCommand, type SetBusyId } from "./terminal-poll";

export interface TerminalComposerOpts {
  sessionId: string | null;
  connected: boolean;
  busyId: string | null;
  setBusyId: SetBusyId;
  prompt: string;
  visible: TerminalCommandDTO[];
  fetchCommands: () => void;
  setServerCommands: React.Dispatch<React.SetStateAction<TerminalCommandDTO[]>>;
  clearServerLines: () => void;
  conversationId?: string | null;
  onClose: () => void;
}

export function useTerminalComposer(opts: TerminalComposerOpts) {
  const { sessionId, connected, busyId, prompt, visible } = opts;
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("terminal-history") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [histIdx, setHistIdx] = useState<number>(-1);
  const [localLines, setLocalLines] = useState<Line[]>([]);

  function pushHistory(cmd: string) {
    setHistory((prev) => {
      const next = [cmd, ...prev.filter((h) => h !== cmd)].slice(0, 50);
      try {
        localStorage.setItem("terminal-history", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setHistIdx(-1);
  }

  function handleClear() {
    opts.clearServerLines();
    setLocalLines([]);
  }

  function copyAll() {
    copyTerminalOutput(visible, prompt);
  }

  async function cancelRunning() {
    if (!busyId) {
      setInput("");
      return;
    }
    try {
      await apiFetch(`/api/terminal/commands/${busyId}/cancel`, { method: "POST" });
      toast.info("Cancel dikirim — menunggu status final dari server.");
      void opts.fetchCommands();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membatalkan.");
    }
  }

  async function submit(rawInput: string) {
    const cmd = rawInput.trim();
    if (!cmd) return;
    if (
      handleLocalCommand({
        cmd,
        prompt,
        history,
        pushHistory,
        handleClear,
        appendLines: (lines) => setLocalLines((prev) => [...prev, ...lines]),
        setInput,
        onClose: opts.onClose,
      })
    ) {
      return;
    }
    if (!sessionId || !connected) {
      toast.error("Terminal nonaktif — hubungkan router (SSH) dulu.");
      return;
    }
    if (busyId) {
      toast.error("Masih ada command berjalan — tunggu atau Ctrl+C untuk batalkan.");
      return;
    }
    pushHistory(cmd);
    setInput("");
    try {
      const res = await apiFetch<{ commandId: string }>(`/api/terminal/sessions/${sessionId}/commands`, {
        method: "POST",
        body: JSON.stringify({ command: cmd, conversationId: opts.conversationId ?? null }),
      });
      opts.setBusyId(res.commandId);
      void opts.fetchCommands();
      void pollTerminalCommand(sessionId, res.commandId, opts.setServerCommands, opts.setBusyId);
    } catch (err) {
      // Show rejection inline in terminal style + toast.
      const msg = err instanceof Error ? err.message : "Command ditolak.";
      setLocalLines((prev) => [
        ...prev,
        { key: `rej-in-${Date.now()}`, kind: "input", text: `${prompt} ${cmd}` },
        { key: `rej-out-${Date.now()}`, kind: "error", text: msg },
      ]);
      toast.error(msg);
      void opts.fetchCommands();
    }
  }

  const onInputKey = createInputKeyHandler({
    getInput: () => input,
    submit,
    history,
    histIdx,
    setHistIdx,
    setInput,
    cancelRunning,
    handleClear,
  });

  return { input, setInput, localLines, submit, onInputKey, copyAll, handleClear };
}
