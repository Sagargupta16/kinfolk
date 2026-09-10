# Deploying Kinfolk

Local setup is [SETUP.md](SETUP.md). This is the production path.

## Release verification in 0.4.0

Prepared on **2026-09-10** on `codex/production-corrections`. These changes are unpublished;
the checks below describe the working branch, not a completed production verification.
Completed local checks and their limits are in the [verification report](verification-0.4.0.md).

The branch adds `GET /api/health`: it returns 200 only when the database query can resolve
the required tables and columns and authentication variables are present. Failures return 503
without SQL, credentials, or family data. Responses are not cached.

`scripts/check-production.mts` verifies the expected serving commit, application identity,
protected reads, sample data, and the Pages asset manifest. Deployment verification waits
for the requested commit, rather than relying on a fixed delay. The daily health workflow
checks both surfaces without requiring them to have the same commit.

`PRODUCTION_URL` and the production environment's `DATABASE_URL` must be configured.
Missing settings fail the relevant job. Pages also embeds its build commit and checks
the tree deep link and files listed in its asset manifest, including lazy JavaScript
chunks, CSS, fonts, and `theme-init.js`, after publishing.

GitHub can report an inherited custom-domain Pages URL with an `http:` scheme.
The publishing job upgrades that metadata to `https:` before verification, retaining
the reported host and path. The readiness script continues to reject public HTTP URLs.

```bash
node --experimental-strip-types scripts/check-production.mts --api --wait
node --experimental-strip-types scripts/check-production.mts --spa --wait
```

Set `EXPECTED_COMMIT` to the release SHA, `PRODUCTION_URL` to the confirmed API origin,
and `SPA_URL` to the Pages mount when running these checks. These commands are read-only.
No new migration is introduced by 0.4.0. Related application writes use the
Neon HTTP driver's atomic `db.batch()` support; interactive `db.transaction()` is unsupported.
Photo uploads remain unconfigured until private storage and its authentication are approved.

## Recorded live state, 2026-08-08

The five probes used at the time passed. This dated record has not been reverified
for the prepared 0.4.0 branch and does not establish its production migration status.

| Surface | State |
| --- | --- |
| Static SPA, <https://sagargupta.online/kinfolk/> | **Live.** Built from `frontend/` and backed by the Vercel API. |
| API and Next fallback, <https://kinfolk-neon.vercel.app> | **Live.** The sample tree and authenticated API answer. |
| Sign-in | **Configured.** `/api/auth/providers` returns 200 and reports the GitHub provider. |

