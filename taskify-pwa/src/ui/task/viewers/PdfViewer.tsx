import React, { useEffect, useMemo, useState } from "react";
import { ensurePdfjs } from "../../../lib/documents";
import { usePreviewViewport } from "./usePreviewViewport";
import { ViewerChrome } from "./ViewerChrome";

type RenderedPage = {
  src: string;
  width: number;
  height: number;
};

export function PdfViewer({ dataUrl }: { dataUrl: string }) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { viewportRef, scale, setScale, bindDrag, canPan } = usePreviewViewport(1, 1, 4);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);

    (async () => {
      try {
        const pdfjs = await ensurePdfjs();
        const bytes = await fetch(dataUrl).then((r) => r.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const rendered: RenderedPage[] = [];

        for (let i = 1; i <= pdf.numPages; i += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          rendered.push({
            src: canvas.toDataURL("image/png"),
            width: viewport.width,
            height: viewport.height,
          });
        }

        if (!cancelled) {
          setPages(rendered);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to render PDF");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  const scaledWidth = useMemo(() => {
    const widest = pages.reduce((max, page) => Math.max(max, page.width), 0);
    return widest > 0 ? widest * scale : 900 * scale;
  }, [pages, scale]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-white/70">Rendering PDF…</div>;
  }

  if (error || !pages.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="rounded-[28px] bg-[#1b1c20] px-6 py-8 text-center text-white/70 shadow-2xl">
          {error || "Failed to render PDF. Use Download to open the original file."}
        </div>
      </div>
    );
  }

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
        style={{ cursor: canPan ? "grab" : "auto", touchAction: canPan ? "none" : "pan-y" }}
        {...bindDrag}
      >
        <div className="flex min-h-full items-start justify-center p-4">
          <div style={{ width: `${scaledWidth}px`, maxWidth: "none", flex: "0 0 auto" }}>
            <div className="flex flex-col gap-4">
              {pages.map((page, index) => {
                const ratio = page.height / page.width;
                const pageWidth = scaledWidth;
                const pageHeight = pageWidth * ratio;
                return (
                  <img
                    key={index}
                    src={page.src}
                    alt={`PDF page ${index + 1}`}
                    className="block rounded-[22px] bg-white shadow-2xl"
                    style={{ width: `${pageWidth}px`, height: `${pageHeight}px`, maxWidth: "none" }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
