import React from "react";
import { usePreviewViewport } from "./usePreviewViewport";
import { ViewerChrome } from "./ViewerChrome";

export function SpreadsheetViewer({ html }: { html: string }) {
  const { viewportRef, scale, setScale, bindDrag, canPan } = usePreviewViewport(1, 1, 4);

  return (
    <div className="relative h-full overflow-hidden rounded-[28px] bg-[#15161a]">
      <ViewerChrome
        scale={scale}
        onZoomOut={() => setScale((s) => s - 0.2)}
        onReset={() => setScale(1)}
        onZoomIn={() => setScale((s) => s + 0.2)}
      />
      <div
        ref={viewportRef}
        className="h-full overflow-auto"
        style={{ cursor: canPan ? "grab" : "auto", touchAction: canPan ? "none" : "pan-x pan-y" }}
        {...bindDrag}
      >
        <div className="min-h-full min-w-full p-4">
          <div style={{ width: `${1100 * scale}px`, maxWidth: "none" }}>
            <style>{`
              .spreadsheet-viewer table { width: max-content !important; min-width: 100%; border-collapse: collapse; }
              .spreadsheet-viewer th, .spreadsheet-viewer td, .spreadsheet-viewer tr, .spreadsheet-viewer thead, .spreadsheet-viewer tbody {
                position: static !important;
              }
              .spreadsheet-viewer td, .spreadsheet-viewer th {
                white-space: nowrap;
              }
            `}</style>
            <div className="spreadsheet-viewer rounded-[22px] bg-white p-4 text-[#111827] shadow-2xl" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    </div>
  );
}
