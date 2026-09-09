import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ConnectorDTO } from "@shared/index";
import { promptLabel } from "./terminal-helpers";
import { useTerminalSession } from "./use-terminal-session";
import { useTerminalComposer } from "./use-terminal-composer";
import { TerminalOutput } from "./TerminalOutput";

export function TerminalPanel(props: {
  connector: ConnectorDTO | null;
  conversationId?: string | null;
  initialDraft?: string;
  onClose: () => void;
}) {
  const session = useTerminalSession(props.connector, props.conversationId);
  const prompt = useMemo(() => promptLabel(props.connector), [props.connector]);
  const connected = props.connector?.status === "connected";
  const composer = useTerminalComposer({
    sessionId: session.sessionId,
    connected,
    busyId: session.busyId,
    setBusyId: session.setBusyId,
    prompt,
    visible: session.visible,
    fetchCommands: () => void session.fetchCommands(),
    setServerCommands: session.setServerCommands,
    clearServerLines: session.clearServerLines,
    conversationId: props.conversationId,
    onClose: props.onClose,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    composer.setInput(props.initialDraft ?? "");
    if (props.initialDraft) focusInput();
  }, [props.initialDraft, focusInput]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.serverCommands.length, composer.localLines.length, session.busyId]);

  useEffect(() => {
    focusInput();
  }, [session.sessionId, focusInput]);

  const headerLabel = props.connector
    ? `Terminal - ${props.connector.label} (${props.connector.host})`
    : "Terminal - Belum terhubung";

  return (
    <aside
      className="flex h-full w-full flex-col overflow-hidden border-l border-[#3e3e3e] bg-[#0c0c0c] text-[#cccccc] sm:max-w-md"
      aria-label="Terminal RouterOS"
      onClick={focusInput}
    >
      <TerminalOutput
        connector={props.connector}
        connected={connected}
        headerLabel={headerLabel}
        prompt={prompt}
        sessionError={session.sessionError}
        sessionId={session.sessionId}
        localLines={composer.localLines}
        visible={session.visible}
        busyId={session.busyId}
        input={composer.input}
        setInput={composer.setInput}
        onInputKey={composer.onInputKey}
        inputRef={inputRef}
        scrollRef={scrollRef}
        onClear={composer.handleClear}
        onCopyAll={composer.copyAll}
        onClose={props.onClose}
      />
    </aside>
  );
}
