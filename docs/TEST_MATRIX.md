# Test matrix

Status key: **Pass** means automated and passing at the evidence run. **Manual pending** means a manual procedure exists and has not been performed. **Partial** means automated in part, with the gap named. **Not tested** means implemented but with no automated or manual evidence yet.

Evidence run: 2026-11-26, 38/38 unit and 32/32 E2E passing, cloud build container (Linux, headless Chromium 1.63 build, 1366×768 unless noted). Command: `npm run test` (unit) and `npm run test:e2e` (E2E against `vite preview` of the production build, with the service worker and the production CSP). CI runs are listed in `BUILD_STATUS.md` once the repository exists.

**Physical iPad, Apple Pencil, Safari and Home Screen checks have not been done.** They are tracked in `DEVICE_QA.md` and block release.

| ID | Requirement (short) | Automated tests | Status | Evidence / gap |
|---|---|---|---|---|
| LIB-01 | Import via picker/drop, actionable errors, no partial records | `e2e/library: rejects invalid files…`, `…over 100 MB…`; `unit/storage: rolls back the whole import…`; `unit/validate` | Partial | Picker path, malformed, truncated, empty, not-a-PDF, EPUB, >100 MB (sparse 101 MiB file) and rollback all pass. **Drag and drop is not automated** (manual check in DEVICE_QA §2). |
| LIB-02 | Persist bytes, cover, title, page count; offline reopen; edit metadata; duplicate hash | `e2e/smoke`, `e2e/offline`, `e2e/library: duplicates…`, `…rename…`; `unit/storage: stores and reads back original bytes exactly` | Pass | |
| LIB-03 | Search, sort, collections, favourites, delete with linked-notes warning | `e2e/library: rename, favourite, collections, search and sort`, `…delete warns about linked content…`; `unit/storage: deletes a book…`, `…collections…` | Pass | |
| RDR-01 | Single/continuous, fit width/page, zoom, jump, outline, thumbnails | `e2e/reader: page labels, jump, outline, thumbnails and keyboard`, `…view modes…`, `…500-page…`, `…rotated, cropped…` | Partial | **Pinch zoom is not automated** (touch gesture). The buttons, keyboard and ctrl+wheel paths are covered. Pinch is in DEVICE_QA §3. |
| RDR-02 | Text select/search, match navigation, scanned notice, scripts preserved | `e2e/reader: search…`, `…text layer is selectable`, `…scanned pages…`; `e2e/offline` (Unicode text layer offline) | Pass | Selection is checked by text-layer presence, not by a drag-select gesture. |
| RDR-03 | Spread, RTL, reduced motion, page-turn, drawing disables page turns | `e2e/reader: view modes…`, `…RTL…`; `unit/reader: does not navigate while a stroke is active` | Partial | **The reduced-motion setting has no automated test.** The page-turn transition was checked visually only. |
| RDR-05 | Bookmarks create/rename/remove/jump, survive reload | `e2e/reader: bookmarks…` | Pass | |
| ANN-01 | Pen/highlighter/eraser, colour/width, mouse/finger/pen, pressure, undo/redo, save on completion | `e2e/ink: draw, save, reload, zoom, erase, undo/redo and export…`; `unit/geometry: stroke geometry`; `unit/reader: undo history` | Partial | Mouse input is automated. **Finger, Apple Pencil, pressure and palm rejection are manual pending** (DEVICE_QA §4). |
| ANN-02 | Alignment after zoom/rotate/resize/reload/mode change; original unchanged | `unit/geometry: roundtrip ≤0.5 units` (6 geometries × 4 rotations × 4 scales × DPR 1/2/3); `unit/exportAlignment` (Poppler, ≤2 px); `e2e/ink` (pixel check after reload and zoom; hash unchanged) | Pass | On-device alignment is also in DEVICE_QA §4. |
| NOTE-01 | Notebook pages, draw/type, link to book and open from either side, independent zoom, pane resize | `e2e/study: study: notebook beside the book…`, `…phone layout uses tabs…` | Partial | **Pane resizing is not automated.** The keyboard-resizable separator was checked by hand in Chromium only. |
| EXP-01 | Download original and full backup; restore in a clean profile with everything preserved | `e2e/data: import → annotate → notebook → backup → restore in a fresh browser profile…`; `unit/backup` (roundtrip, conflict, simulated quota rollback, traversal, corrupt, checksum, zip bomb, schema, version) | Pass | Compares the original SHA-256, stroke IDs and geometry, bookmark IDs, notebook text and resume location. |
| EXP-02 | Annotated PDF and notebook PDF; alignment in independent viewers; flag encrypted | `unit/exportAlignment`; `e2e/ink` (export download); `e2e/study` (notebook PDF download); `e2e/password` (encrypted export disabled with a reason) | Partial | The independent renderer is Poppler. **Apple Preview and Acrobat checks are manual pending** (DEVICE_QA §6). |
| PRG-01 | Restore location; unique qualifying pages separate from position; mark complete/reset | `e2e/smoke` (resume after reload); `e2e/progress`; `unit/storage: saves location and counts qualified pages once` | Pass | Uses the default 5 s qualify time. Two pages are counted, and a revisit doesn't double-count. |
| OFF-01 | Offline after first load; readiness indicator | `e2e/offline: after first load… (OFF-01)` | Pass | Chromium service worker only. **iPad Safari and Home Screen offline is manual pending** (DEVICE_QA §5). |
| DAT-01 | Storage estimate, persistence request, quota handling, migrations, delete all | `e2e/data: delete all data…`, `…newer schema is refused…`; `unit/backup: …simulated quota`; `unit/storage: maps quota and unknown errors` | Partial | No schema migration exists yet (v1 only), so **upgrade migration is not tested**. The downgrade guard is tested. The estimate and persist UI have no automated assertions. |
| A11Y-01 | Keyboard, focus, labels, dialogs, reduced motion, non-gesture alternatives | `e2e/a11y`: axe (WCAG 2.2 AA tags) at 390×844 and 1366×768 for library, notes, settings and reader; no overflow at 390, 768, 1024 and 1366 widths; keyboard skip link and open book; dark theme contrast | Partial | **The VoiceOver manual check is pending** (DEVICE_QA §7). The text layer is excluded from axe because it mirrors the source PDF. |
| SEC (§12.5) | Hostile PDFs, CSP, no remote fetch, self-hosted assets | `e2e/reader: hostile PDF…`; `e2e/offline: serves security headers…`; the smoke, reader, offline and password tests assert no external requests | Pass | Headers are tested on `vite preview` with the same values as `vercel.json`. They are re-checked on the live preview after deployment. |
| PERF (§12.6) | 100-page first page <2 s; 500-page 1→250→500→1; 100 MiB import or recoverable error; cache cap | `e2e/perf` → `docs/qa/perf-chromium.json`; `e2e/reader: 500-page…` (≤6 canvases); `unit/reader: render budget` | Partial | Measured only in headless Chromium in the container: 386 ms to first page (100 pages), jumps of 51–130 ms. **No iPad numbers.** **Draw latency p95 ≤50 ms needs device instrumentation** (DEVICE_QA §4). |
| Password PDFs | Prompt, wrong password, never stored, ask again | `e2e/password` | Pass | |
| Multi-tab | Single writer, read-only second tab | `e2e/tabs`; `unit/storage: single-writer lease` | Pass | |

## Not covered by any test (known gaps)

- Drag and drop import, pinch zoom, finger and pen input, pane resize drag, reduced-motion setting, storage-estimate UI.
- The service worker update prompt being blocked during writes (implemented in `UpdateBanner`, not automated).
- Interrupted import: a crash mid-import is covered by transaction atomicity in unit tests only.
- Reading-session time recording.
