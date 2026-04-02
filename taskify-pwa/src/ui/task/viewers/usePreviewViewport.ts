import { useEffect, useRef, useState } from "react";

export function usePreviewViewport(initialScale = 1, minScale = 1, maxScale = 4) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScaleState] = useState(initialScale);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const setScale = (updater: number | ((prev: number) => number)) => {
    const viewport = viewportRef.current;
    const prev = scale;
    const rawNext = typeof updater === "function" ? updater(prev) : updater;
    const next = Math.max(minScale, Math.min(maxScale, rawNext));
    if (!viewport || next === prev) {
      setScaleState(next);
      return;
    }

    const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
    const centerY = viewport.scrollTop + viewport.clientHeight / 2;
    const relX = centerX / Math.max(prev, 0.0001);
    const relY = centerY / Math.max(prev, 0.0001);

    setScaleState(next);

    requestAnimationFrame(() => {
      const current = viewportRef.current;
      if (!current) return;
      current.scrollLeft = Math.max(0, relX * next - current.clientWidth / 2);
      current.scrollTop = Math.max(0, relY * next - current.clientHeight / 2);
    });
  };

  useEffect(() => {
    const handlePointerUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  const bindDrag = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport || scale <= 1) return;
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport || !dragRef.current || scale <= 1) return;
      e.preventDefault();
      viewport.scrollLeft = dragRef.current.left - (e.clientX - dragRef.current.x);
      viewport.scrollTop = dragRef.current.top - (e.clientY - dragRef.current.y);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      setDragging(false);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    },
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      setDragging(false);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    },
  };

  return {
    viewportRef,
    scale,
    setScale,
    dragging,
    bindDrag,
    canPan: scale > 1,
  };
}
