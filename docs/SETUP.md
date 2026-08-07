# Setting Kinfolk up locally

Four values go in `.env.local`. Nothing else is needed -- no Docker, no local
Postgres, no accounts beyond Neon and GitHub.

```bash
cp .env.example .env.local
```

Then replace each `REPLACE_ME` using the steps below. Do all three sections
before starting the dev server: the app boots without them, but `/tree` can only
show sample data until the database is reachable, and sign-in needs all four.

---

## 1. `DATABASE_URL` -- Neon Postgres

1. Go to <https://console.neon.tech> and sign in.
2. **Create project**. Name it `kinfolk`. Pick the region closest to you
   (`aws-ap-southeast-1` if you are in India). Leave the Postgres version at the
   default.
3. On the project page, find the **Connection string** panel.
4. **Turn OFF the "Connection pooling" toggle.** This is the one step that is
   easy to get wrong: the pooled host has `-pooler` in it, and while the app
   works fine with it, `pnpm db:push` opens a plain TCP connection that the
   pooler endpoint will not serve. You want the host WITHOUT `-pooler`.
5. Copy the string. Its shape, written with the parts spelled out so this file does
   not itself look like a leaked credential to a secret scanner:

   ```
   postgresql:// <role> : <password> @ <host>.neon.tech / neondb ?sslmode=require
   ```

   Neon's role is usually `neondb_owner`, the password starts `npg_`, and the host
   starts `ep-`. Paste the real string, with no spaces, as `DATABASE_URL` in
   `.env.local`.

Then create the tables:

```bash
pnpm db:push
```

On Windows this prints `[✓] Changes applied` and then crashes with
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and exit code
3221226505. **That is a libuv teardown bug, not a failed migration** -- the
schema is already committed by the time it happens. Confirm in the Neon
console, where the project should show 12 tables, or with a query against
`information_schema.tables`. The live smoke script that used to assert this
end to end was removed in the 0.2.0 rework.

## 2. `AUTH_SECRET` -- generated locally

Not fetched from anywhere. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(33).toString('base64'))"
```

Paste the output as `AUTH_SECRET`. Any 32+ byte random string works; this is
what encrypts Auth.js's own cookies.

Leave `AUTH_URL` as `http://localhost:3007`. The port comes from
`.claude/launch.json` at the workspace root, and it has to match section 3.

## 3. `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` -- GitHub OAuth app

GitHub has **no REST API for OAuth Apps** (they are a different resource from
GitHub Apps), so `gh` cannot do this. It has to be the browser.

1. Go to <https://github.com/settings/developers>.
2. **OAuth Apps** tab -> **New OAuth App**.
3. Fill in exactly:
   - **Application name**: `Kinfolk (local)`
   - **Homepage URL**: `http://localhost:3007`
   - **Authorization callback URL**:
     `http://localhost:3007/api/auth/callback/github`
4. **Register application**.
5. Copy the **Client ID** into `AUTH_GITHUB_ID`.
6. **Generate a new client secret**, copy it into `AUTH_GITHUB_SECRET`. It is
   shown once -- if you navigate away before copying, generate another.

The callback path is fixed by Auth.js. Do not shorten it to `/callback` or point
it at `/signin`; a mismatch fails with `redirect_uri_mismatch` at the point the
user comes back from GitHub, which is a confusing place to debug. Port 3007, not
3000, for the same reason.

---

## Run it

```bash
pnpm dev --port 3007
```

- <http://localhost:3007> -- landing page
- <http://localhost:3007/tree> -- your graph. Signing in for the first time
  creates a graph containing one node, you.
- The **See a sample graph** button needs none of the above and is the fastest
  way to check the canvas renders.

## Troubleshooting

**`AdapterError` on `/tree`, with a long `session_token` in the message.**
Another Auth.js app on `localhost` wrote a cookie under the shared default name
`authjs.session-token`, and Kinfolk read it. Cookies are scoped by host, never by
port, so anything else you run on localhost can collide. Kinfolk now uses
`kinfolk.session-token` for exactly this reason; if you see the old error, clear
cookies for `localhost` once. Telltale sign: the token starts with `eyJ` and is
hundreds of characters long, where a database session token is a 36-character
uuid.

**`DATABASE_URL is not set` when a query runs.** `.env.local` is missing or the
dev server was started before it existed. Restart the server -- Next reads env
files at boot.

**`pnpm build` succeeds with no `.env.local`.** Intended. `lib/db/client.ts`
stays importable without a database so a fresh clone can build; only running a
query fails.
