// Annotated PDF export (EXP-02). Loads a *copy* of the original bytes with pdf-lib,
// appends vector ink to each annotated page in canonical PDF user space and returns
// new bytes. The page content is never flattened to an image, and the original Blob
// in storage is never modified. Encrypted sources are refused explicitly (spec 12.1).
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFDict,
  closePath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setGraphicsState,
  type PDFOperator,
  type PDFPage,
} from 'pdf-lib';
import type { AnnotationRecord } from '../storage/types';

export class ExportError extends Error {
  readonly code: 'encrypted' | 'malformed' | 'page-range';
  constructor(code: ExportError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExportError';
    this.code = code;
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1]!, 16) : 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function fmt(n: number) {
  return Math.round(n * 1000) / 1000;
}

/** Register (or reuse) an ExtGState with the given fill alpha on the page. */
function alphaState(doc: PDFDocument, page: PDFPage, alpha: number, multiply: boolean, cache: Map<string, string>) {
  const key = `${alpha.toFixed(3)}-${multiply}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const gs = doc.context.obj({
    Type: 'ExtGState',
    ca: PDFNumber.of(alpha),
    CA: PDFNumber.of(alpha),
    ...(multiply ? { BM: PDFName.of('Multiply') } : {}),
  });
  const ref = doc.context.register(gs);
  const name = `FolioGS${cache.size}`;
  const resources = page.node.Resources() ?? doc.context.obj({});
  if (!page.node.Resources()) page.node.set(PDFName.of('Resources'), resources);
  let ext = resources.lookupMaybe(PDFName.of('ExtGState'), PDFDict);
  if (!ext) {
    ext = doc.context.obj({});
    resources.set(PDFName.of('ExtGState'), ext);
  }
  ext.set(PDFName.of(name), ref);
  cache.set(key, name);
  return name;
}

/**
 * Isolate the page's existing content in q/Q so unbalanced graphics state in the
 * original stream cannot shift our marks, then return a fresh stream appended after it.
 */
function appendIsolated(doc: PDFDocument, page: PDFPage, ops: PDFOperator[]) {
  page.node.normalize();
  const start = doc.context.register(doc.context.contentStream([pushGraphicsState()]));
  const end = doc.context.register(doc.context.contentStream([popGraphicsState()]));
  page.node.wrapContentStreams(start, end);
  const ours = doc.context.register(doc.context.contentStream(ops));
  page.node.addContentStream(ours);
}

export async function exportAnnotatedPdf(original: ArrayBuffer | Uint8Array, annotations: AnnotationRecord[]) {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(original, { updateMetadata: false });
  } catch (err) {
    if (err && typeof err === 'object' && (err as Error).name === 'EncryptedPDFError')
      throw new ExportError('encrypted', 'This PDF is password-protected or encrypted. Annotated export is not supported for encrypted PDFs; download the original or a Folio backup instead.', { cause: err });
    throw new ExportError('malformed', 'This PDF could not be prepared for export. Download the original or a Folio backup instead.', { cause: err });
  }
  if (doc.isEncrypted)
    throw new ExportError('encrypted', 'This PDF is encrypted. Annotated export is not supported for encrypted PDFs; download the original or a Folio backup instead.');

  const pages = doc.getPages();
  const byPage = new Map<number, AnnotationRecord[]>();
  for (const a of annotations) {
    if (a.pageIndex < 0 || a.pageIndex >= pages.length)
      throw new ExportError('page-range', `An annotation refers to page ${a.pageIndex + 1}, which this PDF does not have.`);
    const list = byPage.get(a.pageIndex) ?? [];
    list.push(a);
    byPage.set(a.pageIndex, list);
  }
  for (const [index, list] of byPage) {
    const page = pages[index]!;
    const cache = new Map<string, string>();
    const ops: PDFOperator[] = [];
    list.sort((a, b) => a.createdAt - b.createdAt);
    for (const a of list) {
      if (a.outline.length < 3) continue;
      const [r, g, b] = hexToRgb(a.style.color);
      const gs = alphaState(doc, page, a.style.opacity, a.style.tool === 'highlighter', cache);
      ops.push(pushGraphicsState(), setGraphicsState(gs), setFillingRgbColor(r, g, b));
      ops.push(moveTo(fmt(a.outline[0]![0]), fmt(a.outline[0]![1])));
      for (let i = 1; i < a.outline.length; i++) ops.push(lineTo(fmt(a.outline[i]![0]), fmt(a.outline[i]![1])));
      ops.push(closePath(), fill(), popGraphicsState());
    }
    if (ops.length) appendIsolated(doc, page, ops);
  }
  return doc.save({ useObjectStreams: false });
}
