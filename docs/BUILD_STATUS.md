# Build status

Updated: 2026-11-26.

**Overall: P0 release candidate. Not released to production.** All automated P0 checks pass in Chromium. Production promotion is blocked on physical iPad and Apple Pencil QA (`DEVICE_QA.md`), which has not been done.

## Release gates

| Gate | State | Evidence |
|---|---|---|
| Lint, typecheck, unit tests | Pass (local) | `npm run lint`, `npm run typecheck`, `npm run test`: 38 unit tests |
| Production build with service worker | Pass (local) | `npm run build`: 415 precache entries (5,586 KiB), main chunk 445 kB (140 kB gzip) |
| E2E on the production build (Chromium) | Pass (local) | `npm run test:e2e`: 32 of 32 pass (1.3 min). See `TEST_MATRIX.md` |
| Dependency audit (runtime) | Pass (local) | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities |
| CI on GitHub | Pending | The repository has not been created yet |
| WebKit smoke (CI) | Pending | Not installable in the build container. It runs in CI only. Engine check only |
| Vercel preview deploy and live smoke | Pending | Needs the repository |
| Physical iPad, Apple Pencil, Safari, Home Screen | **Blocked: not performed** | `DEVICE_QA.md` |
| Independent viewers (Preview/Acrobat) for exports | Pending (manual) | Poppler check passes automatically |
| VoiceOver manual pass | Pending (manual) | axe passes |

## Done (P0)

Library (LIB-01..03), reader (RDR-01..03, RDR-05), ink (ANN-01..02), study notebook (NOTE-01), exports and backup (EXP-01..02), progress (PRG-01), offline PWA (OFF-01), data management (DAT-01), accessibility baseline (A11Y-01), hostile-PDF handling and CSP, password-protected PDFs, single-writer tabs, and the newer-schema downgrade guard. Partial items are named in `TEST_MATRIX.md`.

## Deferred (P1 and later, by plan)

EPUB (RDR-04), page-curl adapter (RDR-06), native text highlights, underline, shapes and lasso (ANN-03), activity charts, goals and streaks (PRG-02). Later: OCR, dictionaries, TTS, flashcards, AI and sync.

## Known limitations

- The notebook PDF is rasterised, so its text is not selectable (D7).
- The eraser removes whole strokes (D8).
- The menu uses the Popover API, so iPadOS 17 or newer is required (D4).
- No upgrade migration exists yet, because v1 is the first schema.
- Benchmarks were measured only in headless Chromium in a cloud container. There are no device numbers.
- Pinch zoom, finger and pen input, drag-and-drop import and pane-resize drag are not automated.

## Bugs found and fixed by the test suites

- The skip link broke hash routing (it navigated to `#main`). It now moves focus.
- Resume position could be lost on a reload within 400 ms of a page jump. Paged moves now save immediately.
- The reading-direction and spread menu labels did not update after toggling.
- Dexie 4 quietly opened, and even upgraded, a library from a newer schema. A preflight guard now refuses it.
- The sort select's accessible name included all its option texts.
