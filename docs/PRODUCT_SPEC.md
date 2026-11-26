# Folio — Product requirements & technical plan

**Version:** 2.0 • 26 November 2026  
**Status:** Reviewed implementation specification • Working name: Folio  
**Platform:** Responsive, offline-first web app | GitHub → Vercel

## 1. Product vision and scope

Folio is a private digital reading and study workspace combining the library and reading experience of Apple Books, the handwriting capabilities of Goodnotes, and the optional page-turning presentation of FlipHTML5. Readers import their own files; the product is not a bookstore or public book-hosting service.

**Primary audience:** Students using an iPad with Apple Pencil, readers of personal PDFs and EPUBs, and learners who want to read textbooks while taking notes. Secondary audience: phone and desktop users.

**Product promise:** Import a book in seconds, read it in a book-like interface, mark its pages, create linked notes and return exactly where you stopped, without an account or a dedicated server.

**Core decisions:** PDF-first; preserve original page formatting. EPUB support follows the reliable PDF experience. All user files and activity stay on the device by default. No cloud sync, subscriptions, AI API, mandatory login or public uploads in the initial release. Browser-only storage is not a guaranteed permanent backup.

**Key success criteria:** Users can import, read, annotate, reopen and export a book offline; annotations stay correctly aligned through zoom and rotation; no original PDF is overwritten; a complete backup can be restored in a fresh browser profile. Reading time is an estimate, not a claim about attention or comprehension.

## 2. Information architecture and user flows

| Area | Purpose | Primary actions |
|---|---|---|
| Library | Personal bookshelf | Import, resume, search, filter, collect, rename, delete |
| Reader | Immersive book reading | Turn pages, scroll, zoom, search, bookmark, annotate |
| Study | Book and notebook workspace | Resize panes, write, link notes to book pages |
| Notes | Cross-book knowledge library | Browse highlights, handwriting, text notes, export |
| Activity | Reading history and goals | Review sessions, unique pages, progress, goals |
| Settings | Device and data control | Themes, gestures, storage, backup, restore, accessibility |

**First visit:** Open site → choose Import book → select local file → validate and extract cover/metadata → persist original file → display library card → open reader. An empty state explains privacy and supported formats; no registration wall.

**Returning visit:** Library shows recently opened book with Resume action → restore page/offset, zoom and reading mode → continue immediately. If a file is missing or corrupt, offer re-import instead of a blank reader.

**Study flow:** Open textbook → activate annotation tools or Study mode → write directly on the page or in linked notebook → autosave → reopen from Notes or the book's page → export selected notebook or annotated copy.

**Backup flow:** Settings → inspect storage use → export versioned backup → save to Files/iCloud Drive manually → restore on another device → validate manifest and hashes → preview conflicts → restore into an empty library, append non-conflicting per-book packages, or explicitly replace after exporting the current library. Conflict resolution is P1.

## 3. Visual design and interaction specification

### Design system

Aim for a quiet, editorial, native-app-like interface, not a dashboard full of cards. Use an eight-point spacing rhythm, 12–16 px card radii, restrained shadows, 44 px minimum touch targets, visible keyboard focus and a reduced-motion option.

| Token | Light | Dark |
|---|---|---|
| App background | #F5F3EE | #161819 |
| Surface | #FFFFFF | #222526 |
| Text | #202522 | #F3F3EE |
| Secondary text | #626A65 | #AEB7B0 |
| Accent | #416C57 | #9CC6A9 |
| Reader paper | #FFFCF5 | #222526 |
| Border | #DCDDD6 | #3A403D |

Sepia reader background: #EDE0C5. Typography: system sans / Inter for UI; Literata or a system serif for reflowable reading; Noto Sans Bengali and appropriate Arabic fallback fonts for UI and EPUB where needed. Self-host assets where practical. PDF fonts are rendered by the PDF engine, not replaced by the UI typeface. Verify actual contrast and script rendering before release. PDF reader themes affect the surrounding UI by default; optional page inversion is opt-in and must never silently change diagrams, photos or exported files.

### Screen specifications

**Library:** Desktop sidebar with Library, Notes, Activity and Settings. On iPad, use collapsible sidebar; phone uses a bottom navigation or compact menu. Header contains search and Import. A Continue Reading strip appears above cover grid. Book cards display cover, title, format and progress; context menu offers rename, collection, export and delete. Empty/import/error states are designed explicitly.

**Reader:** Header contains Back, title, outline/search, bookmark, annotation toggle and more menu. The canvas area centers the page or spread, with subtle paper edges. Bottom scrubber shows actual page labels and current position. Tap blank margins to hide chrome in reading mode. Thumbnail drawer and outline are collapsible; no permanent sidebar on small screens.

**Study mode:** Landscape tablet/desktop starts with 55% book and 45% notebook, resizable; collapse either pane. Notebook can be blank, ruled, grid or dotted. Toolbar is reachable without covering the writing surface. Portrait phone uses tabs or a full-screen notebook instead of cramped split-screen.

