import React from "react";
import { ZoomPane } from "./ZoomPane";

/**
 * Image attachment viewer with scroll-based zoom and pointer drag pan.
 * Uses ZoomPane (width-based scaling) for predictable layout behaviour.
 */
export function ImageViewer({ src, alt }: { src: string; alt?: string }) {
  return (
    <ZoomPane baseWidth={1200} maxScale={4}>
      <img src={src} alt={alt ?? "Image attachment"} className="h-auto w-full object-contain" />
    </ZoomPane>
  );
}
