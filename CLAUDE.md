# CLAUDE.md: working rules for Folio

Read `docs/PRODUCT_SPEC.md` §12 first. It is binding. Record every deviation in `docs/DECISIONS.md`.

## Product boundaries (do not cross without the owner's explicit approval)

- Browser only. No backend, API keys, accounts, analytics, telemetry, remote fonts, CDNs or cloud uploads.
- No paid services. Vercel stays on the Hobby plan, and the GitHub repo stays private.
- Never commit credentials, `.env*`, `.vercel/`, user books or private data. Use synthetic fixtures only (`scripts/generate-fixtures.mjs`, `tests/fixtures/static/`).
- Never claim a test, device check or deployment that did not happen. Browser emulation and Playwright WebKit are **not** iPad or Apple Pencil evidence.
- Do not weaken assertions, skip or mute tests, or hide console errors to get green checks.
- Do not force-push. Do not promote to production until every release gate in `docs/BUILD_STATUS.md` passes, including physical iPad QA.

## Commands

`npm ci` · `npm run dev` · `npm run lint` · `npm run typecheck` · `npm run test` · `npm run build` · `npm run test:e2e` (after `npm run build`, needs Playwright Chromium; `pdftoppm` for the export-alignment unit test).

Re-run only failing tests while fixing. Run the full suite before a commit that changes behaviour.

## Architecture in one screen

- `src/core/storage`: Dexie (IndexedDB) schema (`db.ts`), repositories, and the single-writer lease (`lease.ts`, Web Locks). All writes go through `mutate.ts`, which checks the lease, tracks pending writes and maps errors. Multi-record changes are one transaction.
- `src/core/documents/pdfEngine.ts`: the only module that talks to PDF.js. The worker, CMaps, standard fonts, WASM and ICC profiles are self-hosted from `public/pdfjs` (copied at build time by `scripts/copy-pdfjs-assets.mjs`). Scripting is never enabled.
- `src/core/ink/geometry.ts`: the canonical coordinates. Strokes are stored in PDF user space, and notebook strokes in notebook page units. Convert through the PDF.js viewport only. Apply devicePixelRatio once, in the render transform.
- `src/core/export`: annotated PDF (pdf-lib, original content wrapped in q/Q and vector outlines appended), notebook PDF, and the backup format (fflate streaming, zod schema, SHA-256 per entry).
- `src/features/*`: library, reader (render budget, page views, panels, toolbars), ink layer, study and notebook, notes, settings, backup UI and PWA registration.
- Routes use `HashRouter`. Static hosting needs no rewrites.

## Invariants that tests enforce

- An import either creates the book, file and cover together or creates nothing.
- Original PDF bytes are never modified. Exports are copies, and their hash is verified first.
- Restore validates everything before writing, then commits in one transaction. On failure the old library is untouched.
- An older build never opens a library written by a newer schema (`installedVersion` preflight in `main.tsx`).
- The render cache holds at most 6 canvases, 64 MiB and 8 MP per canvas. Visible pages are never evicted.
- The service worker precaches app assets only, never books.
- CSP from `vercel.json` is applied to `vite preview` too, so E2E runs under the production CSP.

## Schema changes

Bump `SCHEMA_VERSION` in `db.ts`, add an explicit Dexie `upgrade()`, and add a unit test that migrates a v(N-1) fixture database. Never reset or delete a database automatically.

## Commits

Small, descriptive commits on a branch. Open a PR to `main`. CI must be green. Keep `docs/TEST_MATRIX.md` and `docs/BUILD_STATUS.md` honest in the same PR.
