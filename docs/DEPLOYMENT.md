# Deploying Kinfolk

Local setup is [SETUP.md](SETUP.md). This is the production path.

## Why Vercel and not GitHub Pages

`pnpm build` reports four DYNAMIC routes:

```
┌ ○ /                          static
├ ƒ /api/auth/[...nextauth]    server-rendered on demand
├ ƒ /demo                      server-rendered on demand
├ ƒ /signin                    server-rendered on demand
└ ƒ /tree                      server-rendered on demand
```

Every `ƒ` needs a server at request time, and none of them can be exported:

- `/tree` reads Neon per request and resolves an Auth.js **database** session.
- `/demo` is a route handler that sets an httpOnly cookie. A static file cannot set one, which is why it is a route rather than a page.
- Every write is a server action (`lib/tree/edit-actions.ts`), authorised server-side in `lib/tree/authz.ts`.

GitHub Pages serves static files only, so it would host the landing page and nothing that makes this an app. `prod/kalchar` reached the same conclusion and left its own Pages workflow dormant with a note recording why.

## Two things are deployed, to two places

| What | Where | URL |
| --- | --- | --- |
| The landing page (`docs/index.html`) | GitHub Pages | `https://sagargupta.online/kinfolk/` |
| The app itself | Vercel | the origin Vercel assigns |

Pages already resolves this repository to the domain subpath -- `gh api repos/Sagargupta16/kinfolk/pages` reports `html_url: http://sagargupta.online/kinfolk/`, and the existing certificate covers `sagargupta.online`. So the front door is at the URL you want with no DNS work at all.

The page publishes from `docs/`, which is also what lets this repository stay **private** while the page is public: Pages serves only that directory, never the source.

The two app buttons on that page are hidden until `APP_URL` is set in `docs/index.html`. That is deliberate -- a link to a deployment that does not exist is worse than no link, because it reports the project as live and then 404s. `pages.yml` also fails the build if `APP_URL` is set to something that is not an `https://` URL, so a placeholder cannot ship.

## The URL: sagargupta.online/kinfolk

The app is mounted at `/kinfolk` so it sits beside the other projects on that domain, matching `sagargupta.online/portfolio-react/`. `basePath` and `assetPrefix` in [`next.config.mjs`](../next.config.mjs) read `NEXT_PUBLIC_BASE_PATH`, so the same build serves the root locally and `/kinfolk` in production -- hardcoding it would make every local URL wrong.

**The obstacle, measured rather than assumed.** `sagargupta.online` resolves to GitHub Pages (`185.199.108-111.153`, GoDaddy nameservers) and Pages serves static files only, so it cannot proxy `/kinfolk` to a server. The obvious workaround -- let Vercel own the apex and proxy everything else back to Pages -- does not work either: because `sagargupta16.github.io` has a `CNAME` file, it **301-redirects to the custom domain unconditionally**, verified including with a `Host` header override. Proxying back would be an infinite loop.

So serving Kinfolk at `sagargupta.online/kinfolk` requires the **apex to move to Vercel**:

1. Deploy Kinfolk to Vercel and confirm it works on its assigned origin first.
2. Create a Vercel project for the apex site (`brand/sagargupta16.github.io`) and add `sagargupta.online` as its domain.
3. Add rewrites there so existing paths keep working, `/kinfolk/*` reaches this project, and `/portfolio-react/*` still reaches the portfolio.
4. Remove the `CNAME` file from the Pages repo, or Pages will keep claiming the domain.
5. Point the GoDaddy DNS at Vercel (`A 76.76.21.21`, or the CNAME Vercel shows).

**Until that migration happens**, deploy with `NEXT_PUBLIC_BASE_PATH` unset. The app then serves at the root of its Vercel origin and everything works; only the pretty URL is missing. Setting the base path without the rewrite in front of it produces a site whose every asset 404s.

## One-time setup

### 1. Import the repo into Vercel

At [vercel.com/new](https://vercel.com/new), import `Sagargupta16/kinfolk`. It detects Next.js; [`vercel.json`](../vercel.json) pins the rest.

The region is pinned to **`sin1`** (Singapore) to sit beside the Neon project, which is in `aws-ap-southeast-1`. Left on a US default, every query would cross an ocean and back -- and `/tree` issues several per render.

### 2. Environment variables, in Vercel

Set these for **Production** and **Preview** (Settings -> Environment Variables):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon connection string. The **pooler** host is correct here -- the app talks over the serverless HTTP driver, and a serverless function opens a connection per invocation. |
| `AUTH_SECRET` | A fresh 32+ byte random string. **Not** the one from `.env.local`: a local secret that leaks should not be able to forge production sessions. Generate with `node -e "console.log(require('crypto').randomBytes(33).toString('base64'))"`. |
| `AUTH_URL` | The deployed origin Vercel gives you, with no trailing slash. Auth.js builds its callback URL from this, so a wrong value fails sign-in with `redirect_uri_mismatch`. Do NOT assume `kinfolk.vercel.app`: an unrelated project already answers there. |
| `AUTH_GITHUB_ID` | From the production OAuth app below. |
| `AUTH_GITHUB_SECRET` | Same. |
| `NEXT_PUBLIC_BASE_PATH` | `/kinfolk` ONLY once the apex is on Vercel and rewriting. Leave UNSET until then: a base path with nothing routing to it serves a page whose every asset 404s. It also scopes the session and demo cookies to the mount, which is what stops them being sent to every other project on the shared domain. |

`db:push` is the one thing that needs the **direct** (non-pooler) host, because drizzle-kit opens a plain TCP connection. That runs from a laptop, not from Vercel.

### 3. A SEPARATE GitHub OAuth app for production

The development app's callback points at `http://localhost:3007`, so it cannot serve the deployed site. Create a second one at [github.com/settings/developers](https://github.com/settings/developers):

- **Homepage URL**: the origin Vercel assigned
- **Authorization callback URL**: that origin plus `/api/auth/callback/github`

The callback path is fixed by Auth.js. Do not shorten it.

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
| [`ci.yml`](../.github/workflows/ci.yml) | every PR and push to `main` | gitleaks over full history, then lint, typecheck, 279 tests, build, and a guard against dead Tailwind utilities in the built CSS |
| [`deploy.yml`](../.github/workflows/deploy.yml) | push to `main` touching app code | applies committed migrations to Neon, waits, then probes the live endpoints |
| [`health.yml`](../.github/workflows/health.yml) | daily at 02:31 UTC | probes production, to catch a suspended Neon branch or a rotated secret |
| [`pages.yml`](../.github/workflows/pages.yml) | push to `main` touching `docs/**` | publishes the landing page to GitHub Pages at `sagargupta.online/kinfolk/` |

Vercel's own Git integration builds and promotes on push. `deploy.yml` deliberately does **not** duplicate that; it does the two things Vercel cannot: get the schema ahead of the code that depends on it, and assert afterwards that the deployment actually answers.

### Migrations

`deploy.yml` runs `pnpm db:migrate`, never `db:push`. Push diffs the live schema and applies whatever it infers, which is right for a scratch branch and dangerous in production -- it can drop a column it believes is redundant. `migrate` runs the committed SQL in `drizzle/` in order and nothing else.

The schema was created with `db:push` during development, so `drizzle/` holds no SQL yet and the step skips with a note. **Before the first production schema change**, run:

```bash
pnpm db:generate
```

and commit the generated file.

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
