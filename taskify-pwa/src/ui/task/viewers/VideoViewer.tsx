import React, { useState } from "react";

export function VideoViewer({ src, poster }: { src: string; poster?: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  return (
    <div className="flex h-full items-center justify-center rounded-[28px] bg-black p-2 shadow-2xl">
      <div className="relative w-full">
        {status !== "ready" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[22px] bg-black/70 text-sm text-white/80">
            {status === "error" ? (errorMessage || "Failed to load video preview") : "Loading video…"}
          </div>
        )}
        <video
          controls
          autoPlay
          playsInline
          preload="metadata"
          poster={poster}
          src={src}
          className="max-h-full w-full rounded-[22px] bg-black"
          onLoadedMetadata={() => setStatus("ready")}
          onCanPlay={() => setStatus("ready")}
          onError={(event) => {
            const media = event.currentTarget;
            const message = media.error
              ? `Video error ${media.error.code}${media.error.message ? `: ${media.error.message}` : ""}`
              : "Failed to load video preview";
            console.info("[attachment-debug] video:error", {
              src: src.slice(0, 80),
              readyState: media.readyState,
              networkState: media.networkState,
              errorCode: media.error?.code,
              errorMessage: media.error?.message,
            });
            setErrorMessage(message);
            setStatus("error");
          }}
        />
      </div>
    </div>
  );
}
