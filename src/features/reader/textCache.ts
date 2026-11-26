import type { PDFDocumentProxy } from '../../core/documents/pdfEngine';

type TextContent = Awaited<ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getTextContent']>>;
export interface PageText {
  content: TextContent;
  items: TextContent['items'];
  /** Concatenation matching the text-layer highlight logic (span texts joined by a space). */
  joined: string;
}

const caches = new WeakMap<PDFDocumentProxy, Map<number, Promise<PageText>>>();

/** Per-document text cache (bounded to the open document's lifetime). */
export function getPageText(doc: PDFDocumentProxy, index: number): Promise<PageText> {
  let m = caches.get(doc);
  if (!m) {
    m = new Map();
    caches.set(doc, m);
  }
  let p = m.get(index);
  if (!p) {
    p = doc
      .getPage(index + 1)
      .then((page) => page.getTextContent())
      .then((content) => {
        const items = content.items;
        let joined = '';
        for (const it of items) if ('str' in it && it.str.length) joined += it.str + ' ';
        return { content, items, joined };
      });
    m.set(index, p);
  }
  return p;
}
