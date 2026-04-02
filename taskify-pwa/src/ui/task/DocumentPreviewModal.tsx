import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { TaskDocument, TaskDocumentPreview } from "../../lib/documents";
import { createDocumentFromDataUrl, documentAssetCacheKey, loadDocumentPreview } from "../../lib/documents";
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

function ViewerShell({ title, subtitle, actions, children, onClose }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-[#111214]/95 text-white" onClick={onClose}>
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-3 pb-4 pt-[max(14px,env(safe-area-inset-top))]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 pb-3">
          <button type="button" className="ghost-button button-sm pressable" onClick={onClose}>Close</button>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-sm font-medium text-white">{title}</div>
            {subtitle ? <div className="truncate text-xs text-white/60">{subtitle}</div> : null}
          </div>
          <div className="flex min-w-[72px] justify-end gap-2">{actions}</div>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
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
  const subtitle = [effectiveDocument.kind.toUpperCase(), sizeLabel, effectiveDocument.encrypted ? "Encrypted" : null].filter(Boolean).join(" • ");

  let content: React.ReactNode;
  if (loadingRemote) {
    content = <div className="doc-modal__content"><div className="doc-modal__placeholder">Decrypting document…</div></div>;
  } else if (remoteError) {
    content = <div className="doc-modal__content"><div className="doc-modal__placeholder">{remoteError}</div></div>;
  } else if (effectiveDocument.kind === "pdf") {
    content = (
      <div className="doc-modal__content">
        <div className="flex h-full flex-col gap-3"><div className="min-h-0 flex-1 rounded-[28px] bg-[#1b1c20] p-3 shadow-2xl"><embed src={effectiveDocument.dataUrl} type="application/pdf" className="h-full w-full rounded-[22px] bg-white" /></div><div className="flex justify-center gap-2"><button type="button" className="ghost-button button-sm pressable" onClick={() => setFullScreenMode("pdf")}>Full screen</button><button type="button" className="ghost-button button-sm pressable" onClick={() => onOpenExternal?.(effectiveDocument, decryptBoardId)}>Open in browser</button></div></div>
      </div>
    );
  } else if (full?.type === "html") {
    content = (
      <div className="doc-modal__content">
        <div className="flex h-full flex-col gap-3"><div className="min-h-0 flex-1 overflow-auto rounded-[28px] bg-white p-6 text-black shadow-2xl"><div className="doc-modal__markup" dangerouslySetInnerHTML={{ __html: full.data }} /></div><div className="flex justify-center"><button type="button" className="ghost-button button-sm pressable" onClick={() => setFullScreenMode("html")}>Full screen</button></div></div>
      </div>
    );
  } else if (full?.type === "text") {
    content = (
      <div className="doc-modal__content">
        <div className="flex h-full flex-col gap-3"><div className="min-h-0 flex-1 overflow-auto rounded-[28px] bg-white p-6 text-black shadow-2xl"><pre className="doc-modal__text whitespace-pre-wrap">{full.data}</pre></div><div className="flex justify-center"><button type="button" className="ghost-button button-sm pressable" onClick={() => setFullScreenMode("text")}>Full screen</button></div></div>
      </div>
    );
  } else if (full?.type === "image") {
    content = (
      <div className="doc-modal__content">
        <div className="flex h-full flex-col gap-3"><div className="flex min-h-0 flex-1 items-center justify-center rounded-[28px] bg-[#1b1c20] p-4 shadow-2xl"><img src={full.data} alt={label} className="max-h-full max-w-full rounded-[22px] object-contain" /></div><div className="flex justify-center gap-2"><button type="button" className="ghost-button button-sm pressable" onClick={() => setFullScreenMode("image")}>Full screen</button><button type="button" className="ghost-button button-sm pressable" onClick={() => onOpenExternal?.(effectiveDocument, decryptBoardId)}>Open image</button></div></div>
      </div>
    );
  } else if (full?.type === "audio") {
    content = (
      <div className="doc-modal__content">
        <div className="flex h-full items-center justify-center"><div className="w-full max-w-xl rounded-[28px] bg-[#1b1c20] p-6 shadow-2xl"><div className="mb-4 text-center text-sm text-white/70">Audio attachment</div><audio controls src={full.data} className="w-full" /></div></div>
      </div>
    );
  } else if (full?.type === "video") {
    content = (
      <div className="doc-modal__content">
        <div className="flex h-full flex-col gap-3"><div className="flex min-h-0 flex-1 items-center justify-center rounded-[28px] bg-black p-2 shadow-2xl"><video controls src={full.data} className="max-h-full w-full rounded-[22px] bg-black" /></div><div className="flex justify-center"><button type="button" className="ghost-button button-sm pressable" onClick={() => setFullScreenMode("video")}>Full screen</button></div></div>
      </div>
    );
  } else {
    content = (
      <div className="doc-modal__content">
        <div className="flex h-full items-center justify-center"><div className="rounded-[28px] bg-[#1b1c20] px-6 py-8 text-center text-white/70 shadow-2xl">Preview unavailable. Use Download to open the original file.</div></div>
      </div>
    );
  }

  const actions = (
    <>
      {onOpenExternal ? (
        <button
          type="button"
          className="ghost-button button-sm pressable"
          onClick={() => onOpenExternal?.(effectiveDocument, decryptBoardId)}
        >
          Open
        </button>
      ) : null}
      <button
        type="button"
        className="ghost-button button-sm pressable"
        onClick={() => onDownloadDocument?.(effectiveDocument, decryptBoardId)}
      >
        Download
      </button>
    </>
  );

  return (
    <>
      <ViewerShell title={label} subtitle={subtitle} actions={actions} onClose={onClose}>
        {content}
      </ViewerShell>
      {fullScreenMode === "pdf" && effectiveDocument.kind === "pdf" ? (
        <ViewerShell title={label} subtitle={subtitle} actions={actions} onClose={() => setFullScreenMode(null)}>
          <div className="h-full rounded-[28px] bg-[#1b1c20] p-3"><embed src={effectiveDocument.dataUrl} type="application/pdf" className="h-full w-full rounded-[22px] bg-white" /></div>
        </ViewerShell>
      ) : null}
      {fullScreenMode === "image" && full?.type === "image" ? (
        <ViewerShell title={label} subtitle={subtitle} actions={actions} onClose={() => setFullScreenMode(null)}>
          <div className="flex h-full items-center justify-center"><img src={full.data} alt={label} className="max-h-full max-w-full object-contain" /></div>
        </ViewerShell>
      ) : null}
      {fullScreenMode === "video" && full?.type === "video" ? (
        <ViewerShell title={label} subtitle={subtitle} actions={actions} onClose={() => setFullScreenMode(null)}>
          <div className="flex h-full items-center justify-center rounded-[28px] bg-black p-2"><video controls autoPlay src={full.data} className="max-h-full w-full rounded-[22px] bg-black" /></div>
        </ViewerShell>
      ) : null}
      {fullScreenMode === "html" && full?.type === "html" ? (
        <ViewerShell title={label} subtitle={subtitle} actions={actions} onClose={() => setFullScreenMode(null)}>
          <div className="h-full overflow-auto rounded-[28px] bg-white p-6 text-black" dangerouslySetInnerHTML={{ __html: full.data }} />
        </ViewerShell>
      ) : null}
      {fullScreenMode === "text" && full?.type === "text" ? (
        <ViewerShell title={label} subtitle={subtitle} actions={actions} onClose={() => setFullScreenMode(null)}>
          <pre className="h-full overflow-auto rounded-[28px] bg-white p-6 text-black whitespace-pre-wrap">{full.data}</pre>
        </ViewerShell>
      ) : null}
    </>
  );
}
