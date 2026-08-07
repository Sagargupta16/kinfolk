# Deploying Kinfolk

Local setup is [SETUP.md](SETUP.md). This is the production path.

## Live state, 2026-08-07

Fully configured. All five health probes pass.

| Surface | State |
| --- | --- |
| The app, <https://kinfolk-neon.vercel.app> | **Live.** One Next.js deployment serving every page, the sample tree and all writes. |
| Sign-in | **Configured.** `/api/auth/providers` returns 200 and reports the GitHub provider. |

Since the 0.2.0 consolidation there is nothing else to deploy: the separate Vite SPA, its
GitHub Pages workflow and the bearer-token JSON API are gone. Reads happen in server
components through `loadTreeView()`, every write is a server action carrying the httpOnly
session cookie, and sign-in is Auth.js's own round trip on this origin.

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
- `/api/auth/session` with no cookie returns `null`, not an `AdapterError`. That is the
  proof the Drizzle adapter reached Postgres: a broken connection surfaces here first.
- `pnpm db:check-migrations --complete` reports all 3 committed migrations applied.

The last step of a sign-in -- entering GitHub credentials -- is deliberately NOT automated.
Minting a real session for a real account to test with is forbidden by the workspace rules,
so the check stops at GitHub's own login page with an ACCEPTED `redirect_uri`.

## Why this needs a server

The Next build reports dynamic routes:

```
┌ ○ /                          static
├ ƒ /api/auth/[...nextauth]    server-rendered on demand
├ ƒ /demo                      server-rendered on demand
├ ƒ /signin                    server-rendered on demand
└ ƒ /tree                      server-rendered on demand
```

Every `ƒ` needs a server at request time:

- `/tree` reads Neon per request and resolves an Auth.js **database** session.
- `/demo` is a route handler that sets an httpOnly cookie. A static file cannot set one, which is why it is a route rather than a page.
- Every write is a server action (`lib/tree/edit-actions.ts`), authorised server-side in `lib/tree/authz.ts`.

So the whole app deploys to Vercel, and nothing deploys anywhere else. A static host
cannot run Auth.js, query Neon, or execute server actions -- which is why there is no
static build to publish.

## One deployment, one environment

Vercel serves everything at <https://kinfolk-neon.vercel.app>. Two settings keep it to
exactly one environment:

- **Preview deployments are disabled** on the project (`previewDeploymentsDisabled: true`),
  so a branch or PR never produces its own deployment.
- **`ignoreCommand`** in [`vercel.json`](../vercel.json) runs
  [`scripts/vercel-ignore-build.sh`](../scripts/vercel-ignore-build.sh), so a commit
  touching only docs, migrations, workflows or markdown never builds at all. Its filter is
  a DENY list on purpose: a wrongly skipped deploy is a deployment that silently never
  happens, which is worse than one wasted build.

## One-time setup

### 1. Import the repo into Vercel

