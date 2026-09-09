import { LOCAL_HELP, type Line } from "./terminal-helpers";

export interface LocalCommandCtx {
  cmd: string;
  prompt: string;
  history: string[];
  pushHistory: (cmd: string) => void;
  handleClear: () => void;
  appendLines: (lines: Line[]) => void;
  setInput: (v: string) => void;
  onClose: () => void;
}

/** Local commands — never hit the router. Returns true when handled. */
export function handleLocalCommand(ctx: LocalCommandCtx): boolean {
  const cmd = ctx.cmd;
  const lower = cmd.toLowerCase();
  if (lower === "clear" || lower === "cls") {
    ctx.pushHistory(cmd);
    ctx.handleClear();
    ctx.setInput("");
    return true;
  }
  if (lower === "help") {
    ctx.pushHistory(cmd);
    ctx.appendLines([
      { key: `h-in-${Date.now()}`, kind: "input", text: `${ctx.prompt} ${cmd}` },
      { key: `h-out-${Date.now()}`, kind: "output", text: LOCAL_HELP },
    ]);
    ctx.setInput("");
    return true;
  }
  if (lower === "history") {
    ctx.pushHistory(cmd);
    const text = ctx.history.length > 0 ? ctx.history.slice().reverse().map((h, i) => `  ${i + 1}  ${h}`).join("\n") : "  (kosong)";
    ctx.appendLines([
      { key: `hist-in-${Date.now()}`, kind: "input", text: `${ctx.prompt} ${cmd}` },
      { key: `hist-out-${Date.now()}`, kind: "output", text },
    ]);
    ctx.setInput("");
    return true;
  }
  if (lower === "exit") {
    ctx.onClose();
    return true;
  }
  return false;
}
