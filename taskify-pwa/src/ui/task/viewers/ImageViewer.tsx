import React from "react";
import { usePreviewViewport } from "./usePreviewViewport";
import { ViewerChrome } from "./ViewerChrome";

export function ImageViewer({ src, alt }: { src: string; alt: string }) {
  const { viewportRef, scale, setScale, bindDrag, canPan } = usePreviewViewport(1, 1, 5);

  return (
    <div className="relative h-full overflow-hidden rounded-[28px] bg-[#0f1012]">
      <ViewerChrome
        scale={scale}
        onZoomOut={() => setScale((s) => s - 0.25)}
        onReset={() => setScale(1)}
        onZoomIn={() => setScale((s) => s + 0.25)}
      />
      <div
        ref={viewportRef}
        className="h-full overflow-auto"
        style={{ cursor: canPan ? "grab" : "auto", touchAction: canPan ? "none" : "auto" }}
        {...bindDrag}
      >
        <div className="flex min-h-full min-w-full items-center justify-center p-6">
          <img
            src={src}
            alt={alt}
            className="block max-w-none rounded-[22px] shadow-2xl"
            style={{ width: `${scale * 100}%`, height: "auto" }}
          />
        </div>
      </div>
    </div>
  );
}
