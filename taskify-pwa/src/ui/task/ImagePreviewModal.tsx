import React, { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface ImagePreviewModalProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

export function ImagePreviewModal({ src, alt, onClose }: ImagePreviewModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    // Prevent body scroll while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [handleKeyDown]);

  const portal = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      {/* Close button */}
      <button
        type="button"
        className="absolute right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white text-xl leading-none pressable"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close preview"
      >
        ×
      </button>
      {/* Image — stop propagation so tapping the image itself doesn't close */}
      <img
        src={src}
        alt={alt ?? "Attachment preview"}
        className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(portal, document.body)
    : null;
}
