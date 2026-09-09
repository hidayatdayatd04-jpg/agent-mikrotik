import { apiFetch } from "@/lib/api";
import type { TerminalCommandDTO } from "./chat-hooks";

export type SetBusyId = (v: string | null | ((b: string | null) => string | null)) => void;

// Fast re-poll until terminal state for snappy UX.
export async function pollTerminalCommand(
  sessionId: string,
  commandId: string,
  setServerCommands: React.Dispatch<React.SetStateAction<TerminalCommandDTO[]>>,
  setBusyId: SetBusyId,
) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const cur = await apiFetch<{ commands: TerminalCommandDTO[] }>(`/api/terminal/sessions/${sessionId}/commands`);
      const sorted = cur.commands.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setServerCommands(sorted);
      const target = sorted.find((c) => c.id === commandId);
      if (target && !["queued", "running"].includes(target.status)) {
        setBusyId((b) => (b === commandId ? null : b));
        break;
      }
    } catch {
      break;
    }
  }
}