> **Migration baseline:** Production
> [Deploy run 31256902754](https://github.com/Sagargupta16/kinfolk/actions/runs/31256902754)
> verified 3/4 committed migrations, ran `drizzle-kit migrate`, then complete-checked
> 4/4 before endpoint verification passed. Release 0.3.1 adds
> `0004_dusty_karen_page.sql`, which contains only the atomic creation-budget table
> and its cascading tree foreign key—no genealogy rows or credentials. The deploy
> workflow applies every committed migration before its complete-history check.

The 0.3.1 runtime temporarily falls back to the prior timestamp-count budget if the app
promotion reaches production before migration `0004`; once the additive table exists,
capacity is reserved by one conditional Postgres upsert so concurrent serverless instances
cannot all pass together.

`DATABASE_URL` is a manually configured encrypted Vercel variable pointing at the existing
Neon project. The native integration was disconnected after it provisioned a separate empty
database, which made production fail with missing-table errors while the intended database
remained healthy.

What was verified after the secrets landed, rather than assumed:

- `/api/auth/providers` reports a `callbackUrl` of
  `https://kinfolk-neon.vercel.app/api/auth/callback/github`, matching the OAuth app's
  registered callback exactly -- which is what rules out `redirect_uri_mismatch`.
- Clicking "Continue with GitHub" reaches GitHub's own login with
  `code_challenge_method=S256` and `scope=read:user user:email`. GitHub ACCEPTED the
  redirect URI rather than rejecting it, which is the check that matters.
- `/api/auth/session` with no cookie returned `null`, not an `AdapterError`. A signed-out
  response alone does not prove database readiness; 0.4.0 adds a dedicated schema query.
- Production [Deploy run 31256902754](https://github.com/Sagargupta16/kinfolk/actions/runs/31256902754)
  found 3/4 committed migrations, applied `0003_fearless_mongu.sql`, and then
  complete-checked 4/4. The same run passed all deployment endpoint probes.
- The live smoke scripts (`db:smoke`, `db:smoke:kin`) passed against the live branch and
  cleaned up after themselves; both were removed in the 0.2.0 rework.

The last step of a sign-in -- entering GitHub credentials -- is deliberately NOT automated.
Minting a real session for a real account to test with is forbidden by the workspace rules,
so provisioning (one graph, one self node reading kinship "you") was proven by
`scripts/smoke-db.mts` against the same database instead, before that script was removed.

## Why the deployment is split

The Next application needs a server for routes such as:

```
┌ ○ /                          static
├ ƒ /api/auth/[...nextauth]    server-rendered on demand
├ ƒ /demo                      server-rendered on demand
├ ƒ /signin                    server-rendered on demand
└ ƒ /tree                      server-rendered on demand
```

These dynamic routes need a server at request time:

- `/tree` reads Neon per request and resolves an Auth.js **database** session.
- `/demo` is a route handler that sets an httpOnly cookie. A static file cannot set one, which is why it is a route rather than a page.
- Writes reach server actions or JSON route handlers. Person and family edits use
  `lib/tree/edit-actions.ts`; contact and record-link APIs enforce their own server-side
  access checks. Nothing on Pages writes directly to Neon.

GitHub Pages therefore serves the Vite SPA, not the Next build. The SPA calls Vercel's JSON
API and OAuth exchange, while the same graph components and domain logic are shared by both
frontends. The SPA stores its bearer token in `sessionStorage`; the Next fallback retains the
httpOnly-cookie flow for users who prefer it.

## Two things are deployed, to two places

| What | Where | URL |
| --- | --- | --- |
| The Vite SPA (`frontend/dist`) | GitHub Pages | `https://sagargupta.online/kinfolk/` |
| API, OAuth exchange and Next fallback | Vercel | `https://kinfolk-neon.vercel.app` |

The recorded Pages setup uses the existing `sagargupta.online` certificate and `/kinfolk/`
subpath. Confirm that configuration before changing the production host.

The Pages workflow uploads only the built `frontend/dist` artifact, never repository source
or source maps. Set the repository variable `VITE_API_BASE_URL` to the Vercel origin; the
workflow refuses to publish when it is missing or is not HTTPS.

## The URL: sagargupta.online/kinfolk

The Pages build sets `GITHUB_PAGES=true`, which makes Vite emit assets under `/kinfolk/`.
The workflow also copies `index.html` to `404.html`, so direct links such as
`/kinfolk/tree` render the SPA body. GitHub Pages still returns HTTP 404 for that
fallback document; the client route works, but status probes must not mistake the
intentional fallback status for a blank or broken page.

Vercel remains at its own origin, and the Next app no longer reads a mount path at all --
its base-path support was removed in the 0.2.0 rework. The Pages app calls it
through `VITE_API_BASE_URL`; no DNS proxy or apex migration is required.

## One-time setup

### 1. Import the repo into Vercel

At [vercel.com/new](https://vercel.com/new), import `Sagargupta16/kinfolk`. It detects Next.js; [`vercel.json`](../vercel.json) pins the rest.

The region is pinned to **`sin1`** (Singapore) to sit beside the Neon project, which is in `aws-ap-southeast-1`. Left on a US default, every query would cross an ocean and back -- and `/tree` issues several per render.

### 2. Environment variables, in Vercel

Set these for **Production** (Settings -> Environment Variables). The recorded deployment
policy disables Preview builds; do not copy production credentials to a new preview environment.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon connection string. The **pooler** host is correct here -- the app talks over the serverless HTTP driver, and a serverless function opens a connection per invocation. |
| `AUTH_SECRET` | A fresh 32+ byte random string. **Not** the one from `.env.local`: a local secret that leaks should not be able to forge production sessions. Generate with `node -e "console.log(require('crypto').randomBytes(33).toString('base64'))"`. |
| `AUTH_URL` | `https://kinfolk-neon.vercel.app`, with no trailing slash. Auth.js builds its callback URL from this. The 2026-08-08 checks found the other Vercel aliases unsuitable; confirm the intended host rather than guessing. |
| `AUTH_TRUST_HOST` | `true`. Auth.js must trust Vercel's forwarded host. |
| `AUTH_GITHUB_ID` | From the production OAuth app below. |
| `AUTH_GITHUB_SECRET` | Same. |

There is no mount-path variable to set: the `NEXT_PUBLIC_BASE_PATH` support was removed in
the 0.2.0 rework, and the Next app owns its origin. The `/kinfolk/` mount belongs to the
Vite build on Pages, not to the Vercel origin.

`db:push`, `db:migrate`, and the GitHub migration workflow need the **direct**
(non-pooler) host. The running Vercel app uses the pooler host.

### 3. A SEPARATE GitHub OAuth app for production

The development app's callback points at `http://localhost:3007`, so it cannot serve the deployed site. Create a second one at [github.com/settings/developers](https://github.com/settings/developers):

- **Application name**: `Kinfolk (Prod)`
- **Homepage URL**: `https://sagargupta.online/kinfolk/`
- **Authorization callback URL**: `https://sagargupta.online/kinfolk/auth/callback/github`
- **Enable Device Flow**: leave OFF

The callback is the SPA's own route. It posts GitHub's one-time code to Vercel's
`/api/oauth/callback` endpoint, where the secret exchange and session creation happen.

The Next fallback generates a different callback,
`https://kinfolk-neon.vercel.app/api/auth/callback/github`. Both implementations currently
read the same `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`. Provider configuration for both
origins must be verified before claiming both sign-in paths work; the source code alone
does not establish that GitHub accepts both callbacks. Do not change the working OAuth
registration merely to satisfy this document.

Device Flow stays off because it exists for inputless devices (a CLI, a TV) that cannot host
a browser redirect. Kinfolk is a web app with a callback, so enabling it would add a second
way to mint tokens that nothing here uses.

Keep local and production registrations separate so revoking local access cannot lock out production.

### 4. GitHub repository secrets and variables

For the workflows in [`.github/workflows/`](../.github/workflows):

| Kind | Name | Purpose |
| --- | --- | --- |
| Secret | `DATABASE_URL` | Migrations only. Use the **direct** host: drizzle-kit needs TCP. |
| Variable | `PRODUCTION_URL` | The confirmed deployed origin, with no trailing slash. Missing configuration fails verification. |
| Variable | `VITE_API_BASE_URL` | Vercel origin used by the Pages SPA. **Required** by `pages.yml`. |
| Variable | `PAGES_URL` | Optional override for the daily health check's SPA URL; defaults to `https://sagargupta.online/kinfolk/`. |

`PRODUCTION_URL` is required rather than guessed. An earlier workflow checked an unrelated
site at `kinfolk.vercel.app`; successful status codes did not identify the application.
Both production workflows now fail if the confirmed origin is missing.

Create a **`production` GitHub Environment** and scope `DATABASE_URL` to it. That way only the migrate job can read it, and a required reviewer can be added later without touching the workflow.

CI needs no secrets at all. `lib/db/client.ts` is built to import cleanly with no `DATABASE_URL`, and nothing queries at build time, so the build step passes a throwaway `AUTH_SECRET` and no database.

## What runs when

| Workflow | Trigger | Does |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | PRs targeting `main`, pushes to `main`, or manual dispatch | frozen-lockfile install, lint, both typechecks, isolated tests, dependency audit at high severity, both builds, and the built-CSS guard |
| [`deploy.yml`](../.github/workflows/deploy.yml) | pushes to `main` matching its runtime/migration paths, or manual dispatch | requires migration configuration, checks history before and after applying committed migrations, then waits for the exact serving SHA and API readiness |
| [`health.yml`](../.github/workflows/health.yml) | daily at 02:31 UTC or manual dispatch | checks API identity, schema readiness, auth configuration, protected reads, sample data, and Pages assets without requiring equal deployment SHAs |
| [`pages.yml`](../.github/workflows/pages.yml) | pushes to `main` matching SPA/shared UI paths, or manual dispatch | builds and publishes `frontend/dist`, then checks the published SHA, manifest assets, and theme script |

Vercel's Git integration and `deploy.yml` start independently on the same push. The workflow
applies committed migrations, then requires the requested commit to serve a ready API.
It cannot gate Vercel's promotion, so runtime changes must tolerate the previous schema
during that rollout window.

### Migrations

`deploy.yml` runs `pnpm db:migrate`, never `db:push`. Push diffs the live schema and applies whatever it infers, which is right for a scratch branch and dangerous in production -- it can drop a column it believes is redundant. `migrate` runs the committed SQL in `drizzle/` in order and nothing else.

Committed migration history runs from `0000` through `0004`. Before writing, the deploy
preflight requires the live history to be an exact prefix of those committed files;
after `db:migrate`, the complete check requires every committed migration. The baseline
procedure below is historical and applies only to an existing database created before
migration tracking. A new empty database should run the committed migrations.

The schema was originally created with `db:push`, so `0000` is a BASELINE: a full
`CREATE TABLE` script describing tables that already exist. Running it against the live
database fails on its first statement, because drizzle generates bare `CREATE TABLE`
without `IF NOT EXISTS`. It has to be recorded as applied instead.

Drizzle tracks applied migrations in `drizzle.__drizzle_migrations`, keyed by the sha256 of
each file's contents, and applies any migration whose journal timestamp is newer than the
newest recorded row. So seeding one row for `0000` makes `migrate` skip it and run `0001`
onwards normally.

For an existing untracked database, first verify that its schema matches the committed
baseline and obtain explicit approval for the production write. Only then record the
baseline once, using the direct (non-pooler) host in `DATABASE_URL`:

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
```

```sql
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
```

Then insert the baseline's hash and its `when` value from
[drizzle/meta/\_journal.json](../drizzle/meta/_journal.json), where the hash is the sha256
of `drizzle/0000_*.sql` exactly as committed. Keep deployment blocked until the baseline
and migration history are verified. Missing production `DATABASE_URL` now fails the
migration job; it must not be used to skip verification. No baselining was performed
as part of this documentation update.

`0001` drops `NOT NULL` from `users.email`, which is a real fix rather than housekeeping.
GitHub does not always return an email -- Auth.js falls back to `GET /user/emails`, but that
is skipped if the request fails -- and the adapter's insert was then rejected by Postgres,
bouncing the visitor to `/api/auth/error?error=Configuration`. A message about server
configuration for what is really a missing field on somebody's GitHub account.

Migration `0002` adds database checks that prevent `owner` from being granted through
`tree_members` or `tree_invites`; ownership remains represented by `trees.owner_id`.

Migration `0003` makes a non-null `people.claimed_by_user_id` unique. Starter-person
provisioning also uses the user's UUID as that row's deterministic primary key, so
parallel sign-ins conflict safely even if Vercel promotes while `0003` is still being
applied; the index becomes the database-wide backstop once the migration lands.

Migration `0004` adds `people_creation_budgets` for atomic creation-capacity reservations.
The 0.4.0 readiness query requires that table. The dated 4/4 production check above
does not establish that `0004` has been applied; the complete-history check must verify it.

After any later schema change, run:

```bash
pnpm db:generate
```

and commit the generated file. Before and after applying it, run:

```bash
pnpm db:check-migrations
pnpm db:migrate
pnpm db:check-migrations --complete
```

### What the checks assert

The working branch's [`check-production.mts`](../scripts/check-production.mts) checks
these responses. This table describes the code, not a newly completed production run:

| Path | Expect | Why this one |
| --- | --- | --- |
| `/api/health` | 200 | Requires `ready` database/status and configured auth; deployment checks also compare `commit` with `EXPECTED_COMMIT`. |
| `/` | 200 | Must contain Kinfolk identity and Next static-asset markup. |
| `/signin` | 200 | Confirms the sign-in page responds. |
| `/api/auth/providers` | 200 | Requires the GitHub provider and the exact Auth.js callback on the API origin. It does not complete OAuth or prove the credential is valid. |
| `/tree` | 307 | Must redirect a signed-out request to `/signin`. |
| `/api/tree` | 401 | Refuses a signed-out private read. |
| `/api/tree?demo=1` | 200 | Requires a sample view with nodes and a positive people count. |
| Pages mount | 200 | Requires the SPA root and Kinfolk title; deployment checks also require the matching commit meta tag. |
| Pages tree deep link | 200 or 404 | Must serve the same Kinfolk app shell and expected commit, including the GitHub Pages 404 fallback. |
| Pages `asset-manifest.json` and listed files | 200 | Requires a canvas chunk, nonempty emitted assets including fonts, expected JS/CSS content types, and `theme-init.js`. |

Requests time out after 20 seconds. A normal run retries the check sequence up to three
times, with 10 seconds between attempts. `--wait` permits up to 30 attempts while the
deployment promotes, within the workflow's overall timeout.

## After the first deploy

1. Sign in with GitHub on the deployed site. Provisioning ([`lib/tree/provision.ts`](../lib/tree/provision.ts)) fires in the Auth.js `createUser` event, so the first sign-in is also the test that it works: you should land on `/tree` with one card, yourself.
2. Confirm `/api/auth/providers` lists `github` with the production callback and complete
   the intended OAuth flow. Provider metadata alone cannot validate sign-in.
3. Confirm the deploy job checked the expected serving SHA and complete migration history,
   and the Pages job verified its SHA and assets.
4. Run the health workflow by hand (`workflow_dispatch`) rather than waiting for the schedule.

## Gotchas

- **The session cookie is `kinfolk.session-token`, not the Auth.js default.** Cookies are scoped by host and never by port, so on `localhost` every Auth.js app shares one name -- a neighbour running the JWT strategy leaves a 627-character JWE where this app's 36-character uuid belongs, and `/tree` throws `AdapterError` for a visitor who never signed in. This matters less on a real domain but the rename stays.
- **`experimental.useTypeScriptCli: true` in `next.config.mjs` is load-bearing.** TypeScript 7 removed the compiler API Next reaches for directly. Remove the flag once Next supports TS 7 natively; until then the build fails without it.
- **pnpm 11 reads build-script approval from `pnpm-workspace.yaml`** (`allowBuilds:`), not `package.json`. A `pnpm.onlyBuiltDependencies` field is silently ignored and installs fail with `ERR_PNPM_IGNORED_BUILDS`.
- **`drizzle-kit push` on Windows prints `Changes applied` and then crashes** with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and exit code 3221226505. That is libuv tearing down the websocket after the work committed, not a failed migration. Confirm against `information_schema` rather than trusting the exit code.