**Notes and Activity:** Notes display book, page, timestamp and excerpt/thumbnail. Selecting a note jumps to its anchor. Activity shows estimated active minutes, unique pages viewed, completed books and goals, with accessible text equivalents for charts.

**Gesture policy:** In reading mode, finger swipes navigate and pinch zooms. In drawing mode, pen writes; finger behavior is configurable (default navigation). Do not turn pages during a stroke. Distinguish pan, zoom, selection and drawing state; cancel safely on pointer cancellation. Offer explicit next/previous buttons and keyboard shortcuts. Browser-level palm rejection and Pencil-specific features are not guaranteed.

## 4. Functional requirements and acceptance criteria

| ID | Priority | Requirement and acceptance |
|---|---|---|
| LIB-01 | P0 | Import PDF from file picker or desktop drop; invalid/unsupported file yields actionable error; no partial book record after failed write. |
| LIB-02 | P0 | Persist original bytes, extracted cover, title and page count; refresh and offline reopen work. Metadata editable; hash detects duplicate imports. |
| LIB-03 | P0 | Search titles/authors, sort by recent/title/progress, add collections and favourites, confirm deletion with related notes warning. |
| RDR-01 | P0 | Render PDF in single-page and continuous modes; fit width/page, pinch or button zoom, page jump, outline and thumbnails where available. |
| RDR-02 | P0 | Select/search native PDF text with match navigation; scanned pages clearly indicate unavailable text; original script and layout preserved. |
| RDR-03 | P0 | Single/double-page spread, RTL direction, reduced-motion fallback and a subtle page-turn transition. Drawing disables page-turn interactions. |
| RDR-05 | P0 | Create, rename, remove and jump to bookmarks; restore after reload. |
| RDR-06 | P1 | Optional realistic page curl behind an adapter; never sacrifice reading/drawing stability. |
| RDR-04 | P1 | EPUB import; adjustable typography, spacing, themes and navigation. Fixed-layout EPUB remains a separate compatibility case. |
| ANN-01 | P0 | Pen/highlighter/eraser, color/width, mouse/finger/pen input, pressure when reported, undo/redo. Save stroke on completion. |
| ANN-02 | P0 | Annotation coordinates remain aligned after zoom, rotate, resize, reload and mode change. Original bytes unchanged. |
| ANN-03 | P1 | Native text highlights, underline, typed notes, shapes, lasso and per-page annotation list. |
| NOTE-01 | P0 | Create notebook pages, draw/type, link page to book and open from either location; independent zoom and pane resizing. |
| EXP-01 | P0 | Download original book and full backup; restore in clean profile with all notes/progress preserved. |
| EXP-02 | P0 | Export annotated PDF and notebook PDF; verify marks align in independent PDF viewers; flag unsupported encrypted exports. |
| PRG-01 | P0 | Restore last location; track unique qualifying pages separately from current position. Allow manual mark complete/reset. |
| PRG-02 | P1 | Active-session history, daily/weekly activity, configurable reading goals and streaks; no network analytics by default. |
| OFF-01 | P0 | After initial successful load/cache, imported books, reading, annotation and backups work offline. Clear offline readiness indicator. |
| DAT-01 | P0 | Storage estimate, persistence request where available, quota failure handling, versioned migrations, delete all data with confirmation. |
| A11Y-01 | P0 | Keyboard navigation, focus indicators, labelled controls, accessible dialogs, reduced motion and non-gesture alternatives. |

P0 = release blocker; P1 = feature-complete first public milestone after reliable foundation. P2 = later enhancements.

## 5. Reading, handwriting and progress engineering

**PDF pipeline:** Validate file signature and parser result; handle password-protected PDFs with an in-memory password prompt (do not store passwords). PDF.js worker parses pages and extracts metadata/text/outline. Render visible pages and a small adjacent window only; use low-resolution thumbnails and a bounded LRU render cache. Cancel stale render tasks on zoom/navigation; avoid keeping hundreds of canvases resident. Text layer and annotation layer share the PDF viewport transform. Handle page rotation, mixed page sizes and crop boxes.

**Rendering modes:** One reading controller owns current location. Single/scroll/spread views share it. Page-flip adapter is optional and runs on pre-rendered nearby pages; do not rebuild or rasterize the whole book. If StPageFlip fails accessibility, rotation or performance tests, keep a subtle CSS transition and static spreads instead.

**Drawing:** Use Pointer Events, pointer capture, requestAnimationFrame and pressure-aware perfect-freehand strokes on a canvas overlay. Retain raw or simplified points plus width, color, opacity, tool and pressure. Store coordinates in canonical PDF user space (unrotated, bottom-left coordinate convention, actual crop-box offsets retained); inverse-transform input through the actual viewport and transform it back for display/export. Do not store screen pixels as authoritative coordinates. Eraser uses stroke hit testing; undo/redo uses reversible operations per document with bounded history. Save completed strokes transactionally, periodically checkpoint long strokes, and expose save status. Handle multi-touch and page navigation explicitly.

