import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Scrollbar custom dari nol: scrollbar bawaan browser dimatikan total
// (tidak ada panah atas-bawah), thumb digambar & diseret manual.
export function useModelScroll(modelMenuOpen: boolean, modelQuery: string, providersVersion: unknown) {
  const modelScrollRef = useRef<HTMLDivElement>(null);
  const modelTrackRef = useRef<HTMLDivElement>(null);
  const modelDragRef = useRef<{ startY: number; startTop: number } | null>(null);
  const [modelThumb, setModelThumb] = useState({ top: 0, height: 0, visible: false });

  const updateModelThumb = useCallback(() => {
    const el = modelScrollRef.current;
    const track = modelTrackRef.current;
    if (!el || !track) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const trackH = track.clientHeight;
    if (scrollHeight <= clientHeight + 1 || trackH <= 0) {
      setModelThumb((t) => (t.visible ? { ...t, visible: false } : t));
      return;
    }
    const height = Math.max(24, (clientHeight / scrollHeight) * trackH);
    const maxTop = Math.max(1, trackH - height);
    const top = Math.min(maxTop, (scrollTop / (scrollHeight - clientHeight)) * maxTop);
    setModelThumb({ top, height, visible: true });
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const raf = requestAnimationFrame(updateModelThumb);
    window.addEventListener("resize", updateModelThumb);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateModelThumb);
    };
  }, [modelMenuOpen, modelQuery, providersVersion, updateModelThumb]);

  function onModelThumbPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    const el = modelScrollRef.current;
    const track = modelTrackRef.current;
    if (!el || !track) return;
    const trackH = track.clientHeight;
    const height = Math.max(24, (el.clientHeight / el.scrollHeight) * trackH);
    const maxTop = Math.max(1, trackH - height);
    modelDragRef.current = { startY: e.clientY, startTop: el.scrollTop };
    const move = (ev: PointerEvent) => {
      const d = modelDragRef.current;
      if (!d) return;
      el.scrollTop = d.startTop + ((ev.clientY - d.startY) / maxTop) * (el.scrollHeight - el.clientHeight);
    };
    const up = () => {
      modelDragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onModelTrackPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const el = modelScrollRef.current;
    const track = modelTrackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) return;
    el.scrollTop = ((e.clientY - rect.top) / rect.height) * (el.scrollHeight - el.clientHeight);
  }

  return { modelScrollRef, modelTrackRef, modelThumb, updateModelThumb, onModelThumbPointerDown, onModelTrackPointerDown };
}

export type ModelScroll = ReturnType<typeof useModelScroll>;
