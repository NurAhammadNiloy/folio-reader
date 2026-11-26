// Bounded render cache (spec 12.4): at most N full-page canvases and B bytes of
// estimated RGBA backing store. Visible pages are never evicted; when the budget is
// tight, new renders get a reduced pixel ratio instead.

export interface BudgetEntry {
  key: number;
  bytes: number;
  visible: boolean;
  lastUsed: number;
  evict: () => void;
}

export class RenderBudget {
  private entries = new Map<number, BudgetEntry>();
  private clock = 0;
  constructor(
    readonly maxCanvases: number,
    readonly maxBytes: number,
    readonly maxPixels: number,
  ) {}

  get totalBytes() {
    let t = 0;
    for (const e of this.entries.values()) t += e.bytes;
    return t;
  }
  get count() {
    return this.entries.size;
  }

  /**
   * Reserve space for a canvas of cssW x cssH at the desired pixel ratio. Evicts least
   * recently used non-visible canvases as needed and returns the pixel ratio to use.
   */
  reserve(key: number, cssW: number, cssH: number, desiredRatio: number, visible: boolean, evict: () => void): number {
    this.release(key);
    let ratio = desiredRatio;
    // per-canvas pixel cap
    const px = cssW * cssH * ratio * ratio;
    if (px > this.maxPixels) ratio = Math.sqrt(this.maxPixels / (cssW * cssH));
    const need = () => Math.ceil(cssW * ratio) * Math.ceil(cssH * ratio) * 4;
    const victims = [...this.entries.values()].filter((e) => !e.visible).sort((a, b) => a.lastUsed - b.lastUsed);
    while ((this.entries.size >= this.maxCanvases || this.totalBytes + need() > this.maxBytes) && victims.length) {
      const v = victims.shift()!;
      this.entries.delete(v.key);
      v.evict();
    }
    // still over budget (only visible pages left): downscale, but keep it legible
    const free = this.maxBytes - this.totalBytes;
    if (need() > free) {
      ratio = Math.max(0.5, Math.sqrt(Math.max(free, 0) / 4 / (cssW * cssH)));
    }
    this.entries.set(key, { key, bytes: need(), visible, lastUsed: ++this.clock, evict });
    return ratio;
  }

  setVisible(key: number, visible: boolean) {
    const e = this.entries.get(key);
    if (e) {
      e.visible = visible;
      if (visible) e.lastUsed = ++this.clock;
    }
  }

  release(key: number) {
    this.entries.delete(key);
  }

  clear() {
    for (const e of this.entries.values()) e.evict();
    this.entries.clear();
  }
}