**Export:** pdf-lib creates a copy of the original PDF; map paths from canonical page space into PDF coordinates, preserving rotation and crop offsets. Draw freehand paths and transparent highlights, then test export at multiple zoom levels. Flattened marks may not be independently editable in third-party viewers; the Folio backup preserves editable strokes. Retain original untouched.

**Progress:** Save current page and scroll fraction after navigation/settled scroll; flush on visibility changes where possible. Track unique pages with at least 50% page visibility for a proposed five seconds; make this a configurable heuristic. For oversized zoomed pages, use visible viewport coverage or a deliberate user action. Track active elapsed time only while visible and recently interacting; proposed two-minute idle timeout, with user-adjustable settings and clearly described estimates. Completion = qualified unique pages / total pages, not last page number. EPUB uses canonical fragment identifiers (CFIs) and spine progression rather than fixed PDF page counts. Keep position and completion metrics distinct.

**Language and accessibility:** Preserve PDF layout for Bengali, Arabic and Finnish; support RTL reading direction, text selection where embedded text is valid, and keyboard controls. Scanned PDFs and some malformed embedded fonts will not support reliable text extraction. Local OCR is a later opt-in feature, not a promise of perfect accuracy. DRM-protected EPUBs are out of scope; no DRM bypass.

## 6. Technical architecture and stack

The production server serves static app assets. PDF bytes, rendering, annotations and statistics stay in the browser. No custom API, database server or API keys are required for v1.

```text
GitHub repository → Vercel build/CDN → React PWA on user's device
                                      ├─ Library / reader / study UI
                                      ├─ PDF.js worker + rendering adapters
                                      ├─ Pointer input + annotation engine
                                      ├─ Dexie repository → IndexedDB
                                      └─ Workbox service worker → app asset cache
```

| Layer | Recommended technology | Decision rationale |
|---|---|---|
| Frontend | React, TypeScript, Vite | Static SPA; no SSR or custom server needed |
| UI | Tailwind CSS, shadcn/ui primitives, Lucide | Consistent responsive components; customize visual identity |
| Navigation/state | React Router, Zustand | URL routes; transient UI state only; Dexie is durable source |
| PDF | pdfjs-dist (PDF.js) | Browser rendering, text and outline; worker-based parsing |
| Ink | Pointer Events, Canvas 2D, perfect-freehand | Local input and smooth pressure-aware strokes |
| Storage | Dexie.js / IndexedDB | Transactional records and file Blobs; schema migrations |
| Export | pdf-lib; JSZip for bounded backups | PDF copies and portable backup packages |
| PWA | vite-plugin-pwa / Workbox | Precache shell, worker, fonts and offline assets |
| Book presentation | StPageFlip behind adapter (P1) | Optional page curl; fallback if integration is fragile |
| EPUB | epub.js behind adapter (P1) | CFI-based navigation; sandbox and sanitize imported content |
| OCR | Tesseract.js, opt-in worker (P2) | Local scanned text recognition; lazy-load language packs |
| Quality | Vitest, Testing Library, Playwright | Unit, integration and end-to-end checks |
| Delivery | GitHub Actions + Vercel | Checks, preview builds and static production deployments |

Pin compatible dependency versions and lockfile at implementation, review licenses and advisories, and prove candidate integrations with a spike before committing. Do not assume current release numbers or iPad support without testing. Prefer exact tested direct dependency versions, a committed npm lockfile and a supported Node LTS version pinned in .nvmrc and CI.

### Suggested repository layout

```text
src/
  app/                 routes, shell, providers
  features/library/    import, book cards, collections
  features/reader/     controller, views, thumbnails, search
  features/ink/        gestures, stroke engine, history
  features/study/      notebooks, split workspace
  features/activity/   sessions, goals, progress
  core/documents/      PDF and EPUB engine adapters
  core/storage/        schema, repositories, migrations
  core/export/         PDF and backup serializers
  core/security/       validation and content sanitization
  components/          design system and shared controls
  workers/             parsing, indexing, optional OCR
  tests/               fixtures and automated tests
public/                icons, manifest assets
.github/workflows/     CI
```

## 7. Data model and resilience

| Store | Key / major fields |
|---|---|
| books | id, format, title, author, hash, coverId, pageCount, direction, timestamps |
| bookFiles | bookId, original Blob, MIME, size, checksum |
| collections / memberships | collectionId, title; collectionId + bookId |
| annotations | id, bookId, pageIndex/anchor, type, canonical geometry, style, timestamps |
| notebooks / notebookPages | id, linkedBookId, template; notebookId, order, page geometry, ink/text |
| bookmarks | id, bookId, location, label, timestamp |
| readingProgress | bookId, lastLocation, qualifiedPages/CFIs, completedAt, settings |
| readingSessions | id, bookId, startedAt, activeMs, localDate |
| settings | key, value; theme, input preferences, goals |