At [vercel.com/new](https://vercel.com/new), import `Sagargupta16/kinfolk`. It detects Next.js; [`vercel.json`](../vercel.json) pins the rest.

The region is pinned to **`sin1`** (Singapore) to sit beside the Neon project, which is in `aws-ap-southeast-1`. Left on a US default, every query would cross an ocean and back -- and `/tree` issues several per render.

### 2. Environment variables, in Vercel

Set these for **Production** (Settings -> Environment Variables):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon connection string. The **pooler** host is correct here -- the app talks over the serverless HTTP driver, and a serverless function opens a connection per invocation. |
| `AUTH_SECRET` | A fresh 32+ byte random string. **Not** the one from `.env.local`: a local secret that leaks should not be able to forge production sessions. Generate with `node -e "console.log(require('crypto').randomBytes(33).toString('base64'))"`. |
| `AUTH_URL` | **`https://kinfolk-neon.vercel.app`**, with no trailing slash. Already set. Auth.js builds its callback URL from this, so a wrong value fails sign-in with `redirect_uri_mismatch`. Vercel assigned THREE aliases and only this one is usable: `kinfolk-sagargupta16s-projects.vercel.app` is SSO-gated and 302s every request to a Vercel login, and `kinfolk.vercel.app` belongs to an unrelated project. |
| `AUTH_TRUST_HOST` | `true`. Already set. Auth.js is behind Vercel's proxy and will not trust the forwarded host without it, so sign-in fails even with every other value correct. |
| `AUTH_GITHUB_ID` | From the production OAuth app below. |
| `AUTH_GITHUB_SECRET` | Same. |

`db:push`, `db:migrate`, and the GitHub migration workflow need the **direct**
(non-pooler) host. The running Vercel app uses the pooler host.

### 3. A SEPARATE GitHub OAuth app for production

The development app's callback points at `http://localhost:3007`, so it cannot serve the deployed site. Create a second one at [github.com/settings/developers](https://github.com/settings/developers):

- **Application name**: `Kinfolk (Prod)`
- **Homepage URL**: `https://kinfolk-neon.vercel.app`
- **Authorization callback URL**: `https://kinfolk-neon.vercel.app/api/auth/callback/github`
- **Enable Device Flow**: leave OFF

Sign-in happens on the app origin now, so the callback is Auth.js's own
`/api/auth/callback/github` on the deployment hostname -- the same fixed path as local
setup, on a different origin. If the OAuth app still points anywhere else, sign-in fails
with `redirect_uri_mismatch` at the point the user comes back from GitHub.

Device Flow stays off because it exists for inputless devices (a CLI, a TV) that cannot host
a browser redirect. Kinfolk is a web app with a callback, so enabling it would add a second
way to mint tokens that nothing here uses.

Two apps rather than two callbacks on one, so revoking local access cannot lock out production.

### 4. GitHub repository secrets and variables

For the workflows in [`.github/workflows/`](../.github/workflows):

| Kind | Name | Purpose |
| --- | --- | --- |
| Secret | `DATABASE_URL` | Migrations only. Use the **direct** host: drizzle-kit needs TCP. |
| Variable | `PRODUCTION_URL` | The deployed origin, with no trailing slash. **Required**: the endpoint checks skip until it is set. |

`PRODUCTION_URL` is required rather than defaulted, and that is a correction rather than caution. The first version of `deploy.yml` fell back to a guessed `https://kinfolk.vercel.app`, and its first real run reported **three green checks from an unrelated site** already answering on that hostname -- no `_next/static` anywhere in its markup, so not even a Next build. A check that silently probes somebody else's server is worse than no check, because it reports success for a deployment that does not exist. Both workflows now skip with `if: vars.PRODUCTION_URL != ''` instead.

Create a **`production` GitHub Environment** and scope `DATABASE_URL` to it. That way only the migrate job can read it, and a required reviewer can be added later without touching the workflow.

CI needs no secrets at all. `lib/db/client.ts` is built to import cleanly with no `DATABASE_URL`, and nothing queries at build time, so the build step passes a throwaway `AUTH_SECRET` and no database.

## What runs when

| Workflow | Trigger | Does |
| --- | --- | --- |
| [`ci.yml`](../.github/workflows/ci.yml) | every PR and push to `main` | lint, typecheck, the production build, and a guard against dead Tailwind utilities in the built CSS |
| [`deploy.yml`](../.github/workflows/deploy.yml) | push to `main` touching app code | applies committed migrations to Neon, waits, then probes the live endpoints |
| [`health.yml`](../.github/workflows/health.yml) | daily at 02:31 UTC | probes production, to catch a suspended Neon branch or a rotated secret |

Vercel's own Git integration builds and promotes on push. `deploy.yml` deliberately does **not** duplicate that; it does the two things Vercel cannot: get the schema ahead of the code that depends on it, and assert afterwards that the deployment actually answers.

### Migrations

`deploy.yml` runs `pnpm db:migrate`, never `db:push`. Push diffs the live schema and applies whatever it infers, which is right for a scratch branch and dangerous in production -- it can drop a column it believes is redundant. `migrate` runs the committed SQL in `drizzle/` in order and nothing else.

Three migrations are now committed. The live database is at `3/3`; the baseline procedure
below is historical and must only be used for a fresh database that predates migration
tracking.

The schema was originally created with `db:push`, so `0000` is a BASELINE: a full
`CREATE TABLE` script describing tables that already exist. Running it against the live
database fails on its first statement, because drizzle generates bare `CREATE TABLE`
without `IF NOT EXISTS`. It has to be recorded as applied instead.

Drizzle tracks applied migrations in `drizzle.__drizzle_migrations`, keyed by the sha256 of
each file's contents, and applies any migration whose journal timestamp is newer than the
newest recorded row. So seeding one row for `0000` makes `migrate` skip it and run `0001`
onwards normally.

Do this ONCE, from a laptop with the direct (non-pooler) host in `DATABASE_URL`:

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
```

```sql
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
```

Then insert the baseline's hash and its `when` value from
[drizzle/meta/\_journal.json](../drizzle/meta/_journal.json), where the hash is the sha256
of `drizzle/0000_*.sql` exactly as committed. Until that row exists, leave the production
`DATABASE_URL` secret unset: `deploy.yml` skips migrations with a warning when it is absent,
which is safer than a red deploy or a half-applied schema.

`0001` drops `NOT NULL` from `users.email`, which is a real fix rather than housekeeping.
GitHub does not always return an email -- Auth.js falls back to `GET /user/emails`, but that
is skipped if the request fails -- and the adapter's insert was then rejected by Postgres,
bouncing the visitor to `/api/auth/error?error=Configuration`. A message about server
configuration for what is really a missing field on somebody's GitHub account.

Migration `0002` adds database checks that prevent `owner` from being granted through
`tree_members` or `tree_invites`; ownership remains represented by `trees.owner_id`.

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

Each status code was verified against a running server rather than assumed:

| Path | Expect | Why this one |
| --- | --- | --- |
| `/` | 200 | Renders with no session and no database read. |
| `/signin` | 200 | If this is down nobody can get in at all. |
| `/api/auth/providers` | 200 | The real canary: 200 only when `AUTH_SECRET` **and** the GitHub provider are both configured, so a rotated secret surfaces here rather than as a user who cannot sign in. |
| `/tree` | 307 | Redirects to `/signin` when signed out, rather than erroring. |
| `/demo` | 307 | Sets its cookie and forwards. Reads no session and no database, so it separates "the app is broken" from "Neon is asleep". |

Every probe retries three times. A cold serverless function or a waking Neon branch can exceed the first timeout, and a single `000` would be a false alarm.

## After the first deploy

1. Sign in with GitHub on the deployed site. Provisioning ([`lib/tree/provision.ts`](../lib/tree/provision.ts)) fires in the Auth.js `createUser` event, so the first sign-in is also the test that it works: you should land on `/tree` with one card, yourself.
2. Confirm `/api/auth/providers` lists `github` with the production callback.
3. Run the health workflow by hand (`workflow_dispatch`) rather than waiting for the schedule.

## Gotchas

- **The session cookie is `kinfolk.session-token`, not the Auth.js default.** Cookies are scoped by host and never by port, so on `localhost` every Auth.js app shares one name -- a neighbour running the JWT strategy leaves a 627-character JWE where this app's 36-character uuid belongs, and `/tree` throws `AdapterError` for a visitor who never signed in. This matters less on a real domain but the rename stays.
- **`experimental.useTypeScriptCli: true` in `next.config.mjs` is load-bearing.** TypeScript 7 removed the compiler API Next reaches for directly. Remove the flag once Next supports TS 7 natively; until then the build fails without it.
- **pnpm 11 reads build-script approval from `pnpm-workspace.yaml`** (`allowBuilds:`), not `package.json`. A `pnpm.onlyBuiltDependencies` field is silently ignored and installs fail with `ERR_PNPM_IGNORED_BUILDS`.
- **`drizzle-kit push` on Windows prints `Changes applied` and then crashes** with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and exit code 3221226505. That is libuv tearing down the websocket after the work committed, not a failed migration. Confirm against `information_schema` rather than trusting the exit code.
