import { useEffect, useRef, useState } from "react";

export function useChatScroll(
  messageCount: number,
  streamText: string,
  toolCount: number,
  runLive: boolean,
  activityCount: number | undefined,
) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      nearBottomRef.current = near;
      setShowJump(!near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) {
      const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      bottomRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
    }
  }, [messageCount, streamText, toolCount, runLive, activityCount]);

  function jumpToLatest() {
    nearBottomRef.current = true;
    setShowJump(false);
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
  }

  return { bottomRef, containerRef, showJump, jumpToLatest };
}