Use UUIDs, consistent zero-based internal PDF page indexing, explicit format-specific location types and UTC timestamps. Keep rendered canvases and thumbnails disposable; original files and user notes are durable data. Use indexed queries for bookId/page and recent activity. Version migrations and backup schema separately. Validate foreign references and use transactions for related mutations; broadcast changes or warn against simultaneous editing across tabs.

**Storage policy:** Check `navigator.storage.estimate()` and request persistence via `navigator.storage.persist()` where available. Neither a successful import nor a persistence request guarantees indefinite retention. Explain that clearing site data, browser eviction or changing origins can remove access. Offer a backup after first annotations and periodic local prompts; never imply cloud sync. Test Safari versus home-screen app storage behavior and different origins before promising portability.

**Backup format:** Versioned .folio-backup ZIP with manifest.json, original files, annotations/notebooks JSON, reading data and checksums. Validate schema, filenames, decompression limits, hashes and available capacity before restore. Stage and commit atomically where feasible; preserve existing library on failure. Support single-book export for large libraries and warn before oversized archives. Store no sensitive telemetry or passwords.

## 8. Privacy, security and nonfunctional requirements

- Import local files without uploading them. Avoid third-party analytics, remote fonts and unnecessary network requests; verify no book contents appear in network traffic. Offline app caches are separate from user document storage.
- Treat PDF and EPUB files as untrusted. Keep parsers updated, disallow executable content, sanitize EPUB HTML and isolate it in a restrictive iframe; block remote resources by default and confirm external links. Apply a tested CSP and security headers without breaking workers. Validate file sizes, ZIP expansion and input types; do not assume MIME is trustworthy.
- User owns imported content and is responsible for lawful use. Do not provide a public book-sharing catalogue or scrape commercial textbooks. Clearly distinguish personal import from publishing.
- Target WCAG 2.2 AA for application controls; source PDF/EPUB accessibility depends on the original file. Test VoiceOver, keyboard, contrast and reduced motion; use semantic text layer where practical.
- Proposed performance budgets (not measured): initial shell ≤ 3 seconds on representative Wi-Fi; first page ≤ 2 seconds for ordinary text PDFs after import; visible ink response target ≤ 50 ms; smooth scrolling on iPad with bounded memory. Stress-test 500-page and 100 MB representative files; define final import caps from measurements, not assumptions. Avoid claiming every PDF will work.
- Test on real iPad Safari and installed web app; iPhone Safari; current desktop Chrome, Firefox, Edge and Safari. Playwright WebKit is useful but not a substitute for actual Apple Pencil tests. Include orientation changes, touch cancellation, offline restart, low storage, malformed file, duplicate import and migration scenarios.

## 9. Implementation roadmap and release gates

Indicative solo-developer effort: 8–12 full-time weeks for the feature-complete first release, subject to device testing and scope. These are planning estimates, not a delivery promise. Build in vertical slices, not all screens before functionality.

| Stage | Scope | Exit criterion |
|---|---|---|
| 0 · 3–5 days | Spikes: PDF worker, IndexedDB Blob, iPad pen, coordinate roundtrip, Vercel/PWA | Import, draw, reload and export a test page in browser harness; record actual iPad QA separately as a release gate |
| 1 · 1–2 weeks | App shell, library, storage, import, PDF viewer | Offline reopen and reliable navigation on representative files |
| 2 · 2–3 weeks | Ink engine, save/undo, progress, backup/restore | Zoom/rotation alignment, no lost completed strokes, clean-profile restore |
| 3 · 1–2 weeks | Split notebook, annotations export, bookmarks and search refinements | Real study session and external PDF export pass |
| 4 · 1–2 weeks | Spread/flip adapter, EPUB, accessibility and activity | Reading modes stable; no regressions in pen input |
| 5 · 1–2 weeks | Device QA, security, performance, documentation, deployment | All P0/P1 acceptance gates pass or explicitly defer P1 items |

**First usable internal alpha:** Stages 0–2; not all P0 requirements are complete. **Public PDF-first release:** Complete stages 3–5 and all P0 gates, including bookmarks, study notebook, spread mode and annotated PDF export. **Feature-complete expansion:** Deliver P1 EPUB, curl, richer annotations and analytics after P0 stability; explicitly label unsupported formats. **Later:** OCR, local dictionaries, TTS, flashcards, optional AI and optional cloud sync with explicit consent. Do not add a cloud backend merely to implement the core product.

### Release test checklist

