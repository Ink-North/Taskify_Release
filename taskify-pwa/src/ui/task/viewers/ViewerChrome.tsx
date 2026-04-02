import React from "react";

export function ViewerChrome({
  scale,
  onZoomOut,
  onReset,
  onZoomIn,
}: {
  scale: number;
  onZoomOut: () => void;
  onReset: () => void;
  onZoomIn: () => void;
}) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[40] flex gap-2 rounded-full bg-black/55 p-1 shadow-lg backdrop-blur-sm">
      <button type="button" className="pointer-events-auto ghost-button button-sm pressable" onClick={onZoomOut}>−</button>
      <button type="button" className="pointer-events-auto ghost-button button-sm pressable min-w-[72px]" onClick={onReset}>{Math.round(scale * 100)}%</button>
      <button type="button" className="pointer-events-auto ghost-button button-sm pressable" onClick={onZoomIn}>+</button>
    </div>
  );
}
