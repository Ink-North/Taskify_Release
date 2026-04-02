import React, { useState, useEffect } from "react";
import type { TaskDocument, TaskDocumentPreview } from "../../lib/documents";
import { createDocumentFromDataUrl, documentAssetCacheKey, loadDocumentPreview } from "../../lib/documents";
import { Modal } from "../Modal";
import { decryptAttachment } from "../../lib/attachmentCrypto";

const resolvedDocumentCache = new Map<string, Promise<TaskDocument>>();

async function resolveDocumentAsset(doc: TaskDocument, boardId?: string): Promise<TaskDocument> {
  if (!doc.remoteUrl) return doc;
  const decryptBoardId = doc.encryptionBoardId || boardId;
  const cacheKey = documentAssetCacheKey(doc, boardId);
  const cached = resolvedDocumentCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    if (doc.encrypted && decryptBoardId) {
      console.info("[attachment-debug] document-resolve:decrypt-context", {
        documentId: doc.id,
        documentName: doc.name,
        boardIdProp: boardId,
        encryptionBoardId: doc.encryptionBoardId,
        decryptBoardId,
        cacheKey,
      });
      const dataUrl = await decryptAttachment({ boardId: decryptBoardId, url: doc.remoteUrl, mimeType: doc.mimeType });
      return createDocumentFromDataUrl({
        id: doc.id,
        name: doc.name,
        mimeType: doc.mimeType,
        dataUrl,
        createdAt: doc.createdAt,
        size: doc.size,
        remoteUrl: doc.remoteUrl,
        encrypted: doc.encrypted,
        encryptionBoardId: doc.encryptionBoardId || decryptBoardId,
      });
    }

    return createDocumentFromDataUrl({
      id: doc.id,
      name: doc.name,
      mimeType: doc.mimeType,
      dataUrl: doc.remoteUrl,
      createdAt: doc.createdAt,
      size: doc.size,
      remoteUrl: doc.remoteUrl,
      encrypted: doc.encrypted,
      encryptionBoardId: doc.encryptionBoardId,
    });
  })().catch((err) => {
    resolvedDocumentCache.delete(cacheKey);
    throw err;
  });

  resolvedDocumentCache.set(cacheKey, promise);
  return promise;
}

export function DocumentThumbnail({ document: doc, boardId, onClick }: { document: TaskDocument; boardId?: string; onClick: () => void }) {
  const [derivedPreview, setDerivedPreview] = useState<TaskDocumentPreview | null>(doc.preview ?? null);

  useEffect(() => {
    let cancelled = false;
    if (doc.preview && !doc.remoteUrl) {
      setDerivedPreview(doc.preview);
      return () => {
        cancelled = true;
      };
    }
    setDerivedPreview(doc.preview ?? null);
    resolveDocumentAsset(doc, boardId)
      .then((resolved) => loadDocumentPreview(resolved))
      .then((next) => {
        if (!cancelled) {
          setDerivedPreview(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDerivedPreview(doc.preview ?? null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [doc, boardId]);

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
  onDownloadDocument?: (doc: TaskDocument, boardId?: string) => void;
  onOpenExternal?: (doc: TaskDocument, boardId?: string) => void;
}) {
  const [resolvedDocument, setResolvedDocument] = useState<TaskDocument>(document);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const label = document.name || "Document";
  const decryptBoardId = document.encryptionBoardId || boardId;

  useEffect(() => {
    let cancelled = false;
    if (!document.remoteUrl) {
      setResolvedDocument(document);
      setLoadingRemote(false);
      setRemoteError(null);
      return;
    }
    setLoadingRemote(true);
    setRemoteError(null);
    resolveDocumentAsset(document, boardId)
      .then((resolved) => {
        if (cancelled) return;
        setResolvedDocument(resolved);
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
  }, [document, boardId]);

  const effectiveDocument = resolvedDocument;
  const full = effectiveDocument.full;

  let content: React.ReactNode;
  if (loadingRemote) {
    content = <div className="doc-modal__content"><div className="doc-modal__placeholder">Decrypting document…</div></div>;
  } else if (remoteError) {
    content = <div className="doc-modal__content"><div className="doc-modal__placeholder">{remoteError}</div></div>;
  } else if (effectiveDocument.kind === "pdf") {
    content = (
      <div className="doc-modal__content">
        <iframe src={effectiveDocument.dataUrl} title={label} className="h-[70vh] w-full rounded-xl border border-surface bg-white" />
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
        onClick={() => onDownloadDocument?.(effectiveDocument, decryptBoardId)}
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
