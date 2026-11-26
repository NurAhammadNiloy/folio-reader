// PDF engine adapter (spec 12.3). PDF.js is one-based at its boundary only; everything
// returned from here uses zero-based page indexes. The adapter owns loading, password
// prompts, cancellation and disposal. Document scripting, XFA and interactive
// annotation layers are never enabled: we only paint appearance streams to canvas.
import {
  AnnotationMode,
  GlobalWorkerOptions,
  PasswordResponses,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy, PageViewport };

function assetBase(): string {
  return new URL('pdfjs/', document.baseURI).href;
}

export class PasswordCancelledError extends Error {
  constructor() {
    super('Password entry was cancelled.');
    this.name = 'PasswordCancelledError';
  }
}

export type PasswordReason = 'required' | 'incorrect';
export type PasswordProvider = (reason: PasswordReason) => Promise<string | null>;

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  numPages: number;
  encrypted: boolean;
  destroy: () => Promise<void>;
}

/**
 * Open a PDF from bytes. The bytes are copied before transfer so the caller's buffer
 * stays intact. Passwords exist only in memory for this call and are never stored.
 */
export async function openPdf(bytes: Uint8Array, getPassword?: PasswordProvider): Promise<OpenedPdf> {
  const base = assetBase();
  let encrypted = false;
  let cancelled = false;
  const task = getDocument({
    data: bytes.slice(),
    cMapUrl: base + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: base + 'standard_fonts/',
    wasmUrl: base + 'wasm/',
    iccUrl: base + 'iccs/',
    enableXfa: false,
    stopAtErrors: false,
    isOffscreenCanvasSupported: true,
  });
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    encrypted = true;
    if (!getPassword) {
      cancelled = true;
      void task.destroy();
      return;
    }
    const why: PasswordReason = reason === PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'required';
    void getPassword(why).then((pw) => {
      if (pw === null) {
        cancelled = true;
        void task.destroy();
      } else update(pw);
    });
  };
  try {
    const doc = await task.promise;
    return {
      doc,
      numPages: doc.numPages,
      encrypted,
      destroy: () => task.destroy(),
    };
  } catch (err) {
    if (cancelled) throw new PasswordCancelledError();
    throw err;
  }
}

export interface PageDescriptor {
  index: number;
  /** Size in CSS px at scale 1 including intrinsic rotation. */
  width: number;
  height: number;
  rotate: number;
  view: number[];
  userUnit: number;
}

export async function describePage(page: PDFPageProxy, index: number): Promise<PageDescriptor> {
  const vp = page.getViewport({ scale: 1 });
  return {
    index,
    width: vp.width,
    height: vp.height,
    rotate: page.rotate,
    view: [...page.view],
    userUnit: page.userUnit ?? 1,
  };
}

/** Viewport used by canvas, text and ink for one page at a CSS scale. */
export function cssViewport(page: PDFPageProxy, scale: number, extraRotation = 0): PageViewport {
  return page.getViewport({ scale, rotation: (page.rotate + extraRotation) % 360 });
}

export interface RenderHandle {
  promise: Promise<void>;
  cancel: () => void;
}

/**
 * Render a page into a canvas. The canvas CSS size equals the viewport size; the backing
 * store is `pixelRatio` times larger. devicePixelRatio is applied exactly once, via the
 * transform, never baked into the viewport as well.
 */
export function renderPage(
  page: PDFPageProxy,
  viewport: PageViewport,
  canvas: HTMLCanvasElement,
  pixelRatio: number,
): RenderHandle {
  const w = Math.max(1, Math.floor(viewport.width * pixelRatio));
  const h = Math.max(1, Math.floor(viewport.height * pixelRatio));
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const sx = w / viewport.width;
  const sy = h / viewport.height;
  const task = page.render({
    canvas,
    viewport,
    transform: sx !== 1 || sy !== 1 ? [sx, 0, 0, sy, 0, 0] : undefined,
    annotationMode: AnnotationMode.ENABLE,
    background: '#ffffff',
  });
  return {
    promise: task.promise,
    cancel: () => task.cancel(),
  };
}

export function isRenderCancelled(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'RenderingCancelledException';
}

/** Best-effort cover image (page 1) as a Blob. Returns null on failure. */
export async function renderCover(doc: PDFDocumentProxy, cssWidth = 300): Promise<Blob | null> {
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: cssWidth / base.width });
    const canvas = document.createElement('canvas');
    const h = renderPage(page, vp, canvas, 1);
    await h.promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    page.cleanup();
    canvas.width = canvas.height = 0;
    return blob;
  } catch {
    return null;
  }
}

export interface PdfMetadata {
  title: string;
  author: string;
}

export async function readMetadata(doc: PDFDocumentProxy): Promise<PdfMetadata> {
  try {
    const { info } = (await doc.getMetadata()) as { info?: Record<string, unknown> };
    const title = typeof info?.Title === 'string' ? info.Title.trim() : '';
    const author = typeof info?.Author === 'string' ? info.Author.trim() : '';
    return { title, author };
  } catch {
    return { title: '', author: '' };
  }
}

export interface OutlineNode {
  title: string;
  pageIndex: number | null;
  children: OutlineNode[];
}

/** Outline with destinations resolved to zero-based page indexes. External links are dropped. */
export async function readOutline(doc: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = (await doc.getOutline().catch(() => null)) ?? [];
  async function resolve(dest: unknown): Promise<number | null> {
    try {
      const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const ref = explicit[0];
      if (typeof ref === 'number') return ref;
      if (ref && typeof ref === 'object') return await doc.getPageIndex(ref as never);
      return null;
    } catch {
      return null;
    }
  }
  type Raw = { title: string; dest: unknown; items: Raw[] };
  async function walk(items: Raw[], depth: number): Promise<OutlineNode[]> {
    if (depth > 8) return [];
    const out: OutlineNode[] = [];
    for (const it of items.slice(0, 2000)) {
      out.push({
        title: String(it.title ?? '').slice(0, 300) || 'Untitled',
        pageIndex: await resolve(it.dest),
        children: await walk(it.items ?? [], depth + 1),
      });
    }
    return out;
  }
  return walk(raw as Raw[], 0);
}

export async function readPageLabels(doc: PDFDocumentProxy): Promise<string[] | null> {
  try {
    return await doc.getPageLabels();
  } catch {
    return null;
  }
}
