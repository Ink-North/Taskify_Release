import React, { useEffect, useState } from "react";
import { ensurePdfjs } from "../../../lib/documents";
import { ZoomPane } from "./ZoomPane";

/**
 * Multi-page PDF viewer. Renders all pages at high resolution once, then
 * lets ZoomPane handle display zoom + pan — no re-render on zoom.
 */
export function PdfViewer({ dataUrl }: { dataUrl: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Render resolution: 2x gives sharp text even when display-zoomed to 200%
  const RENDER_SCALE = 2.0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setPages([]);

    (async () => {
      try {
        const pdfjs = await ensurePdfjs();
        const bytes = await fetch(dataUrl).then((r) => r.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const rendered: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          rendered.push(canvas.toDataURL("image/png"));
        }
        if (!cancelled) {
          setPages(rendered);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-white/70">
        Rendering PDF…
      </div>
    );
  }

  if (error || pages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="rounded-[28px] bg-[#1b1c20] px-6 py-8 text-center text-white/70 shadow-2xl">
          Failed to render PDF. Use Download to open the original file.
        </div>
      </div>
    );
  }

  return (
    <ZoomPane baseWidth={900} maxScale={4}>
      <div className="flex flex-col gap-4 pb-2">
        {pages.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={`Page ${i + 1}`}
            className="w-full rounded-[22px] bg-white shadow-2xl"
          />
        ))}
      </div>
    </ZoomPane>
  );
}
