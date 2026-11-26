// EPUB 2/3 engine (P1, RDR-04). Folio's own minimal reader instead of epub.js:
// spec §12.5 requires that book content never executes script, never loads remote
// resources and never shares an origin with script it controls. Chapters are parsed
// as inert XML/HTML documents (DOMParser does not run scripts), then REBUILT element by
// element from an allowlist into the app document. Nothing from the book is inserted
// as markup, book CSS is dropped (a few inline typographic properties survive), and
// every URL is resolved inside the archive or turned into an explicit external link.

import { unzipSync } from 'fflate';
import { LIMITS } from '../security/limits';

export class EpubError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EpubError';
  }
}

export interface EpubTocItem {
  title: string;
  spineIndex: number;
  fragment: string | null;
  depth: number;
}

export interface EpubSpineItem {
  href: string; // archive path
  mediaType: string;
  linear: boolean;
}

export interface EpubMeta {
  title: string;
  author: string;
  language: string;
  direction: 'ltr' | 'rtl';
}

export interface ParsedEpub {
  meta: EpubMeta;
  spine: EpubSpineItem[];
  toc: EpubTocItem[];
  coverPath: string | null;
  files: Map<string, Uint8Array>;
  mediaTypes: Map<string, string>;
}

const td = new TextDecoder();

export function hasZipSignature(bytes: Uint8Array) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function safeArchivePath(name: string) {
  if (name.length > 1024 || name.startsWith('/') || name.includes('\\') || name.includes('\0')) return false;
  return !name.split('/').some((seg) => seg === '..');
}

/** Bounded unzip: entry count, declared and actual expanded size, safe names. */
export function unzipEpub(bytes: Uint8Array): Map<string, Uint8Array> {
  let count = 0;
  let declared = 0;
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(bytes, {
      filter(f) {
        count++;
        declared += f.originalSize;
        if (count > LIMITS.epubMaxEntries) throw new EpubError('This EPUB has too many files inside it.');
        if (declared > LIMITS.epubMaxExpandedBytes) throw new EpubError('This EPUB expands to more data than Folio allows.');
        if (!safeArchivePath(f.name)) throw new EpubError('This EPUB contains an unsafe file name.');
        return !f.name.endsWith('/');
      },
    });
  } catch (err) {
    if (err instanceof EpubError) throw err;
    throw new EpubError('This file is not a readable EPUB archive.', { cause: err });
  }
  const files = new Map<string, Uint8Array>();
  let actual = 0;
  for (const [name, data] of Object.entries(out)) {
    actual += data.byteLength;
    if (actual > LIMITS.epubMaxExpandedBytes) throw new EpubError('This EPUB expands to more data than Folio allows.');
    files.set(name, data);
  }
  return files;
}

function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new EpubError(`The EPUB's ${what} is not valid XML.`);
  return doc;
}

/** Elements by local name, ignoring namespaces/prefixes (dc:title, opf:meta ...). */
function byLocal(root: Document | Element, local: string): Element[] {
  const all = root.getElementsByTagName('*');
  const res: Element[] = [];
  for (let i = 0; i < all.length; i++) if (all[i]!.localName === local) res.push(all[i]!);
  return res;
}

export function resolvePath(base: string, href: string): string {
  const [pathPart] = href.split('#');
  let decoded = pathPart ?? '';
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* keep raw */
  }
  if (!decoded) return base;
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  const parts = (decoded.startsWith('/') ? decoded.slice(1) : dir + decoded).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

function fragmentOf(href: string) {
  const i = href.indexOf('#');
  return i >= 0 ? href.slice(i + 1) || null : null;
}

