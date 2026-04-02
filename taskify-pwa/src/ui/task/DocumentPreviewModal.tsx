import React, { useState, useEffect } from "react";
import type { TaskDocument, TaskDocumentPreview } from "../../lib/documents";
import { loadDocumentPreview } from "../../lib/documents";
import { Modal } from "../Modal";
import { decryptAttachment } from "../../lib/attachmentCrypto";

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
  boardId,
  onClose,
  onDownloadDocument,
  onOpenExternal,
}: {
  document: TaskDocument;
  boardId?: string;
  onClose: () => void;
  onDownloadDocument?: (doc: TaskDocument) => void;
  onOpenExternal?: (doc: TaskDocument) => void;
}) {
  const [resolvedDataUrl, setResolvedDataUrl] = useState<string | null>(document.dataUrl || null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const full = document.full;
  const label = document.name || "Document";
  const decryptBoardId = document.encryptionBoardId || boardId;

  useEffect(() => {
    let cancelled = false;
    if (!document.remoteUrl) {
      setResolvedDataUrl(document.dataUrl || null);
      setLoadingRemote(false);
      setRemoteError(null);
      return;
    }
    if (document.encrypted && decryptBoardId) {
      console.info("[attachment-debug] document-preview:decrypt-context", {
        documentId: document.id,
        documentName: document.name,
        boardIdProp: boardId,
        encryptionBoardId: document.encryptionBoardId,
        decryptBoardId,
      });
      setLoadingRemote(true);
      setRemoteError(null);
      decryptAttachment({ boardId: decryptBoardId, url: document.remoteUrl, mimeType: document.mimeType })
        .then((dataUrl) => {
          if (cancelled) return;
          setResolvedDataUrl(dataUrl);
          setLoadingRemote(false);
        })
        .catch((err: any) => {
          if (cancelled) return;
          setRemoteError(err?.message || "Failed to decrypt document");
          setLoadingRemote(false);
        });
      return () => {
        cancelled = true;
      };
    }
    setResolvedDataUrl(document.remoteUrl);
    setLoadingRemote(false);
    setRemoteError(null);
    return () => {
      cancelled = true;
    };
  }, [document, boardId, decryptBoardId]);

  const effectiveDocument = resolvedDataUrl && resolvedDataUrl !== document.dataUrl
    ? { ...document, dataUrl: resolvedDataUrl }
    : document;

  let content: React.ReactNode;
  if (loadingRemote) {
    content = <div className="doc-modal__content"><div className="doc-modal__placeholder">Decrypting document…</div></div>;
  } else if (remoteError) {
    content = <div className="doc-modal__content"><div className="doc-modal__placeholder">{remoteError}</div></div>;
  } else if (effectiveDocument.kind === "pdf") {
    content = (
      <div className="doc-modal__content">
        <div className="doc-modal__placeholder">
          <div>PDF previews open in a new tab for the best experience.</div>
          <button
            type="button"
            className="ghost-button button-sm pressable"
            style={{ marginTop: "0.75rem" }}
            onClick={() => onOpenExternal?.(effectiveDocument)}
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
  } else if (full?.type === "image") {
    content = (
      <div className="doc-modal__content">
        <img src={full.data} alt={label} className="max-h-[70vh] w-full object-contain" />
      </div>
    );
  } else if (full?.type === "audio") {
    content = (
      <div className="doc-modal__content">
        <audio controls src={full.data} className="w-full" />
      </div>
    );
  } else if (full?.type === "video") {
    content = (
      <div className="doc-modal__content">
        <video controls src={full.data} className="max-h-[70vh] w-full" />
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
        onClick={() => onDownloadDocument?.(effectiveDocument)}
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
