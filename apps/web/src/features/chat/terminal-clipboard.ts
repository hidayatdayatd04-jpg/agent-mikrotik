import { toast } from "sonner";
import type { TerminalCommandDTO } from "./chat-hooks";

export function copyTerminalOutput(visible: TerminalCommandDTO[], prompt: string) {
  const text = visible.map((c) => `${prompt} ${c.command}\n${c.outputPreview}`).join("\n\n") || "(kosong)";
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Output terminal disalin."))
    .catch(() => toast.error("Gagal menyalin."));
}
