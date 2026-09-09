export interface InputKeyCtx {
  getInput: () => string;
  submit: (raw: string) => void;
  history: string[];
  histIdx: number;
  setHistIdx: (v: number) => void;
  setInput: (v: string) => void;
  cancelRunning: () => void;
  handleClear: () => void;
}

export function createInputKeyHandler(ctx: InputKeyCtx) {
  return function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void ctx.submit(ctx.getInput());
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (ctx.history.length === 0) return;
      const next = Math.min(ctx.histIdx + 1, ctx.history.length - 1);
      ctx.setHistIdx(next);
      ctx.setInput(ctx.history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (ctx.histIdx <= 0) {
        ctx.setHistIdx(-1);
        ctx.setInput("");
      } else {
        const next = ctx.histIdx - 1;
        ctx.setHistIdx(next);
        ctx.setInput(ctx.history[next] ?? "");
      }
    } else if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
      // Ctrl+C: cancel running, else clear input.
      e.preventDefault();
      void ctx.cancelRunning();
    } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ctx.handleClear();
    }
  };
}
