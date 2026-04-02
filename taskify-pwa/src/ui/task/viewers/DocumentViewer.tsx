import React from "react";
import { usePreviewViewport } from "./usePreviewViewport";
import { ViewerChrome } from "./ViewerChrome";

interface DocumentContent {
  type: "html" | "text";
  data: string;
}

export function DocumentViewer({ content }: { content: DocumentContent }) {
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
        <div className="flex min-h-full items-start justify-center p-4">
          <div style={{ width: `${960 * scale}px`, maxWidth: "none", flex: "0 0 auto" }}>
            <div className="rounded-[28px] bg-white px-6 py-8 text-[#111827] shadow-2xl" style={{ width: "100%", maxWidth: "none" }}>
              {content.type === "html" ? (
                <div className="doc-modal__markup doc-modal__markup--rich" dangerouslySetInnerHTML={{ __html: content.data }} />
              ) : (
                <pre className="doc-modal__text whitespace-pre-wrap break-words text-[15px] leading-7 text-[#111827]">{content.data}</pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
