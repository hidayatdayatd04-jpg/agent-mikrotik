import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export function useComposerDraft(opts: {
  draftKey?: string;
  externalText?: string;
  onClearExternalText?: () => void;
  canSubmit: () => boolean;
  onSend: (trimmed: string) => void;
}) {
  const [text, setText] = useState(() => {
    if (!opts.draftKey) return "";
    try {
      return localStorage.getItem(opts.draftKey) ?? sessionStorage.getItem("composer-draft") ?? "";
    } catch {
      return "";
    }
  });
  const [imeComposing, setImeComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef(opts.onSend);
  sendRef.current = opts.onSend;

  // Persist draft (non-secret) for returnTo flow.
  useEffect(() => {
    if (!opts.draftKey) return;
    try {
      localStorage.setItem(opts.draftKey, text);
      sessionStorage.setItem("composer-draft", text);
    } catch {
      /* ignore */
    }
  }, [text, opts.draftKey]);

  useEffect(() => {
    if (opts.externalText) {
      setText(opts.externalText);
      opts.onClearExternalText?.();
      textareaRef.current?.focus();
    }
  }, [opts.externalText, opts.onClearExternalText]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [text]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !imeComposing) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || !opts.canSubmit()) return;
    sendRef.current(trimmed);
    setText("");
    try {
      if (opts.draftKey) localStorage.setItem(opts.draftKey, "");
      sessionStorage.setItem("composer-draft", "");
    } catch {
      /* ignore */
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  return { text, setText, imeComposing, setImeComposing, textareaRef, onKeyDown, submit };
}

export type ComposerDraft = ReturnType<typeof useComposerDraft>;
