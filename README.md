# Folio

Folio is a private, offline-first web app for reading PDFs and studying with them. You import your own books, read, write on pages with a pen, finger or mouse, keep a notebook beside the book, and export backups and annotated copies. All of it runs in the browser. There is no server, account, analytics or cloud upload. Books and notes stay in this browser's storage on this device.

Status: **release candidate for P0 (PDF-first)**. Automated gates pass in Chromium. Production release is still blocked on physical iPad and Apple Pencil testing ([docs/DEVICE_QA.md](docs/DEVICE_QA.md)). See [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md).

## What works

- Library: import by picker or drag and drop, with validation (signature, 100 MB and 2,000-page limits, password prompt). Duplicates are detected by SHA-256. You can edit the title and author, search, sort, add favourites and collections, and delete with a warning about linked notes.
- Reader: single page, two-page spread (cover alone or paired), continuous scroll, fit width or page, zoom, view rotation, right-to-left order, page labels, outline, thumbnails, text selection, search with highlighted matches, bookmarks and resume position. Scanned pages show a notice that they have no text layer.
- Ink: pen, highlighter and whole-stroke eraser, with colours, widths, pressure where reported, and undo/redo. Strokes are stored in canonical PDF coordinates, so they stay aligned through zoom, rotation and resizing.
- Study: a notebook beside the book (tabs on phones) with drawing, typed text blocks, page templates, links to book pages and an independent zoom. Notebooks export as PDF.
- Data: download the original, export an annotated PDF copy (the original bytes are never changed), make a full or per-book `.folio-backup`, and restore with checksums verified. Restore is atomic. There's also a storage estimate, a persistence request, and delete-all with typed confirmation.
- Offline: an installable PWA with self-hosted PDF.js worker, fonts, CMaps and WASM. The readiness indicator is shown only after the precache is verified. Updates use prompt mode and wait while writes are in progress.
- Multi-tab: one tab can write at a time (Web Locks). Other tabs are read-only and say so.

Not in P0: EPUB, page-curl animation, native text highlights or underline, shapes, lasso, activity charts and goals (all P1). Also OCR, dictionaries, TTS, sync and AI.

## Requirements

- Node 22.12 or newer within 22.x (see `.nvmrc`) and npm 10.
- For E2E tests: Playwright Chromium (`npx playwright install chromium`).
- For the independent export-alignment test: Poppler `pdftoppm` (`apt install poppler-utils` or `brew install poppler`). Without it, that test is skipped and reported as skipped.

## Commands

```bash
npm ci                 # clean install from the lockfile
npm run dev            # dev server at http://localhost:5173 (no service worker)
npm run lint
npm run typecheck
npm run fixtures       # synthetic PDFs into tests/fixtures/generated (needs Playwright Chromium for the Unicode one)
npm run test           # unit tests (Vitest, non-watch)
npm run build          # copies PDF.js assets, type-checks and builds dist/ with the service worker
npm run preview        # serves dist/ on :4173 with the production headers from vercel.json
npm run test:e2e       # Playwright against the production preview (builds are not automatic: run npm run build first)
```

Useful environment variables for E2E: `FOLIO_BASE_URL=https://…` runs the suite against a deployed URL. `FOLIO_WEBKIT=1` adds a WebKit project. WebKit is an engine check only and doesn't count as iPad evidence.

## Deploying

The `vercel.json` here targets a static Vite build on Vercel (Hobby, free) with strict security headers: CSP, COOP, no referrer, frame denial. The routes use a hash, so no rewrites are needed. Connect the GitHub repository in Vercel. Preview deployments come from branches and pull requests, and production from `main`. See [docs/HANDOVER.md](docs/HANDOVER.md).

## Privacy and security notes

- Imported PDFs are treated as untrusted. Scripting, actions, auto-navigation, attachments and remote resources are not used. Links in a PDF are not followed automatically.
- Browser storage is not encrypted by Folio. Anyone with access to this browser profile can read the library.
- Backups are unencrypted ZIP files. Keep them somewhere private.
- On iPhone and iPad, Safari tabs and the Home Screen app keep separate libraries. Use a backup to move between them.

## Documentation

- [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md): the product plan (v2). Section 12 is binding.
- [docs/DECISIONS.md](docs/DECISIONS.md): decisions and deviations from the plan, with reasons.
- [docs/TEST_MATRIX.md](docs/TEST_MATRIX.md): each requirement mapped to a test, its status and the evidence.
- [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md): what is done, deferred or blocked.
- [docs/DEVICE_QA.md](docs/DEVICE_QA.md): the manual iPad and Apple Pencil script and results.
- [docs/HANDOVER.md](docs/HANDOVER.md): accounts, deployment and next steps.
- [CLAUDE.md](CLAUDE.md): working rules for coding agents in this repository.

Personal, non-commercial project. "Folio" is a working name.
