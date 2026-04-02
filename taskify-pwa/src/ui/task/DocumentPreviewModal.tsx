import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { TaskDocument, TaskDocumentPreview } from "../../lib/documents";
import { createDocumentFromDataUrl, documentAssetCacheKey, loadDocumentPreview } from "../../lib/documents";
import { Modal } from "../Modal";
import { decryptAttachment } from "../../lib/attachmentCrypto";

const resolvedDocumentCache = new Map<string, Promise<TaskDocument>>();

function formatBytes(value?: number): string | null {
  if (!value || !Number.isFinite(value)) return null;
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

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

function FullScreenAssetPreview({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/90 p-3" onClick={onClose}>
      <button type="button" className="ghost-button button-sm pressable" style={{ position: "absolute", top: 12, right: 12, zIndex: 2 }} onClick={onClose}>Close</button>
      <div className="h-full w-full pt-10" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
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
  const [fullScreenMode, setFullScreenMode] = useState<null | "pdf" | "image" | "video" | "html" | "text">(null);
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
  const sizeLabel = formatBytes(effectiveDocument.size);
  const metaRow = (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-secondary" style={{ marginBottom: "0.75rem" }}>
      <span className="rounded-full border border-surface px-2 py-1">{effectiveDocument.kind.toUpperCase()}</span>
      {sizeLabel ? <span className="rounded-full border border-surface px-2 py-1">{sizeLabel}</span> : null}
      {effectiveDocument.encrypted ? <span className="rounded-full border border-surface px-2 py-1">Encrypted</span> : null}
    </div>
  );

  let content: React.ReactNode;
  if (loadingRemote) {
    content = <div className="doc-modal__content"><div className="doc-modal__placeholder">Decrypting document…</div></div>;
  } else if (remoteError) {
    content = <div className="doc-modal__content"><div className="doc-modal__placeholder">{remoteError}</div></div>;
  } else if (effectiveDocument.kind === "pdf") {
    content = (
      <div className="doc-modal__content">
        {metaRow}
        <embed src={effectiveDocument.dataUrl} type="application/pdf" className="h-[80vh] w-full rounded-xl border border-surface bg-white" />
        <div style={{ marginTop: "0.75rem" }} className="flex gap-2">
          <button type="button" className="ghost-button button-sm pressable" onClick={() => setFullScreenMode("pdf")}>Open full screen</button>
          <button type="button" className="ghost-button button-sm pressable" onClick={() => onOpenExternal?.(effectiveDocument, decryptBoardId)}>Open in browser</button>
        </div>
      </div>
    );
  } else if (full?.type === "html") {
    content = (
      <div className="doc-modal__content">
        {metaRow}
        <div className="doc-modal__markup" style={{ maxHeight: "72vh", overflow: "auto", padding: "1rem", borderRadius: "1rem", border: "1px solid var(--color-border)" }} dangerouslySetInnerHTML={{ __html: full.data }} />
        <div style={{ marginTop: "0.75rem" }}><button type="button" className="ghost-button button-sm pressable" onClick={() => setFullScreenMode("html")}>Open full screen</button></div>
      </div>
    );
  } else if (full?.type === "text") {
    content = (
      <div className="doc-modal__content">
        {metaRow}
        <pre className="doc-modal__text" style={{ maxHeight: "72vh", overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "1rem", padding: "1rem", background: "var(--color-surface-muted)" }}>{full.data}</pre>
        <div style={{ marginTop: "0.75rem" }}><button type="button" className="ghost-button button-sm pressable" onClick={() => setFullScreenMode("text")}>Open full screen</button></div>
      </div>
    );
  } else if (full?.type === "image") {
    content = (
      <div className="doc-modal__content">
        {metaRow}
        <img src={full.data} alt={label} className="max-h-[72vh] w-full rounded-xl object-contain bg-surface-muted" />
        <div style={{ marginTop: "0.75rem" }} className="flex gap-2">
          <button type="button" className="ghost-button button-sm pressable" onClick={() => setFullScreenMode("image")}>Open full screen</button>
          <button type="button" className="ghost-button button-sm pressable" onClick={() => onOpenExternal?.(effectiveDocument, decryptBoardId)}>Open image</button>
        </div>
      </div>
    );
  } else if (full?.type === "audio") {
    content = (
      <div className="doc-modal__content">
        {metaRow}
        <div className="rounded-xl border border-surface p-4 bg-surface-muted"><audio controls src={full.data} className="w-full" /></div>
      </div>
    );
  } else if (full?.type === "video") {
    content = (
      <div className="doc-modal__content">
        {metaRow}
        <video controls src={full.data} className="max-h-[72vh] w-full rounded-xl bg-black" />
        <div style={{ marginTop: "0.75rem" }}><button type="button" className="ghost-button button-sm pressable" onClick={() => setFullScreenMode("video")}>Open full screen</button></div>
      </div>
    );
  } else {
    content = (
      <div className="doc-modal__content">
        {metaRow}
        <div className="doc-modal__placeholder">Preview unavailable. Click download to open the original file.</div>
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
    <>
      <Modal onClose={onClose} title={label} actions={actions}>
        {content}
      </Modal>
      {fullScreenMode === "pdf" && effectiveDocument.kind === "pdf" ? (
        <FullScreenAssetPreview onClose={() => setFullScreenMode(null)}>
          <embed src={effectiveDocument.dataUrl} type="application/pdf" className="h-full w-full rounded-xl bg-white" />
        </FullScreenAssetPreview>
      ) : null}
      {fullScreenMode === "image" && full?.type === "image" ? (
        <FullScreenAssetPreview onClose={() => setFullScreenMode(null)}>
          <img src={full.data} alt={label} className="h-full w-full object-contain" />
        </FullScreenAssetPreview>
      ) : null}
      {fullScreenMode === "video" && full?.type === "video" ? (
        <FullScreenAssetPreview onClose={() => setFullScreenMode(null)}>
          <video controls autoPlay src={full.data} className="h-full w-full rounded-xl bg-black" />
        </FullScreenAssetPreview>
      ) : null}
      {fullScreenMode === "html" && full?.type === "html" ? (
        <FullScreenAssetPreview onClose={() => setFullScreenMode(null)}>
          <div className="h-full overflow-auto rounded-xl bg-white p-6" dangerouslySetInnerHTML={{ __html: full.data }} />
        </FullScreenAssetPreview>
      ) : null}
      {fullScreenMode === "text" && full?.type === "text" ? (
        <FullScreenAssetPreview onClose={() => setFullScreenMode(null)}>
          <pre className="h-full overflow-auto rounded-xl bg-surface p-6 text-primary whitespace-pre-wrap">{full.data}</pre>
        </FullScreenAssetPreview>
      ) : null}
    </>
  );
}