- Import valid, scanned, rotated, password-protected and malformed PDFs; handle invalid cases without corruption.
- Write using Apple Pencil, finger and mouse. Pan/zoom/rotate and reopen: strokes align. Undo/redo and eraser persist correctly.
- Restart offline after initial caching. Resume location; verify no unexpected network requests for document content.
- Export annotated PDF and notebook; inspect in independent viewers. Original file hash unchanged.
- Restore backup into fresh profile; compare book hashes, annotation counts, notebook contents and reading location. Test quota failures and interrupted imports.
- Confirm keyboard/VoiceOver navigation, reduced motion and touch targets. Run dependency audit, typecheck, lint, unit and E2E tests.

## 10. Deployment, cost and decision register

1. Create a personal GitHub repository; initialize Vite React TypeScript and commit lockfile. Add CI: clean install, lint, typecheck, unit tests, build and E2E smoke tests.
2. Import repo into Vercel, choose Vite preset, build command `npm run build`, output `dist`. Use hash-based client routing for v1 to avoid deep-link rewrite ambiguity; verify worker, manifest and asset URLs return correct content types. If switching to history routing later, configure SPA fallback only for navigation routes. No secret or database configuration for v1.
3. Use pull-request preview deployments to test; never treat preview origins as the user's production library. Merge approved code to main; use a stable production domain from first public release. Backups are required before changing domain or storage schema.
4. Validate HTTPS, service-worker scope and update flow. Prompt to reload for new versions only after pending writes finish. Provide rollback instructions and migration compatibility tests. No production user book data is stored in GitHub/Vercel.

**Cost:** Target €0 hosting for a personal, non-commercial project within GitHub/Vercel free limits; optional custom domain costs extra. Vercel Hobby is restricted to personal/non-commercial use; commercial operation requires a suitable plan. Cloud synchronization, external AI APIs, OCR compute services and public book hosting are excluded from the initial cost model.

| Risk / open decision | Mitigation or decision gate |
|---|---|
| Browser storage eviction | Persistence request, export/restore, visible storage warning; cannot guarantee permanence |
| iPad pen and palm behavior | Real-device spike; configurable pen-only mode, no native parity promise |
| Large PDFs and memory | Virtualization, cancellation, bounded cache, measured file limits |
| Flip effects conflict with drawing | Separate modes; remove library if integration fails |
| PDF export alignment | Canonical geometry and rotation test fixtures |
| EPUB scripts and archives | Sanitize/sandbox, prohibit remote content, bound expansion |
| Name and branding | Folio is provisional; check availability/trademarks before public branding |
| Sync expectations | Explicitly device-local; optional future architecture only |

**Definition of done:** A user can read, mark, study and securely back up a personal book without an account, including on an actual iPad. All P0 tests pass, documented P1 scope is delivered or deferred, no critical security/data-loss defects remain, and the static app is deployable from GitHub to Vercel.

## 11. Technical references

Implementation references; confirm dependency versions and compatibility when starting development.

- Vercel Hobby plan: https://vercel.com/docs/plans/hobby
- Vercel Git deployments: https://vercel.com/docs/git
- MDN storage quotas and eviction: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- WebKit storage policy: https://webkit.org/blog/14403/updates-to-storage-policy/
- PDF.js FAQ: https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions
- PDF.js project: https://mozilla.github.io/pdf.js/
- Pointer Events: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- Dexie: https://dexie.org/
- pdf-lib: https://pdf-lib.js.org/
- Vite PWA: https://vite-pwa-org.netlify.app/
- FlipHTML5 design reference supplied by user: https://online.fliphtml5.com/ddzmv/drrp/#p=1

**Planning assumptions:** The user has not selected a final name, design tokens, deadline, commercial model or exact dependency versions. This plan proposes those decisions where required and distinguishes untested targets from verified platform constraints. It is a product specification, not a completed or deployed application.


---

## 12. Review findings and binding implementation decisions (v2)

This section takes precedence over any earlier ambiguous language. The v1 plan was reviewed as a product and engineering specification, not as running software. No application has been built or tested. The product is feasible as a local-first PDF study app, but Apple Books/Goodnotes feature parity is not a reasonable first-release claim.

| Finding | Resolution |
|---|---|
| Study notebook, export and bookmarks were not all release blockers | Promote a basic linked notebook, bookmark CRUD, annotated PDF export and spread mode to P0. Keep advanced lasso, realistic curl and EPUB P1. |
| Storage described as local but portable behavior unspecified | Treat browser origin/profile and installed PWA as distinct until tested. Backup is the supported transfer mechanism. No promise that Safari and installed app share a library. |
| Backup merge and restoration too broad for a first release | Empty-library restore, non-conflicting per-book append and explicitly confirmed replace; conflict resolution is P1. Crash-safe staging, manifest validation and old-library retention required. |
| PDF geometry and eraser contract insufficiently precise | Use PDF.js viewport forward/inverse conversion, page-space geometry and whole-stroke eraser; golden fixtures test crop and rotation. |
| PDF reading and drawing gesture conflicts | Explicit mode state machine; no animation or page change while a stroke is active; no accidental touch marks in pen-only mode. |
| Unbounded archive, file and render memory | Initial conservative guardrails below; instrument synthetic benchmarks and revise only after evidence. |
| Progress metrics could misrepresent reading | Distinct position, qualified pages, manual completion and estimated time. Do not label visits as confirmed reading. |
| Offline mode lacked a first-use and update contract | Precache P0 dependencies, confirm production cache readiness, prompt updates only after writes finish; test offline cold reopen. |
| Implementation could stop at a visual prototype | Phase-by-phase runnable deliverables, requirement-to-test matrix and mandatory honest evidence logs. |
| EPUB security and anchor behavior | Deferred until dedicated security/CFI tests; no misleading EPUB picker in P0. |

