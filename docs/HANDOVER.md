# Handover

## Where things live

- Source: private GitHub repo `NurAhammadNiloy/folio-reader` (personal account). Not created as of 2026-11-26. The owner is creating it, because the build session cannot create repositories.
- Hosting: Vercel, Hobby (free) plan, personal scope, user `nurahammadniloy`. The project will be Git-connected, `folio-reader`. No paid add-ons, domains, analytics, Blob, databases or environment variables are used.
- No secrets exist. The app needs no API keys or environment variables. Don't add any.

## Deploy flow

1. Push a branch or open a PR. GitHub Actions CI runs (`.github/workflows/ci.yml`), and Vercel builds a **preview** deployment.
2. Check the preview: run `FOLIO_BASE_URL=<preview-url> npx playwright test tests/e2e/smoke.spec.ts tests/e2e/offline.spec.ts`, and run the manual `DEVICE_QA.md` on a real iPad against the preview URL.
3. Merge to `main` **only when every gate in `BUILD_STATUS.md` passes**. Vercel then deploys production.

If the preview has Vercel Deployment Protection turned on (the default for previews), automated checks from outside need the Vercel login or a protection bypass. Opening it in your own signed-in browser works.

## Rollback

In Vercel → Deployments, pick the previous production deployment and choose "Promote" or "Instant Rollback". Users' data lives in their browsers, so a rollback never touches it. An older build refuses to open a library written by a newer schema, rather than damaging it (D17). Keep schema bumps rare and always ship them with a tested upgrade.

## Next steps

1. Create the repository, push, and get CI green (including the first WebKit smoke run).
2. Connect Vercel, deploy a preview, and run the live smoke and header checks.
3. Run `DEVICE_QA.md` on a physical iPad with an Apple Pencil, in both Safari and the Home Screen app. Record the results and fix what fails.
4. Owner review of the decisions marked "Needs owner review" in `DECISIONS.md` (D4, D7, D16, D20).
5. Then promote to production, and move on to P1 (EPUB first).
