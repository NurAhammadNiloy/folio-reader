/**
 * Text matching shared by the PDF search index and the text-layer highlighter.
 *
 * - Runs are joined the way PDF.js lays them out: nothing between runs on a line
 *   (a word split into several runs for kerning, ligatures or shaping stays one
 *   word), and one space where a run ends a line (PDF.js emits a <br> there).
 * - Matching is on a folded copy: each code point is NFKD-decomposed and
 *   lower-cased, so ligatures (ﬁ), compatibility forms, precomposed vs combining
 *   accents and Indic nukta forms compare equal. Combining marks are kept, so
 *   Bangla and Arabic vowel signs still matter. Every folded code unit maps back
 *   to the original string, so hits keep original offsets.
 */

export interface Folded {
  text: string;
  /** For each folded code unit, the original start and end (exclusive) offsets. */
  from: number[];
  to: number[];
}

export function fold(s: string): Folded {
  let text = '';
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const cp of s) {
    const f = cp.normalize('NFKD').toLocaleLowerCase();
    for (let k = 0; k < f.length; k++) {
      from.push(i);
      to.push(i + cp.length);
    }
    text += f;
    i += cp.length;
  }
  return { text, from, to };
}

export function foldQuery(q: string): string {
  return fold(q.trim().replace(/\s+/g, ' ')).text;
}

/** All non-overlapping matches, as [start, end) offsets in the original string. */
export function findAll(f: Folded, needle: string, limit = 5000): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (!needle) return out;
  let at = f.text.indexOf(needle);
  while (at >= 0 && out.length < limit) {
    out.push({ start: f.from[at]!, end: f.to[at + needle.length - 1]! });
    at = f.text.indexOf(needle, at + needle.length);
  }
  return out;
}

/** Join PDF.js text items exactly as the text layer renders them. */
export function joinItems(items: readonly unknown[]): string {
  let s = '';
  for (const it of items) {
    if (!it || typeof it !== 'object' || !('str' in it)) continue;
    const t = it as { str: string; hasEOL?: boolean };
    s += t.str;
    if (t.hasEOL) s += ' ';
  }
  return s;
}
