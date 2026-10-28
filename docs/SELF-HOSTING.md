# Run your own Kinfolk

Your family records belong on infrastructure you control. This page deploys your own copy of
the Next.js app (the API plus the full server-rendered UI) to your Vercel account, with a
fresh Neon Postgres database that nobody else can read.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FSagargupta16%2Fkinfolk&project-name=kinfolk&repository-name=kinfolk&env=AUTH_SECRET%2CAUTH_GITHUB_ID%2CAUTH_GITHUB_SECRET&envDescription=A%20random%20AUTH_SECRET%20and%20a%20GitHub%20OAuth%20app.%20The%20Neon%20integration%20supplies%20DATABASE_URL.&envLink=https%3A%2F%2Fgithub.com%2FSagargupta16%2Fkinfolk%2Fblob%2Fmain%2Fdocs%2FSELF-HOSTING.md&demo-title=Kinfolk&demo-description=Collaborative%20family%20graph%3A%20each%20relative%20keeps%20their%20own%20tree%2C%20consent%20links%20join%20them.&demo-url=https%3A%2F%2Fkinfolk-neon.vercel.app%2Fdemo&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D)

The button clones this repository into your GitHub account, creates a Vercel project, and
provisions a Neon database through the Vercel Marketplace integration.

## What the button asks for

| Variable | Where it comes from |
| --- | --- |
| `DATABASE_URL` | Set by the Neon integration. Nothing to type. |
| `AUTH_SECRET` | Any random 32+ byte string: `openssl rand -base64 33` |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | A GitHub OAuth app, created below |

Create the OAuth app at **GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth
App**. Use your Vercel URL (for example `https://kinfolk-yourname.vercel.app`) as the
homepage, and `https://kinfolk-yourname.vercel.app/api/auth/callback/github` as the
authorization callback URL. If you do not know the URL yet, enter placeholders, finish the
deploy, then edit the OAuth app and the two variables under **Vercel -> Project -> Settings
-> Environment Variables**, and redeploy.

## Create the schema once

The new database is empty. Apply the committed migrations from a clone of your copy, using
the **unpooled** connection string (Vercel -> Project -> Storage -> your Neon database ->
`DATABASE_URL_UNPOOLED`), because `drizzle-kit` opens a direct TCP connection:

```bash
pnpm install
DATABASE_URL="<DATABASE_URL_UNPOOLED value>" pnpm db:migrate
```

On PowerShell, set the variable first with `$env:DATABASE_URL = "<value>"`, then run
`pnpm db:migrate`.

Never use `pnpm db:push` against a database that holds real records: it diffs the live
schema and may drop a column it considers redundant. `db:migrate` only applies the SQL files
in `drizzle/`.

## Check it

```bash
curl https://kinfolk-yourname.vercel.app/api/health
```

It returns `200` with `"status": "ready"` only when the database answers, every required
table and column exists, and the three auth variables are set. Otherwise it returns `503`
with `"status": "degraded"`, and the `database` and `auth` fields say which half is
`unavailable`, without exposing SQL or credentials. Then open `/demo` for the sample tree and
`/signin` to create your own.

## What you get, and what you do not

- The full UI at your Vercel URL, served by Next.js: the canvas, People directory, editing,
  sharing, invitations and record links. Sign-in uses an httpOnly session cookie.
- Your own data. Records in your copy never reach the public Kinfolk instance, and record
  links only join trees inside the same database.
- **Not** the GitHub Pages SPA. That build talks to an API allow-listed for
  `sagargupta.online` in [lib/tree/cors.ts](../lib/tree/cors.ts); a copy on Vercel does not
  need it, because the server-rendered UI is same-origin.
- `vercel.json` pins functions to the `sin1` (Singapore) region. Change `regions` to the one
  closest to your Neon project.

## GitHub Actions in your copy

The clone brings this repository's workflows with it. **CI** works as is. The other three
are wired to the original deployment:

- **Deploy** applies new migrations and verifies the serving commit on every push to `main`
  that touches the app. It refuses to run against a database with no migration history, so
  do the one manual `db:migrate` above first. Then create a `production` environment under
  **Settings -> Environments** holding a `DATABASE_URL` secret (the unpooled URL), and add a
  `PRODUCTION_URL` repository variable (your Vercel URL) under **Settings -> Secrets and
  variables -> Actions -> Variables**. From then on schema changes ship themselves.
- **Pages** publishes the GitHub Pages SPA, and **Production health** probes that SPA as well
  as the API once a day. Disable both under **Actions -> (workflow) -> ... -> Disable
  workflow** unless you also host the SPA.

Updating later is a normal Git flow: pull this repository's `main` into your copy, run
`pnpm db:migrate` with the unpooled URL if `drizzle/` changed, and push.