### 12.1 Product boundaries and release contract

- P0 public release: PDF-only import; library management; single, spread and scrolling views; pinch/button zoom and accessible navigation; selectable/searchable embedded text; bookmarks; freehand annotations; basic linked notebook (draw/type, templates and export); progress/resume; original and annotated PDF export; backup/restore; offline PWA and storage management. Password-protected PDFs may be read if PDF.js supports them, but annotation export is explicitly unsupported in P0 for encrypted sources. No DRM bypass.
- P1: realistic curl, EPUB reader with text/bookmarks first (freehand annotations on reflowing text are not included), advanced annotation tools, reading analytics/goals, backup merge. P2: OCR, TTS, dictionaries, flashcards, AI, optional cross-device sync. Hide unimplemented actions instead of fake buttons. Scanned PDFs are readable as images in P0; text search is unavailable without embedded text.
- No paid services, accounts, external API calls for book processing, remote book URLs, public uploads, backend or third-party analytics. A personal noncommercial project is the deployment assumption, not permission for commercial use under Vercel Hobby. Product name, visual system and numerical limits are proposed decisions.

### 12.2 Explicit routes, screen states and navigation

Use hash routes: `/`, `/reader/:bookId`, `/study/:bookId`, `/notes`, `/activity` (P1), `/settings`. Root is Library. Use persistent shell outside immersive views. All required actions must work with keyboard, touch and mouse. Do not block normal browser back. Each screen has loading/empty/error/retry states; reader has missing file, corrupted file, password request, no-text and save failure states. Library shows file size and format, editable title and optional author, collection membership, last open and progress. Import file picker supports multi-select P0 only if imports run serially and each reports independent result; drag/drop desktop optional. A canceled import never creates a library record. A deleted book explicitly warns about linked annotations and notebook; choose delete associated content or detach notebook, atomically. No sample user books at runtime unless explicitly opened from a separately marked synthetic demo.

Breakpoints (proposed): <640 CSS px phone with compact menus and study tabs; 640–1023 tablet portrait/small window with collapsible library navigation; >=1024 landscape/desktop with sidebar and resizable split study. Use container widths, safe-area insets, dynamic viewport units and orientation-aware layout; test iPad split-screen widths, not device names alone. Never make a fixed-width canvas overflow the viewport. Keep zoom at 25–400% initially, with fit modes and accessible controls; zoom may be limited further by memory cap. Respect system reduced motion. PDF paper theme is not font reflow. EPUB font changes must reflow without losing CFI anchor.

### 12.3 Document and ink implementation contracts

Define discriminated location types: PDF `{kind:'pdf', pageIndex, xFraction, yFraction}` and future EPUB `{kind:'epub', cfi}`. Store viewer preferences separately. PDF engine returns document metadata, page descriptors (view box, intrinsic rotation, user unit), viewport, render task, text and outline; adapter owns cancellation and disposal. PDF.js is one-based at its boundary only; persistent pageIndex is zero-based. Retain page labels separately. Use one shared viewport for canvas, text and ink. Map CSS pointer coordinates into logical viewport coordinates using measured element bounds; apply `viewport.convertToPdfPoint` or equivalent inverse. Render/export with forward transform using matching viewport and actual PDF coordinates; do not multiply by devicePixelRatio twice. CSS canvas size differs from backing-store pixels. Store stroke widths in PDF user-space units and pressures in [0,1]; default 0.5 when pressure is absent. Use a stroke polygon generated in canonical geometry for both display and PDF export, or prove a geometrically equivalent path. PDF export does not flatten the entire page to an image. Preserve existing document content and test PDF hash before/after. If a PDF cannot safely export, show a clear error and offer original/backup.

Gesture states: `read`, `select`, `draw`, `erase`, `panZoom` with explicit pointer ownership. Pen writes in draw; finger writes only if enabled, otherwise pans/zooms; mouse draws in draw mode. In a pen stroke, ignore secondary touch until stroke ends; pointer capture, cancel and lost capture must not create ghost strokes. Provide cancel on interruption; completed committed strokes survive refresh. Use object/stroke eraser P0, not partial pixel erasing. Each committed stroke or erase command updates persistent data and undo history in a transaction; session-local undo/redo capped at 100 operations, reset on reopen (documented), new edits clear redo. Checkpoint active stroke every ~1 second if long; recover checkpoint explicitly after crash or discard with user confirmation. Report `Saving`, `Saved on this device`, or `Not saved — retry/export`; never show saved before transaction completes. Retain failed writes in memory and permit emergency notes export when possible. Disable navigation that would discard pending work, but never rely solely on unload events.

