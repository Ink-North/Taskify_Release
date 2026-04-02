import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TaskDocument, TaskDocumentPreview } from "../../lib/documents";
import { createDocumentFromDataUrl, documentAssetCacheKey, ensurePdfjs, loadDocumentPreview } from "../../lib/documents";
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
    const dataUrl = doc.encrypted && decryptBoardId
      ? await decryptAttachment({ boardId: decryptBoardId, url: doc.remoteUrl!, mimeType: doc.mimeType })
      : doc.remoteUrl!;
    return createDocumentFromDataUrl({ id: doc.id, name: doc.name, mimeType: doc.mimeType, dataUrl, createdAt: doc.createdAt, size: doc.size, remoteUrl: doc.remoteUrl, encrypted: doc.encrypted, encryptionBoardId: doc.encryptionBoardId || decryptBoardId });
  })().catch((err) => { resolvedDocumentCache.delete(cacheKey); throw err; });
  resolvedDocumentCache.set(cacheKey, promise);
  return promise;
}

export function DocumentThumbnail({ document: doc, boardId, onClick }: { document: TaskDocument; boardId?: string; onClick: () => void }) {
  const [derivedPreview, setDerivedPreview] = useState<TaskDocumentPreview | null>(doc.preview ?? null);
  useEffect(() => {
    let cancelled = false;
    setDerivedPreview(doc.preview ?? null);
    resolveDocumentAsset(doc, boardId).then((resolved) => loadDocumentPreview(resolved)).then((next) => { if (!cancelled) setDerivedPreview(next); }).catch(() => { if (!cancelled) setDerivedPreview(doc.preview ?? null); });
    return () => { cancelled = true; };
  }, [doc, boardId]);
  const preview = derivedPreview ?? doc.preview ?? null;
  const label = doc.name || "Document";
  let previewNode: React.ReactNode;
  if (preview?.type === "image") previewNode = <img src={preview.data} alt="" className="doc-thumb__image" />;
  else if (preview?.type === "html") previewNode = <div className="doc-thumb__html" dangerouslySetInnerHTML={{ __html: preview.data }} />;
  else if (preview?.type === "text") previewNode = <pre className="doc-thumb__text">{preview.data.split(/\n+/).slice(0, 6).join("\n")}</pre>;
  else previewNode = <div className="doc-thumb__placeholder">{doc.kind.toUpperCase()}</div>;
  return <button type="button" className="doc-thumb" onClick={onClick}><div className="doc-thumb__preview">{previewNode}</div><div className="doc-thumb__footer"><span className="doc-thumb__name" title={label}>{label}</span><span className="doc-thumb__kind">{doc.kind.toUpperCase()}</span></div></button>;
}

