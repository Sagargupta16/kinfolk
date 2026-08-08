---
name: kinfolk-release-verification
description: Verify a Kinfolk release or deployment change across versioning, changelog/docs, CI, Vercel API and Next fallback, GitHub Pages SPA routing, and Drizzle migrations. Use before release commits, deployment workflow edits, schema releases, or declaring either production surface healthy.
---

# Kinfolk release and dual-deployment verification

Kinfolk deploys two cooperating products: `frontend/` is a Vite SPA on GitHub Pages under `/kinfolk/`; Vercel serves the JSON API, OAuth exchange, database writes, and Next fallback. Verify both. Do not infer one is healthy from the other.

Never read or print `.env.local`, dump process environments, paste credentials into commands, or send secrets through an external service. Use placeholders for local checks and GitHub/Vercel secret stores for deployment. Do not automate the final credential entry of a real GitHub sign-in.

## 1. Establish the release record

Before editing release metadata:

```bash
git status --short
git tag --sort=-version:refname
git log --oneline <last-version-tag>..HEAD
```

If the repository does not have a matching version tag, use the commit that introduced the latest `CHANGELOG.md` version as the lower bound and say so. Review all commits in that range so merged work is not omitted.

- Give every release a real semantic version and absolute date; never add an `Unreleased` section.
- Keep the root `package.json` version and the newest changelog heading aligned. Do not invent a version for `frontend/package.json`, which is intentionally private and unversioned.
- Update `README.md`, `docs/DEPLOYMENT.md`, `docs/SETUP.md`, and `CLAUDE.md` only when their stated behavior, commands, live state, or current-version status changed. Update badges only if one exists.
- Record user-visible graph behavior, API contracts, schema/migration changes, and deployment changes. Include measured verification, not claims copied from implementation comments.

## 2. Reproduce CI locally once

Run the complete gate once after the release candidate is stable:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm --dir frontend typecheck
pnpm build
pnpm --dir frontend build
```

CI intentionally needs no `DATABASE_URL`; no query runs during build. Its throwaway `AUTH_SECRET` is build-only and must never be replaced with a real secret. Confirm `.github/workflows/ci.yml` still covers the Next build, Vite build, both typechecks, lint, and its built-CSS guard.

For a Pages-shaped artifact, use the active shell's equivalent of:

```bash
GITHUB_PAGES=true VITE_API_BASE_URL=https://kinfolk-neon.vercel.app pnpm --dir frontend build
cp frontend/dist/index.html frontend/dist/404.html
```

Expected: asset URLs use `/kinfolk/`, `frontend/dist/404.html` is byte-for-byte the app shell from `index.html`, and no source map is emitted. Do not commit `frontend/dist`.

## 3. Treat migrations as deployment code

**`drizzle/` is committed deployment input and must not be ignored.** The production workflow runs those ordered SQL files; without them, schema changes do not deploy. `.gitignore` must continue to leave `drizzle/` trackable, and `.github/workflows/deploy.yml` must continue to trigger for it.

For a schema change:

```bash
pnpm db:generate
git status --short drizzle
pnpm db:check-migrations
```

Review generated SQL and `drizzle/meta/_journal.json` together. Check for destructive drops, accidental nullability changes, unbounded rewrites, and ordering assumptions. Commit the SQL and matching metadata with the schema change.

Do not use `pnpm db:push` in production. `deploy.yml` must use `pnpm db:migrate`, preceded by `pnpm db:check-migrations` and followed by `pnpm db:check-migrations --complete`. A production migration requires explicit authorization and the direct, non-pooler Neon URL supplied through the protected GitHub environment; never place it in a transcript or command literal. The historical `0000` baseline must be recorded as applied on a pre-existing schema, not executed against tables it describes.

Remember that the Neon HTTP application driver has no transaction support. Review multi-write application changes for safe sequencing; do not assume a typechecking `db.transaction()` works at runtime.

## 4. Verify workflow responsibilities

- `ci.yml`: lint, both typechecks, both builds, and the built-CSS guard.
- `deploy.yml`: apply committed migrations, then probe Vercel. Vercel's Git integration performs the Next deployment; this workflow must not duplicate it.
- `health.yml`: daily public endpoint probes.
- `pages.yml`: require an HTTPS `VITE_API_BASE_URL`, build with the Pages base, copy `index.html` to `404.html`, upload only `frontend/dist`, and deploy with the required Pages permissions.

Check workflow runs and required checks after a push. Do not accept a skipped production probe as a pass: `PRODUCTION_URL` must be configured. Never add a guessed fallback hostname; this repository previously received green checks from an unrelated Vercel project.

## 5. Verify Vercel API and Next fallback

Use only the confirmed production origin from repository configuration. Probe without following redirects first:

| Path | Expected | Meaning |
| --- | --- | --- |
| `/` | 200 | Public landing page renders without a database read. |
| `/signin` | 200 | Fallback sign-in is reachable. |
| `/api/auth/providers` | 200 | Auth secret and GitHub provider are configured. |
| `/tree` | 307 signed out | Fallback enforces sign-in instead of failing. |
| `/demo` | 307 | Demo cookie route forwards to the tree. |
| `/api/auth/session` | 200 with `null` signed out | Auth adapter can reach Postgres without minting a session. |

Retry transient `000` responses before failing, as the workflows do. Confirm the response belongs to Kinfolk and contains Next assets; do not trust status alone. Use `kinfolk-neon.vercel.app`, not the SSO-gated alias or the unrelated `kinfolk.vercel.app` project.

## 6. Verify GitHub Pages and deep links

At `https://sagargupta.online/kinfolk/`:

- Load the landing page and sample graph at desktop/mobile sizes in light/dark themes.
- Confirm API requests go to the configured Vercel origin, not the Pages origin.
- Navigate directly to and reload `/kinfolk/tree`. Pages may return HTTP 404 for a custom `404.html`, but the body must be the SPA shell, not the stock Pages error; the client router must boot and render the requested screen.
- Confirm scripts, styles, icons, and chunks resolve below `/kinfolk/` after both normal navigation and a deep-link reload.
- Require a clean console and the same graph behavior/counts as the Next demo. In particular, exercise the feed or another Date consumer so the `TreeView` revival boundary is covered.

## 7. Report release readiness

Report: target version/date, commits reviewed for the changelog, docs updated or intentionally unchanged, local gate results, migration review and applied-history result, CI/deploy/health/Pages workflow state, Vercel endpoint statuses, Pages deep-link behavior, and any unverified item. Distinguish failure, skipped, and not run; only an observed pass is a pass.
