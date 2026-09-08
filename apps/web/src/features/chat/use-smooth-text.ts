import { useEffect, useRef, useState } from "react";

export interface SmoothTextOptions {
  /** Disabled smooth animation (e.g. for accessibility / reduced motion). */
  disabled?: boolean;
}

const isBrowser = typeof window !== "undefined" && typeof requestAnimationFrame !== "undefined";

/**
 * High-performance smooth text typewriter hook using requestAnimationFrame and time-based interpolation.
 * Transforms bursty/choppy SSE token deltas into a fluid, silky-smooth typewriter effect.
 *
 * Pacing:
 * - Natural reading cadence: ~22ms per character (~45 chars/s) for short texts.
 * - Dynamically scales up for longer texts so it never lags behind large responses.
 * - Completes smoothly even if background connection closes.
 */
export function useSmoothText(
  targetText: string,
  active: boolean,
  options: SmoothTextOptions = {},
): { displayedText: string; isTyping: boolean } {
  const [displayedText, setDisplayedText] = useState(active && isBrowser && !options.disabled ? "" : targetText);
  const targetRef = useRef(targetText);
  targetRef.current = targetText;
  const displayedRef = useRef(displayedText);
  displayedRef.current = displayedText;
  const lastTickRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    if (!isBrowser || options.disabled) {
      setDisplayedText(targetText);
      setIsTyping(false);
      return;
    }

    // When reset or target is empty, immediately sync
    if (!targetText) {
      setDisplayedText("");
      displayedRef.current = "";
      setIsTyping(false);
      return;
    }

    // Animation loop for smooth typewriter effect
    const tick = (now: number) => {
      const current = displayedRef.current;
      const target = targetRef.current;

      if (current.length >= target.length) {
        rafRef.current = null;
        setIsTyping(false);
        return;
      }

      if (lastTickRef.current === 0) {
        lastTickRef.current = now;
      }

      const elapsed = now - lastTickRef.current;
      const remaining = target.length - current.length;

      // Pacing calculation:
      // <= 25 chars remaining: 22ms per char (~45 chars/s)
      // <= 60 chars remaining: 15ms per char (~66 chars/s)
      // <= 120 chars remaining: 8ms per char (~125 chars/s)
      // > 120 chars remaining: 4ms per char (~250 chars/s)
      const msPerChar = remaining > 120 ? 4 : remaining > 60 ? 8 : remaining > 25 ? 15 : 22;

      if (elapsed >= msPerChar) {
        const charsToAdd = Math.max(1, Math.floor(elapsed / msPerChar));
        const nextLength = Math.min(target.length, current.length + charsToAdd);
        const nextText = target.slice(0, nextLength);
        setDisplayedText(nextText);
        displayedRef.current = nextText;
        lastTickRef.current = now;
      }

      if (displayedRef.current.length < targetRef.current.length) {
        setIsTyping(true);
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        setIsTyping(false);
      }
    };

    if (displayedRef.current.length < targetText.length) {
      setIsTyping(true);
      if (rafRef.current === null) {
        lastTickRef.current = 0;
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [targetText, active, options.disabled]);

  return { displayedText, isTyping };
}
