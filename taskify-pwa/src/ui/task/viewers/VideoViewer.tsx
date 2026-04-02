import React from "react";

/**
 * Video attachment viewer. Renders a native <video> element with controls
 * and optional poster thumbnail from the document's image preview.
 */
export function VideoViewer({ src, poster }: { src: string; poster?: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-[28px] bg-black p-2 shadow-2xl">
      <video
        controls
        autoPlay
        poster={poster}
        src={src}
        className="max-h-full w-full rounded-[22px] bg-black"
      />
    </div>
  );
}