function isExternal(href: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

export function parseEpub(bytes: Uint8Array): ParsedEpub {
  const files = unzipEpub(bytes);
  const mt = files.get('mimetype');
  if (mt && td.decode(mt).trim() !== 'application/epub+zip') throw new EpubError('This archive is not an EPUB (wrong mimetype).');
  const containerBytes = files.get('META-INF/container.xml');
  if (!containerBytes) throw new EpubError('This EPUB is missing META-INF/container.xml.');
  const container = parseXml(td.decode(containerBytes), 'container');
  const rootfile = byLocal(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!rootfile || !safeArchivePath(rootfile)) throw new EpubError('This EPUB does not name its package file.');
  const opfBytes = files.get(rootfile);
  if (!opfBytes) throw new EpubError('This EPUB package file is missing.');
  const opf = parseXml(td.decode(opfBytes), 'package file');

  const text = (local: string) => byLocal(opf, local)[0]?.textContent?.trim() ?? '';
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  const mediaTypes = new Map<string, string>();
  for (const item of byLocal(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href || isExternal(href)) continue;
    const path = resolvePath(rootfile, href);
    const mediaType = item.getAttribute('media-type') ?? '';
    manifest.set(id, { href: path, mediaType, properties: item.getAttribute('properties') ?? '' });
    mediaTypes.set(path, mediaType);
  }
  const spineEl = byLocal(opf, 'spine')[0];
  const spine: EpubSpineItem[] = [];
  for (const ref of byLocal(opf, 'itemref')) {
    const m = manifest.get(ref.getAttribute('idref') ?? '');
    if (!m || !files.has(m.href)) continue;
    if (!/xhtml|html|xml/.test(m.mediaType)) continue;
    spine.push({ href: m.href, mediaType: m.mediaType, linear: ref.getAttribute('linear') !== 'no' });
  }
  if (!spine.length) throw new EpubError('This EPUB has no readable chapters.');
  if (spine.length > LIMITS.maxPdfPages) throw new EpubError('This EPUB has more chapters than Folio allows.');

  // DRM: encrypted chapters cannot be read. Font obfuscation (IDPF/Adobe) is harmless.
  const enc = files.get('META-INF/encryption.xml');
  if (enc) {
    try {
      const encDoc = parseXml(td.decode(enc), 'encryption info');
      const chapterPaths = new Set(spine.map((s) => s.href));
      for (const ed of byLocal(encDoc, 'EncryptedData')) {
        const algo = byLocal(ed, 'EncryptionMethod')[0]?.getAttribute('Algorithm') ?? '';
        const uri = byLocal(ed, 'CipherReference')[0]?.getAttribute('URI') ?? '';
        if (/obfuscation|fontobfuscation/i.test(algo)) continue;
        if (chapterPaths.has(resolvePath('', uri))) throw new EpubError('This EPUB is protected with DRM, so Folio cannot read it.');
      }
    } catch (err) {
      if (err instanceof EpubError && err.message.includes('DRM')) throw err;
    }
  }

  const spineIndex = new Map(spine.map((s, i) => [s.href, i]));
  const toc: EpubTocItem[] = [];
  const push = (title: string, href: string, base: string, depth: number) => {
    if (!title || isExternal(href)) return;
    const idx = spineIndex.get(resolvePath(base, href));
    if (idx !== undefined) toc.push({ title: title.replace(/\s+/g, ' ').trim().slice(0, 300), spineIndex: idx, fragment: fragmentOf(href), depth });
  };
  // EPUB 3 navigation document.
  const navItem = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('nav'));
  if (navItem && files.has(navItem.href)) {
    try {
      const nav = new DOMParser().parseFromString(stripInlineHandlers(td.decode(files.get(navItem.href)!)), 'application/xhtml+xml');
      const navs = byLocal(nav, 'nav');
      const tocNav = navs.find((n) => (n.getAttribute('epub:type') ?? n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? '').includes('toc')) ?? navs[0];
      const walk = (ol: Element, depth: number) => {
        for (const li of Array.from(ol.children).filter((c) => c.localName === 'li')) {
          const a = Array.from(li.children).find((c) => c.localName === 'a');
          if (a) push(a.textContent ?? '', a.getAttribute('href') ?? '', navItem.href, depth);
          const sub = Array.from(li.children).find((c) => c.localName === 'ol');
          if (sub && depth < 6) walk(sub, depth + 1);
        }
      };
      const ol = tocNav && byLocal(tocNav, 'ol')[0];
      if (ol) walk(ol, 0);
    } catch {
      /* fall back to NCX */
    }
  }
  // EPUB 2 NCX.
  if (!toc.length) {
    const ncxId = spineEl?.getAttribute('toc');
    const ncx = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find((m) => m.mediaType === 'application/x-dtbncx+xml');
    if (ncx && files.has(ncx.href)) {
      try {
        const doc = parseXml(td.decode(files.get(ncx.href)!), 'table of contents');
        const walk = (parent: Element, depth: number) => {
          for (const np of Array.from(parent.children).filter((c) => c.localName === 'navPoint')) {
            const label = byLocal(np, 'text')[0]?.textContent ?? '';
            const src = byLocal(np, 'content')[0]?.getAttribute('src') ?? '';
            push(label, src, ncx.href, depth);
            if (depth < 6) walk(np, depth + 1);
          }
        };
        const map = byLocal(doc, 'navMap')[0];
        if (map) walk(map, 0);
      } catch {
        /* no toc */
      }
    }
  }

  let coverPath: string | null = null;
  const coverItem = [...manifest.values()].find((m) => m.properties.split(/\s+/).includes('cover-image'));
  if (coverItem) coverPath = coverItem.href;
  else {
    const coverMeta = byLocal(opf, 'meta').find((m) => m.getAttribute('name') === 'cover');
    const m = coverMeta && manifest.get(coverMeta.getAttribute('content') ?? '');
    if (m) coverPath = m.href;
  }
  if (coverPath && (!files.has(coverPath) || !/^image\/(png|jpeg|gif|webp)$/.test(mediaTypes.get(coverPath) ?? ''))) coverPath = null;

  const ppd = spineEl?.getAttribute('page-progression-direction');
  return {
    meta: {
      title: text('title').slice(0, 500),
      author: byLocal(opf, 'creator')
        .map((c) => c.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(', ')
        .slice(0, 300),
      language: text('language').slice(0, 35),
      direction: ppd === 'rtl' ? 'rtl' : 'ltr',
    },
    spine,
    toc,
    coverPath,
    files,
    mediaTypes,
  };
}

// ---------------- sanitising chapter renderer ----------------

const KEEP = new Set(
  (
    'p div section article aside header footer nav main figure figcaption blockquote pre hr br h1 h2 h3 h4 h5 h6 ' +
    'ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col span a em strong i b u s small sub sup ' +
    'code kbd samp var cite q abbr dfn mark time bdi bdo ruby rt rp wbr del ins img'
  ).split(' '),
);
const RENAME: Record<string, string> = { big: 'span', font: 'span', center: 'div', tt: 'code', strike: 's', body: 'div', html: 'div' };
const DROP = new Set(
  'script style link meta base title head iframe frame frameset object embed applet noscript template form input button select option textarea video audio source track canvas portal dialog math'.split(' '),
);
const STYLE_KEEP = ['text-align', 'font-style', 'font-weight', 'font-variant', 'text-decoration-line', 'text-indent', 'vertical-align', 'text-transform'];

export interface RenderContext {
  chapterPath: string;
  spineIndex: number;
  /** archive path -> spine index, for internal links */
  spineIndexOf: (path: string) => number | undefined;
  /** archive path -> safe object URL (images only), or null */
  imageUrl: (path: string) => string | null;
  doc: Document;
}

export function idPrefix(spineIndex: number) {
  return `epub-${spineIndex}-`;
}

function cleanStyle(raw: string, target: HTMLElement) {
  if (raw.length > 2000 || /expression|@import|javascript:|\\/i.test(raw)) return;
  // Neutralise any url() before the browser parses the declaration, then keep only
  // typographic properties.
  const probe = target.ownerDocument.createElement('span');
  probe.setAttribute('style', raw.replace(/url\s*\([^)]*\)?/gi, 'none'));
  const out: string[] = [];
  for (const prop of STYLE_KEEP) {
    const v = probe.style.getPropertyValue(prop);
    if (v && v.length < 40) out.push(`${prop}:${v}`);
  }
  if (out.length) target.setAttribute('style', out.join(';'));
}

