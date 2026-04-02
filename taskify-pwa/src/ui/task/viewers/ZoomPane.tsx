import React, { useRef, useState } from "react";

/**
 * Scroll-based zoom/pan container. Zooms by resizing the inner content width,
 * pans via pointer drag or native scroll. No CSS transform hacks.
 */
export function ZoomPane({
  children,
  pageClassName = "",
  zoomable = true,
  baseWidth = 960,
  minScale = 1,
  maxScale = 4,
  step = 0.25,
}: {
  children: React.ReactNode;
  pageClassName?: string;
  zoomable?: boolean;
  baseWidth?: number;
  minScale?: number;
  maxScale?: number;
  step?: number;
}) {
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const scaledWidth = Math.round(baseWidth * scale);
  const applyScale = (next: number) => setScale(Math.max(minScale, Math.min(maxScale, next)));

  return (
    <div className="relative h-full overflow-hidden">
      {zoomable ? (
        <div className="absolute right-3 top-3 z-[30] flex gap-2 rounded-full bg-black/45 p-1 backdrop-blur">
          <button
            type="button"
            className="ghost-button button-sm pressable"
            onClick={() => applyScale(scale - step)}
          >
            −
          </button>
          <button
            type="button"
            className="ghost-button button-sm pressable"
            onClick={() => applyScale(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            className="ghost-button button-sm pressable"
            onClick={() => applyScale(scale + step)}
          >
            +
          </button>
        </div>
      ) : null}
      <div
        ref={viewportRef}
        className="h-full overflow-auto"
        style={{ touchAction: scale > 1 ? "none" : "auto", cursor: scale > 1 ? "grab" : "auto" }}
        onPointerDown={(e) => {
          if (scale <= 1 || !viewportRef.current) return;
          draggingRef.current = {
            x: e.clientX,
            y: e.clientY,
            left: viewportRef.current.scrollLeft,
            top: viewportRef.current.scrollTop,
          };
          (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current || !viewportRef.current || scale <= 1) return;
          e.preventDefault();
          viewportRef.current.scrollLeft =
            draggingRef.current.left - (e.clientX - draggingRef.current.x);
          viewportRef.current.scrollTop =
            draggingRef.current.top - (e.clientY - draggingRef.current.y);
        }}
        onPointerUp={(e) => {
          draggingRef.current = null;
          (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={(e) => {
          draggingRef.current = null;
          (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
        }}
      >
        <div className="flex min-h-full items-start justify-center p-4">
          <div style={{ width: `${scaledWidth}px`, maxWidth: "none" }}>
            <div className={pageClassName} style={{ width: "100%", maxWidth: "none" }}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
