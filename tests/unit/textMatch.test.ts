import { describe, it, expect } from 'vitest';
import { findAll, fold, foldQuery, joinItems } from '../../src/features/reader/textMatch';

describe('PDF text matching (RDR-03)', () => {
  it('joins runs on a line with nothing between them and line ends with a space', () => {
    const j = joinItems([{ str: 'Inter' }, { str: 'national' }, { str: ' law', hasEOL: true }, { str: '', hasEOL: true }, { str: 'next' }]);
    expect(j).toBe('International law  next');
    expect(findAll(fold(j), foldQuery('international'))).toEqual([{ start: 0, end: 13 }]);
  });

  it('matches ligatures, case and accents written either way, with original offsets', () => {
    const t = 'The ﬁrst Café and the second Café.';
    const f = fold(t);
    expect(findAll(f, foldQuery('first'))).toEqual([{ start: 4, end: 8 }]);
    const cafe = findAll(f, foldQuery('CAFÉ'));
    expect(cafe.map((h) => t.slice(h.start, h.end))).toEqual(['Café', 'Café']);
  });

  it('keeps Bangla and Arabic marks significant and matches nukta forms', () => {
    const bn = 'আমি বাংলায় গান গাই'; // য় precomposed (U+09DF)
    expect(findAll(fold(bn), foldQuery('বাংলায়'))).toHaveLength(1);
    expect(findAll(fold(bn), foldQuery('বংল'))).toHaveLength(0);
    const ar = 'مرحبا بالعالم';
    expect(findAll(fold(ar), foldQuery('العالم'))).toEqual([{ start: 7, end: 13 }]);
  });

  it('collapses whitespace in the query and finds non-overlapping hits', () => {
    expect(foldQuery('  a   b ')).toBe('a b');
    expect(findAll(fold('aaaa'), 'aa')).toHaveLength(2);
    expect(findAll(fold('abc'), '')).toEqual([]);
  });
});
