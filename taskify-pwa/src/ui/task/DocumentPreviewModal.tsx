import React, { useState, useEffect } from "react";
import type { TaskDocument, TaskDocumentPreview } from "../../lib/documents";
import { loadDocumentPreview } from "../../lib/documents";
import { Modal } from "../Modal";

export function DocumentThumbnail({ document: doc, onClick }: { document: TaskDocument; onClick: () => void }) {
  const [derivedPreview, setDerivedPreview] = useState<TaskDocumentPreview | null>(doc.preview ?? null);

  useEffect(() => {
    let cancelled = false;
    if (doc.preview) {
      setDerivedPreview(doc.preview);
      return () => {
        cancelled = true;
      };
    }
    setDerivedPreview(null);
    loadDocumentPreview(doc).then((next) => {
      if (!cancelled) {
        setDerivedPreview(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const preview = derivedPreview ?? doc.preview ?? null;
  const label = doc.name || "Document";
  let previewNode: React.ReactNode;
  if (preview?.type === "image") {
    previewNode = <img src={preview.data} alt="" className="doc-thumb__image" />;
  } else if (preview?.type === "html") {
    previewNode = <div className="doc-thumb__html" dangerouslySetInnerHTML={{ __html: preview.data }} />;
  } else if (preview?.type === "text") {
    const snippet = preview.data.split(/\n+/).slice(0, 6).join("\n");
    previewNode = <pre className="doc-thumb__text">{snippet}</pre>;
  } else if (preview) {
    previewNode = <div className="doc-thumb__placeholder">Preview unavailable</div>;
  } else {
    return (
      <button type="button" className="doc-thumb doc-thumb--compact" onClick={onClick}>
        <span className="doc-thumb__name" title={label}>
          {label}
        </span>
        <span className="doc-thumb__kind">{doc.kind.toUpperCase()}</span>
      </button>
    );
  }

  return (
    <button type="button" className="doc-thumb" onClick={onClick}>
      <div className="doc-thumb__preview">
        {previewNode}
      </div>
      <div className="doc-thumb__footer">
        <span className="doc-thumb__name" title={label}>{label}</span>
        <span className="doc-thumb__kind">{doc.kind.toUpperCase()}</span>
      </div>
    </button>
  );
}

export function DocumentPreviewModal({
  document,
  onClose,
  onDownloadDocument,
  onOpenExternal,
}: {
  document: TaskDocument;
  onClose: () => void;
  onDownloadDocument?: (doc: TaskDocument) => void;
  onOpenExternal?: (doc: TaskDocument) => void;
}) {
  const full = document.full;
  const label = document.name || "Document";

  let content: React.ReactNode;
  if (document.kind === "pdf") {
    content = (
      <div className="doc-modal__content">
        <div className="doc-modal__placeholder">
          <div>PDF previews open in a new tab for the best experience.</div>
          <button
            type="button"
            className="ghost-button button-sm pressable"
            style={{ marginTop: "0.75rem" }}
            onClick={() => onOpenExternal?.(document)}
          >
            Open full screen
          </button>
        </div>
      </div>
    );
  } else if (full?.type === "html") {
    content = (
      <div className="doc-modal__content">
        <div
          className="doc-modal__markup"
          dangerouslySetInnerHTML={{ __html: full.data }}
        />
      </div>
    );
  } else if (full?.type === "text") {
    content = (
      <div className="doc-modal__content">
        <pre className="doc-modal__text">{full.data}</pre>
      </div>
    );
  } else {
    content = (
      <div className="doc-modal__content">
        <div className="doc-modal__placeholder">
          Preview unavailable. Click download to open the original file.
        </div>
      </div>
    );
  }

  const actions = (
    <div className="doc-modal__action-buttons">
      <button
        type="button"
        className="ghost-button button-sm pressable"
        onClick={() => onDownloadDocument?.(document)}
      >
        Download
      </button>
    </div>
  );

  return (
    <Modal onClose={onClose} title={label} actions={actions}>
      {content}
    </Modal>
  );
}