Notebook pages: A4-like virtual geometry independent of CSS size; same ink engine with notebook adapter. Store ordered pages, template, typed text blocks and optional linked PDF page. Add/delete/reorder pages, draw, type and export to PDF. P0 typed text may be one or more plain-text blocks with explicit positions; no rich text or handwriting recognition. Persist the notebook separately from book bytes. Ensure export either embeds compatible font glyphs or clearly warns about unsupported text; no silent loss of Bengali/Arabic. A rasterized notebook page export is acceptable if legible, unlike full-page flattening of original PDFs. Link selection jumps to saved page; a deleted source link becomes an explicit missing link.

### 12.4 Persistence, quotas, integrity and concurrency

Repository contract: components never write to IndexedDB directly. `LibraryRepository`, `InkRepository`, `ProgressRepository`, `BackupRepository` own transactions and typed errors. Database tables from section 7 are authoritative; add `metadata` (active library generation, schema version), `inkCheckpoints`, `notebookBlocks` if needed. Use indexes on `[bookId+pageIndex]`, notebook ordering and book hash (unique within active library). Original blobs are immutable. SHA-256 exact bytes before committing; duplicate import opens existing record or offers cancel (do not duplicate annotations silently). Cover generation is best effort; generic cover on failure. Hashing and parsing must not freeze UI; worker transfer/copy behavior measured.

Provisional limits for initial implementation, not browser guarantees:

| Resource | Initial guardrail |
|---|---|
| Single imported PDF | 100 MiB, max 2,000 pages; reject beyond with clear error |
| Active PDF parsing | One active document and one import job; release on close |
| Render cache | At most 6 full-page canvases, and 64 MiB estimated RGBA backing store; reduce resolution/evict if needed |
| Individual canvas | 8 million pixels maximum, further reduced on observed device failure |
| Thumbnails | ~160 CSS px wide, lazy and bounded; regenerable |
| Backup archive | 150 MiB compressed, 250 MiB expanded, 10,000 entries; reject before full extraction when possible, enforce actual byte counters during extraction |
| Backup restore | Capacity estimate plus actual transaction/quota handling; do not delete originals to make room |

Use bounded, preferably streaming ZIP handling for restore (e.g. fflate after compatibility spike, or equivalent streaming library; JSZip alone must not be assumed safe for untrusted expansion). JSZip may create small trusted exports if memory bounded. If whole-library export exceeds cap, offer separate per-book packages including linked notes and settings export. P0 allows a non-conflicting per-book package to be appended atomically to an existing library after validation; reject ID/hash collisions without modifying existing data. Full-library merge and conflict resolution remain P1. State these limits in UI. Validate archive version, manifest, allowed relative entry names, duplicate paths, record types, references, numeric finite geometry, file length/hash and actual expansion. Use strict schema validation (e.g. Zod). Do not execute archive entries. Stage data into a new library generation, validate completely, atomically switch active generation pointer, then garbage-collect previous generation only after commit. A canceled/crashed restore leaves old generation available; incomplete staging is cleaned on next startup after checking active pointer. Explicit replacement requires confirmation and an opportunity to export old data first; if no space, refuse without altering existing records.

Single-writer policy for P0: acquire an exclusive edit lease per origin/library using Web Locks when supported; otherwise use transactional IndexedDB lease with owner token, heartbeat and fencing revision, tested stale recovery. A second tab may read but cannot edit while lease held. Lease ownership must be rechecked in mutation transaction (or protected by held lock). BroadcastChannel is for notifications, not locking. If safe fallback cannot be proven, disable multi-tab editing and show actionable read-only message rather than risking lost updates. Migration failures are read-only with backup/recovery where possible; no automatic database reset. Production domain change requires export/restore. Private browsing may be ephemeral; never claim permanent data.

### 12.5 PWA, security and accessibility release requirements

P0 production build self-hosts PDF.js worker, standard font data, CMaps and any required WASM/assets matching the pinned package; test Unicode PDFs offline. Precache the complete P0 app shell and required lazy chunks within a defined build budget; no CDN dependencies. Confirm service worker activation and actual offline readiness, not merely registration. Service worker cache contains only application assets, never imported book blobs. Use prompt update mode and block reload during active writes/import/restore. Test old-version database migration before deployment; rollback must not silently open an incompatible database. Hash routes simplify static deployment; direct links and refresh must work. Use safe-area manifest icons and standalone display. Warn Safari users before installation that app and browser libraries may differ; offer export/import. Source: WebKit documentation explicitly describes isolated home-screen app data (see added references).