/**
 * Remove inline event-handler attributes before parsing. DOMParser documents never
 * run them, but Chromium still reports a CSP violation for each one it sees; this
 * also keeps them out of every intermediate document (defence in depth).
 */
export function stripInlineHandlers(source: string): string {
  const handler = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi;
  // Each start tag, allowing quoted values that contain '>'.
  return source.replace(/<[a-z][^\s/>]*(?:\s+(?:"[^"]*"|'[^']*'|[^"'>])*)?>/gi, (tag) => tag.replace(handler, ''));
}

/** Rebuild one chapter from an allowlist. Returns a fragment owned by ctx.doc. */
export function renderChapter(rawSource: string, mediaType: string, ctx: RenderContext): DocumentFragment {
  const source = stripInlineHandlers(rawSource);
  let parsed = new DOMParser().parseFromString(source, mediaType.includes('xhtml') || mediaType.includes('xml') ? 'application/xhtml+xml' : 'text/html');
  if (parsed.getElementsByTagName('parsererror').length) parsed = new DOMParser().parseFromString(source, 'text/html');
  const body = byLocal(parsed, 'body')[0] ?? parsed.documentElement;
  const frag = ctx.doc.createDocumentFragment();
  const prefix = idPrefix(ctx.spineIndex);
  let budget = 200_000; // node cap per chapter

  const copy = (node: Node, parent: Node) => {
    if (--budget < 0) return;
    if (node.nodeType === 3) {
      parent.appendChild(ctx.doc.createTextNode(node.nodeValue ?? ''));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const local = el.localName.toLowerCase();
    if (DROP.has(local)) return;
    if (local === 'svg') {
      // Common cover pattern: <svg><image xlink:href="cover.jpg"/></svg>
      const image = byLocal(el, 'image')[0];
      const href = image?.getAttribute('href') ?? image?.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (href && !isExternal(href)) {
        const url = ctx.imageUrl(resolvePath(ctx.chapterPath, href));
        if (url) {
          const img = ctx.doc.createElement('img');
          img.src = url;
          img.alt = '';
          parent.appendChild(img);
        }
      }
      return;
    }
    const tag = RENAME[local] ?? local;
    if (!KEEP.has(tag)) {
      el.childNodes.forEach((c) => copy(c, parent)); // unwrap unknown elements
      return;
    }
    const out = ctx.doc.createElement(tag);
    const id = el.getAttribute('id');
    if (id && id.length < 200) out.id = prefix + id;
    const lang = el.getAttribute('lang') ?? el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang');
    if (lang && /^[a-z]{1,8}(-[a-z0-9]{1,8})*$/i.test(lang)) out.lang = lang;
    const dir = el.getAttribute('dir');
    if (dir === 'rtl' || dir === 'ltr' || dir === 'auto') out.dir = dir;
    const title = el.getAttribute('title');
    if (title) out.title = title.slice(0, 300);
    const style = el.getAttribute('style');
    if (style) cleanStyle(style, out);
    const epubType = el.getAttribute('epub:type') ?? el.getAttributeNS('http://www.idpf.org/2007/ops', 'type');
    if (epubType && /^[a-z -]{1,60}$/i.test(epubType)) out.dataset.epubType = epubType;

    if (tag === 'img') {
      const src = el.getAttribute('src') ?? '';
      const url = src && !isExternal(src) ? ctx.imageUrl(resolvePath(ctx.chapterPath, src)) : null;
      if (!url) {
        const alt = el.getAttribute('alt');
        if (alt) parent.appendChild(ctx.doc.createTextNode(`[${alt.slice(0, 200)}]`));
        return;
      }
      (out as HTMLImageElement).src = url;
      (out as HTMLImageElement).alt = (el.getAttribute('alt') ?? '').slice(0, 500);
      (out as HTMLImageElement).loading = 'lazy';
      (out as HTMLImageElement).decoding = 'async';
    } else if (tag === 'a') {
      const href = el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
      if (/^(https?|mailto):/i.test(href)) {
        out.dataset.externalUrl = href.slice(0, 2000);
        out.setAttribute('role', 'link');
        out.tabIndex = 0;
        out.title = `External link: ${href.slice(0, 200)}`;
      } else if (href && !isExternal(href)) {
        const target = href.startsWith('#') ? ctx.chapterPath : resolvePath(ctx.chapterPath, href);
        const idx = ctx.spineIndexOf(target);
        if (idx !== undefined) {
          out.dataset.spine = String(idx);
          const frag = fragmentOf(href);
          if (frag) out.dataset.fragment = frag.slice(0, 200);
          out.setAttribute('role', 'link');
          out.tabIndex = 0;
        }
      }
      // javascript:, data:, file: and unknown schemes: kept as plain text (no role, no href)
    } else if (tag === 'td' || tag === 'th') {
      for (const a of ['colspan', 'rowspan']) {
        const v = Number(el.getAttribute(a));
        if (Number.isInteger(v) && v > 1 && v < 100) out.setAttribute(a, String(v));
      }
    } else if (tag === 'ol') {
      const start = Number(el.getAttribute('start'));
      if (Number.isInteger(start) && Math.abs(start) < 1e6) out.setAttribute('start', String(start));
    }
    el.childNodes.forEach((c) => copy(c, out));
    parent.appendChild(out);
  };
  body.childNodes.forEach((c) => copy(c, frag));
  return frag;
}

/** Plain text of a chapter for search, without building DOM in the page. */
export function chapterText(rawSource: string, mediaType: string): string {
  const source = stripInlineHandlers(rawSource);
  const doc = new DOMParser().parseFromString(source, mediaType.includes('xhtml') ? 'application/xhtml+xml' : 'text/html');
  const ok = !doc.getElementsByTagName('parsererror').length ? doc : new DOMParser().parseFromString(source, 'text/html');
  const body = byLocal(ok, 'body')[0];
  if (!body) return '';
  for (const tag of ['script', 'style']) byLocal(body, tag).forEach((e) => e.remove());
  return (body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Runtime handle for an open book: object URLs live until close(). */
export class EpubHandle {
  private urls = new Map<string, string>();
  private textCache = new Map<number, string>();
  readonly spineIndexMap: Map<string, number>;
  constructor(readonly book: ParsedEpub) {
    this.spineIndexMap = new Map(book.spine.map((s, i) => [s.href, i]));
  }
  imageUrl = (path: string): string | null => {
    const cached = this.urls.get(path);
    if (cached) return cached;
    const type = this.book.mediaTypes.get(path) ?? '';
    const data = this.book.files.get(path);
    if (!data || !/^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/.test(type)) return null;
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
    this.urls.set(path, url);
    return url;
  };
  source(i: number): string {
    const item = this.book.spine[i];
    const data = item && this.book.files.get(item.href);
    return data ? td.decode(data) : '';
  }
  render(i: number, doc: Document = document): DocumentFragment {
    const item = this.book.spine[i]!;
    return renderChapter(this.source(i), item.mediaType, {
      chapterPath: item.href,
      spineIndex: i,
      spineIndexOf: (p) => this.spineIndexMap.get(p),
      imageUrl: this.imageUrl,
      doc,
    });
  }
  text(i: number): string {
    let t = this.textCache.get(i);
    if (t === undefined) {
      const item = this.book.spine[i]!;
      t = chapterText(this.source(i), item.mediaType);
      this.textCache.set(i, t);
    }
    return t;
  }
  close() {
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
  }
}

export async function epubCover(book: ParsedEpub): Promise<Blob | null> {
  if (!book.coverPath) return null;
  const data = book.files.get(book.coverPath)!;
  const type = book.mediaTypes.get(book.coverPath)!;
  const blob = new Blob([data as BlobPart], { type });
  // Re-encode to a bounded PNG so stored covers are small and never the raw file.
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 480 / bmp.width);
    const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale)));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return await c.convertToBlob({ type: 'image/webp', quality: 0.85 });
  } catch {
    return null;
  }
}
