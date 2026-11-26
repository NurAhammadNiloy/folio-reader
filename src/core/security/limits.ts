// Provisional guardrails from spec 12.4. Not browser guarantees; revise only with evidence.
export const MiB = 1024 * 1024;
export const LIMITS = {
  maxPdfBytes: 100 * MiB,
  maxPdfPages: 2000,
  renderCacheCanvases: 6,
  renderCacheBytes: 64 * MiB,
  maxCanvasPixels: 8_000_000,
  thumbnailCssWidth: 160,
  backupMaxCompressedBytes: 150 * MiB,
  backupMaxExpandedBytes: 250 * MiB,
  backupMaxEntries: 10_000,
  zoomMin: 0.25,
  zoomMax: 4,
  undoLimit: 100,
  epubMaxEntries: 5_000,
  epubMaxExpandedBytes: 300 * MiB,
} as const;