PDF imports are untrusted: disable embedded scripting/actions, remote resources, automatic links and attachments; do not render arbitrary document-supplied HTML; text via safe DOM APIs. Use patched dependencies and a restrictive tested CSP including same-origin workers (allow blob only if demonstrated necessary), `object-src 'none'`, `base-uri 'none'`, frame restrictions and no unexpected remote fetch. External links require explicit action. EPUB P1: sanitize DOM, sandbox without script permission, remove remote URLs, bound archive expansion, do not combine same-origin and script execution; verify actual epub.js integration can meet policy or defer. No claims of encrypted-at-rest storage: browser-local data is not inherently application-encrypted; device access and site compromise are threats. Exported backups are unencrypted and should be stored privately. Test hostile files and text content; never use real copyrighted fixtures in repo. Support screen reader labels, focus restoration, logical tab order, reduced motion and accessible non-gesture controls. Native source PDF accessibility remains variable.

### 12.6 Progress semantics and measurable gates

- Resume position is saved after page navigation and settled scrolling, independent of page-read estimate. Qualifying a PDF page: continuously visible at >=50% of the smaller of page area and viewport area for five seconds while document visible; allow manual mark. Unique page IDs count once, even revisits. Position and progress display separately. Manual complete flag is independent; reset requires confirmation. Estimated session seconds accumulate using monotonic clock only while visible and within 120 seconds of last interaction, with configurable idle threshold later; pause on hidden/focus loss as applicable; checkpoint every 15 seconds. Never claim verified reading time. Date grouping uses recorded local date and timezone; no double counting across tabs.
- Proposed release benchmarks: representative 100-page text PDF first visible page within 2 s after import has committed; 500-page synthetic PDF open and navigate page 1→250→500→1 without tab crash; ordinary 100 MiB file import completes or gives recoverable limit error; cache stays within configured cap; draw feedback target p95 <=50 ms on real target device measured by instrumentation (not native Pencil parity). Report actual device, OS, fixture, method and observed values. These are targets, not verified measurements. If a target misses, document actual result and adjust with approval before release.
- Coordinate roundtrip unit tests tolerance <=0.5 PDF user-space units, visual overlay/export alignment <=2 CSS px at tested scale for unrotated, 90/180/270-degree and cropped pages; independent PDF render comparison (not solely self-referential math). Include mixed page dimensions, intrinsic rotation, user unit and devicePixelRatio 1/2/3.
- Data integrity gate: import→annotate→close→offline reopen→export→restore in fresh profile yields equal original SHA-256, same committed stroke IDs/geometries, bookmark IDs, notebook text and resume location. Test simulated quota, failure between staged restore and commit, malformed ZIP/path traversal, interrupted update, and tab conflict. No data loss of committed writes in tests.
- UI gate: all P0 controls have actual behavior and disabled/error states; keyboard and touch navigation, orientation and resize pass; test 390×844, 768×1024, 1024×768, 1366×768 and actual iPad portrait/landscape. Use accessibility automated checks (axe or equivalent) plus manual screen-reader checks. Manual Apple Pencil/Safari/PWA evidence cannot be replaced by Playwright WebKit.

### 12.7 Delivery checklist and traceability

Every phase must leave a runnable app. Include `README.md`, `CLAUDE.md`, `docs/PRODUCT_SPEC.md`, `docs/DECISIONS.md`, `docs/TEST_MATRIX.md` (requirement ID, test command or manual procedure, status, evidence), `docs/BUILD_STATUS.md` (done/deferred/blocked), `docs/DEVICE_QA.md`, package lockfile, CI and Vercel configuration. Standard scripts: `npm ci`, `npm run dev`, `npm run lint`, `npm run typecheck`, `npm run test` (non-watch), `npm run build`, `npm run test:e2e` (with browser installation documented). Add synthetic fixture generator. CI runs clean install, lint, typecheck, unit, build, Chromium/WebKit smoke tests; test production build with service worker, not dev server. Release P0 requires all P0 acceptance criteria evidenced; unavailable physical iPad remains a release blocker, not a passing test. No actual repository push, paid resource or production deploy without user authorization.

### Added verification references (reviewed 26 November 2026)

- PDF.js viewport transformations: https://mozilla.github.io/pdf.js/examples/ and https://mozilla.github.io/pdf.js/api/
- WebKit storage and eviction: https://webkit.org/blog/14403/updates-to-storage-policy/
- Safari installed app data separation: https://webkit.org/blog/14403/updates-to-storage-policy/ and https://webkit.org/tracking-prevention/.
- Vite PWA prompt update: https://vite-pwa-org.netlify.app/guide/prompt-for-update.html
- Vercel Vite: https://vercel.com/docs/frameworks/frontend/vite ; Hobby: https://vercel.com/docs/plans/hobby
