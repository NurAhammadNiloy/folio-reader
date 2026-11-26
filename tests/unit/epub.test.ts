// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { EpubError, EpubHandle, parseEpub, resolvePath, stripInlineHandlers, unzipEpub } from '../../src/core/documents/epubEngine';
import { fixture } from './helpers';

describe('EPUB parsing (RDR-04)', () => {
  it('reads metadata, spine, nav TOC and cover', () => {
    const book = parseEpub(fixture('sample.epub'));
    expect(book.meta).toMatchObject({ title: 'Folio Sample EPUB', author: 'Folio Test Author', language: 'en', direction: 'ltr' });
    expect(book.spine.map((s) => s.href)).toEqual(['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml', 'OEBPS/text/ch3.xhtml']);
    expect(book.toc.map((t) => [t.title, t.spineIndex, t.fragment, t.depth])).toEqual([
      ['Chapter One', 0, null, 0],
      ['Chapter Two', 1, null, 0],
      ['A figure', 1, 'figure', 1],
      ['Chapter Three', 2, null, 0],
    ]);
    expect(book.coverPath).toBe('OEBPS/images/cover.png');
  });

  it('honours page-progression-direction', () => {
    expect(parseEpub(fixture('rtl.epub')).meta.direction).toBe('rtl');
  });

  it('refuses DRM-encrypted chapters', () => {
    expect(() => parseEpub(fixture('drm.epub'))).toThrow(/DRM/);
  });

  it('resolves relative archive paths without escaping the root', () => {
    expect(resolvePath('OEBPS/text/ch1.xhtml', '../images/a%20b.png#x')).toBe('OEBPS/images/a b.png');
    expect(resolvePath('OEBPS/text/ch1.xhtml', '../../../../etc/passwd')).toBe('etc/passwd');
  });

  it('rejects unsafe names, too many entries and oversized expansion', () => {
    expect(() => unzipEpub(zipSync({ '../evil.txt': strToU8('x') }))).toThrow(EpubError);
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5001; i++) many[`f${i}`] = new Uint8Array(0);
    expect(() => unzipEpub(zipSync(many))).toThrow(/too many files/);
    const bomb = zipSync({ big: new Uint8Array(301 * 1024 * 1024) }, { level: 9 });
    expect(bomb.byteLength).toBeLessThan(2 * 1024 * 1024);
    expect(() => unzipEpub(bomb)).toThrow(/expands to more data/);
  });

  it('rejects non-EPUB archives and missing containers', () => {
    expect(() => parseEpub(zipSync({ mimetype: strToU8('application/zip') }))).toThrow(/not an EPUB/);
    expect(() => parseEpub(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/container/);
  });
});

describe('EPUB chapter sanitising (§12.5)', () => {
  it('strips inline handlers before parsing, including several per tag and unquoted values', () => {
    const out = stripInlineHandlers(`<p class="a" onclick="x()" data-x='1' onMouseOver='y()'>t</p><img src=a onerror=z() alt="on=1"/>`);
    expect(out).not.toMatch(/on(click|mouseover|error)/i);
    expect(out).toContain('class="a"');
    expect(out).toContain('alt="on=1"');
    expect(out).toContain('>t</p>');
  });

  it('drops scripts, handlers, embeds, forms, remote resources and book CSS', () => {
    const h = new EpubHandle(parseEpub(fixture('hostile.epub')));
    const host = document.createElement('div');
    host.append(h.render(0));
    const html = host.innerHTML;
    for (const bad of ['<script', '<iframe', '<object', '<form', '<input', '<style', '<link', '<svg', 'onclick', 'onerror', 'onmouseover', 'javascript:', 'example.invalid', 'data:text', 'url(']) {
      expect(html, bad).not.toContain(bad);
    }
    expect(host.querySelectorAll('[href]')).toHaveLength(0);
    expect(host.textContent).toContain('Safe text survives');
    expect(host.textContent).toContain('[remote image]');
    expect(host.querySelector('p[style]')?.getAttribute('style') ?? '').not.toMatch(/background|color/);
    h.close();
  });

  it('keeps structure, images from the archive, internal and external links, ids and safe inline style', () => {
    const h = new EpubHandle(parseEpub(fixture('sample.epub')));
    const ch1 = document.createElement('div');
    ch1.append(h.render(0));
    const jump = ch1.querySelector('a[data-spine]') as HTMLElement;
    expect(jump.dataset.spine).toBe('2');
    expect(jump.dataset.fragment).toBe('later');
    expect(ch1.querySelector('p')?.className).toBe(''); // classes dropped
    const ch2 = document.createElement('div');
    ch2.append(h.render(1));
    expect(ch2.querySelector('figure#epub-1-figure img')?.getAttribute('src')).toMatch(/^blob:/);
    expect(ch2.querySelector('[data-external-url]')?.getAttribute('data-external-url')).toBe('https://example.com/');
    expect(ch2.querySelector('aside')?.dataset.epubType).toBe('footnote');
    const ch3 = document.createElement('div');
    ch3.append(h.render(2));
    const centered = ch3.querySelector('#epub-2-later + p') as HTMLElement;
    expect(centered.style.textAlign).toBe('center');
    expect(centered.style.fontStyle).toBe('italic');
    expect(h.text(2)).toContain('quasar3');
    h.close();
  });
});
