// Notebook export (spec 12.3): each virtual A4 page is rasterised at 2x (template, ink
// and typed text drawn with the browser's fonts, so Bengali/Arabic text renders when
// the device has fonts for it) and placed on a PDF page of the same size. Rasterising
// notebook pages is explicitly acceptable; original book PDFs are never flattened.
import { PDFDocument } from 'pdf-lib';
import type { NotebookPageRecord } from '../storage/types';
import { notebookTransform, paintOutline } from '../ink/geometry';

export function paintTemplate(ctx: CanvasRenderingContext2D, page: NotebookPageRecord, s: number) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, page.width * s, page.height * s);
  ctx.save();
  if (page.template === 'ruled') {
    ctx.strokeStyle = 'rgba(120,140,170,0.45)';
    ctx.lineWidth = 0.6 * s;
    for (let y = 60; y < page.height - 20; y += 28) {
      ctx.beginPath();
      ctx.moveTo(30 * s, y * s);
      ctx.lineTo((page.width - 30) * s, y * s);
      ctx.stroke();
    }
  } else if (page.template === 'grid') {
    ctx.strokeStyle = 'rgba(120,140,170,0.3)';
    ctx.lineWidth = 0.5 * s;
    for (let x = 20; x < page.width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x * s, 0);
      ctx.lineTo(x * s, page.height * s);
      ctx.stroke();
    }
    for (let y = 20; y < page.height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y * s);
      ctx.lineTo(page.width * s, y * s);
      ctx.stroke();
    }
  } else if (page.template === 'dotted') {
    ctx.fillStyle = 'rgba(110,120,130,0.55)';
    for (let x = 20; x < page.width; x += 20) for (let y = 20; y < page.height; y += 20) ctx.fillRect(x * s - 0.75 * s, y * s - 0.75 * s, 1.5 * s, 1.5 * s);
  }
  ctx.restore();
}

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width > maxWidth && line.trim()) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function paintNotebookPage(ctx: CanvasRenderingContext2D, page: NotebookPageRecord, s: number) {
  paintTemplate(ctx, page, s);
  const t = notebookTransform(s);
  for (const st of page.strokes) paintOutline(ctx, st.outline, t, st.style);
  ctx.fillStyle = '#202522';
  ctx.textBaseline = 'top';
  for (const b of page.textBlocks) {
    ctx.font = `${b.fontSize * s}px Inter, system-ui, 'Noto Sans', 'Noto Sans Bengali', 'Noto Sans Arabic', sans-serif`;
    const lines = wrapLines(ctx, b.text, b.width * s);
    lines.forEach((l, i) => ctx.fillText(l, b.x * s, (b.y + i * b.fontSize * 1.35) * s, b.width * s));
  }
}

export async function exportNotebookPdf(title: string, pages: NotebookPageRecord[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer('Folio');
  doc.setCreator('Folio');
  const S = 2;
  for (const page of pages) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(page.width * S);
    canvas.height = Math.round(page.height * S);
    const ctx = canvas.getContext('2d')!;
    paintNotebookPage(ctx, page, S);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error('Could not render a notebook page for export.');
    const img = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
    const p = doc.addPage([page.width, page.height]);
    p.drawImage(img, { x: 0, y: 0, width: page.width, height: page.height });
  }
  return doc.save();
}