function ViewerShell({ title, subtitle, actions, children, onClose }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-[#111214]/95 text-white" onClick={onClose}>
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-3 pb-4 pt-[max(14px,env(safe-area-inset-top))]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 pb-3">
          <button type="button" className="ghost-button button-sm pressable" onClick={onClose}>Close</button>
          <div className="min-w-0 flex-1 text-center"><div className="truncate text-sm font-medium text-white">{title}</div>{subtitle ? <div className="truncate text-xs text-white/60">{subtitle}</div> : null}</div>
          <div className="flex min-w-[72px] justify-end gap-2">{actions}</div>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function ZoomPane({ children, pageClassName = "", zoomable = true }: { children: React.ReactNode; pageClassName?: string; zoomable?: boolean }) {
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const applyScale = (next: number) => {
    const clamped = Math.max(1, Math.min(4, next));
    setScale(clamped);
  };
  return (
    <div className="relative h-full overflow-hidden">
      {zoomable ? (
        <div className="absolute right-3 top-3 z-[30] flex gap-2 rounded-full bg-black/45 p-1 backdrop-blur">
          <button type="button" className="ghost-button button-sm pressable" onClick={() => applyScale(scale - 0.25)}>−</button>
          <button type="button" className="ghost-button button-sm pressable" onClick={() => applyScale(1)}>{Math.round(scale * 100)}%</button>
          <button type="button" className="ghost-button button-sm pressable" onClick={() => applyScale(scale + 0.25)}>+</button>
        </div>
      ) : null}
      <div
        ref={viewportRef}
        className="h-full overflow-auto"
        style={{ touchAction: scale > 1 ? 'none' : 'auto', cursor: scale > 1 ? 'grab' : 'auto' }}
        onPointerDown={(e) => {
          if (scale <= 1 || !viewportRef.current) return;
          draggingRef.current = { x: e.clientX, y: e.clientY, left: viewportRef.current.scrollLeft, top: viewportRef.current.scrollTop };
          (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current || !viewportRef.current || scale <= 1) return;
          e.preventDefault();
          viewportRef.current.scrollLeft = draggingRef.current.left - (e.clientX - draggingRef.current.x);
          viewportRef.current.scrollTop = draggingRef.current.top - (e.clientY - draggingRef.current.y);
        }}
        onPointerUp={(e) => {
          draggingRef.current = null;
          (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={(e) => {
          draggingRef.current = null;
          (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
        }}
      >
        <div className="flex min-h-full min-w-full items-start justify-center p-4">
          <div className={pageClassName} style={{ transform: `scale(${scale})`, transformOrigin: 'top center', width: scale > 1 ? `${100 / scale}%` : 'auto' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function PdfPages({ dataUrl, scale }: { dataUrl: string; scale: number }) {
  const [pages, setPages] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await ensurePdfjs();
        const bytes = await fetch(dataUrl).then((r) => r.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const rendered: string[] = [];
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          rendered.push(canvas.toDataURL("image/png"));
        }
        if (!cancelled) setPages(rendered);
      } catch {
        if (!cancelled) setPages([]);
      }
    })();
    return () => { cancelled = true; };
  }, [dataUrl, scale]);
  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">{pages.map((src, i) => <img key={i} src={src} alt={`PDF page ${i + 1}`} className="w-full rounded-[22px] bg-white shadow-2xl" />)}</div>;
}

export function DocumentPreviewModal({ document, boardId, onClose, onDownloadDocument, onOpenExternal }: { document: TaskDocument; boardId?: string; onClose: () => void; onDownloadDocument?: (doc: TaskDocument, boardId?: string) => void; onOpenExternal?: (doc: TaskDocument, boardId?: string) => void; }) {
  const [resolvedDocument, setResolvedDocument] = useState<TaskDocument>(document);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [pdfScale, setPdfScale] = useState(1.15);
  const label = document.name || "Document";
  const decryptBoardId = document.encryptionBoardId || boardId;
  useEffect(() => {
    let cancelled = false;
    if (!document.remoteUrl) { setResolvedDocument(document); setLoadingRemote(false); setRemoteError(null); return; }
    setLoadingRemote(true); setRemoteError(null);
    resolveDocumentAsset(document, boardId).then((resolved) => { if (!cancelled) { setResolvedDocument(resolved); setLoadingRemote(false); } }).catch((err: any) => { if (!cancelled) { setRemoteError(err?.message || "Failed to decrypt document"); setLoadingRemote(false); } });
    return () => { cancelled = true; };
  }, [document, boardId]);
  const effectiveDocument = resolvedDocument;
  const full = effectiveDocument.full;
  const subtitle = useMemo(() => [effectiveDocument.kind.toUpperCase(), formatBytes(effectiveDocument.size), effectiveDocument.encrypted ? "Encrypted" : null].filter(Boolean).join(" • "), [effectiveDocument]);
  let content: React.ReactNode;
  if (loadingRemote) content = <div className="flex h-full items-center justify-center text-white/70">Decrypting document…</div>;
  else if (remoteError) content = <div className="flex h-full items-center justify-center text-center text-white/70">{remoteError}</div>;
  else if (effectiveDocument.kind === "pdf") content = <div className="relative h-full overflow-auto"><div className="absolute right-3 top-3 z-[30] flex gap-2 rounded-full bg-black/45 p-1 backdrop-blur"><button type="button" className="ghost-button button-sm pressable" onClick={() => setPdfScale((s) => Math.max(0.75, s - 0.15))}>−</button><button type="button" className="ghost-button button-sm pressable" onClick={() => setPdfScale(1.15)}>{Math.round((pdfScale / 1.15) * 100)}%</button><button type="button" className="ghost-button button-sm pressable" onClick={() => setPdfScale((s) => Math.min(2.5, s + 0.15))}>+</button></div><div className="px-4 pb-6 pt-14"><PdfPages dataUrl={effectiveDocument.dataUrl} scale={pdfScale} /></div></div>;
  else if (full?.type === "image") content = <ZoomPane><img src={full.data} alt={label} className="max-h-full max-w-full object-contain" /></ZoomPane>;
  else if (full?.type === "video") content = <div className="flex h-full items-center justify-center rounded-[28px] bg-black p-2 shadow-2xl"><video controls autoPlay poster={effectiveDocument.preview?.type === "image" ? effectiveDocument.preview.data : undefined} src={full.data} className="max-h-full w-full rounded-[22px] bg-black" /></div>;
  else if (full?.type === "audio") content = <div className="flex h-full items-center justify-center"><div className="w-full max-w-xl rounded-[28px] bg-[#1b1c20] p-6 shadow-2xl"><div className="mb-4 text-center text-sm text-white/70">Audio attachment</div><audio controls src={full.data} className="w-full" /></div></div>;
  else if (full?.type === "html") content = <ZoomPane pageClassName="mx-auto max-w-4xl rounded-[28px] bg-white px-6 py-8 text-[#111827] shadow-2xl"><div className="doc-modal__markup doc-modal__markup--rich" dangerouslySetInnerHTML={{ __html: full.data }} /></ZoomPane>;
  else if (full?.type === "text") content = <ZoomPane pageClassName="mx-auto max-w-4xl rounded-[28px] bg-white px-6 py-8 text-[#111827] shadow-2xl"><pre className="doc-modal__text whitespace-pre-wrap text-[15px] leading-7 text-[#111827]">{full.data}</pre></ZoomPane>;
  else content = <div className="flex h-full items-center justify-center"><div className="rounded-[28px] bg-[#1b1c20] px-6 py-8 text-center text-white/70 shadow-2xl">Preview unavailable. Use Download to open the original file.</div></div>;
  const actions = <><button type="button" className="ghost-button button-sm pressable" onClick={() => onOpenExternal?.(effectiveDocument, decryptBoardId)}>Open</button><button type="button" className="ghost-button button-sm pressable" onClick={() => onDownloadDocument?.(effectiveDocument, decryptBoardId)}>Download</button></>;
  return <ViewerShell title={label} subtitle={subtitle} actions={actions} onClose={onClose}>{content}</ViewerShell>;
}
