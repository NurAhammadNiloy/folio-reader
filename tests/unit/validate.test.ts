import { describe, expect, it } from 'vitest';
import { assertPageCount, hasPdfSignature, precheckFile } from '../../src/core/security/validatePdf';
import { fixture } from './helpers';

describe('PDF validation', () => {
  it('detects the PDF signature and rejects text files', () => {
    expect(hasPdfSignature(fixture('single.pdf'))).toBe(true);
    expect(hasPdfSignature(fixture('not-a-pdf.pdf'))).toBe(false);
    expect(hasPdfSignature(new Uint8Array())).toBe(false);
  });
  it('rejects empty and oversized files before reading (format is decided by content)', () => {
    expect(() => precheckFile({ name: 'a.pdf', size: 0, type: '' })).toThrow(/empty/);
    expect(() => precheckFile({ name: 'a.pdf', size: 101 * 1024 * 1024, type: 'application/pdf' })).toThrow(/up to 100/);
    expect(() => precheckFile({ name: 'a.epub', size: 10, type: '' })).not.toThrow();
    expect(() => precheckFile({ name: 'a.pdf', size: 10, type: 'text/plain' })).not.toThrow();
  });
  it('enforces the page limit', () => {
    expect(() => assertPageCount('x', 2001)).toThrow(/2,000/);
    expect(() => assertPageCount('x', 0)).toThrow();
    expect(() => assertPageCount('x', 2000)).not.toThrow();
  });
});
