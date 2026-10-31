---
paths:
  - "auth.ts"
  - "app/api/auth/**"
  - "app/api/oauth/**"
  - "app/demo/route.ts"
  - "app/**/page.tsx"
  - "lib/tree/oauth-*.ts"
  - "lib/tree/provision.ts"
  - "lib/tree/bearer*.ts"
  - "lib/tree/session-lifetime.ts"
  - "lib/tree/request-user.ts"
  - "lib/tree/cors.ts"
  - "lib/tree/redirect-allow.ts"
  - "frontend/src/auth.ts"
  - "frontend/src/api.ts"
  - "frontend/src/screens/CallbackScreen.tsx"
  - "frontend/vite.config.ts"
  - "next.config.mjs"
  - "vercel.json"
  - ".github/workflows/pages.yml"
  - "tests/oauth.test.ts"
---

# Sessions, OAuth and hosting

Moved verbatim from `CLAUDE.md` on 2026-10-31. Loads when a file matching `paths:` is read or edited.

## Gotchas

- **`basePath` rewrites `<Link>`, assets and `redirect()`, but NOT `NextResponse.redirect(new URL(...))`.** That builds an absolute URL from the request origin and Next leaves it verbatim, so under a `/kinfolk` mount `app/demo/route.ts` sent visitors to `/tree` -- which 404s. The shared demo link was broken on the deployed site and fine everywhere else, which is the worst way for it to break. The handler applied `NEXT_PUBLIC_BASE_PATH` by hand and was verified end to end (`/kinfolk/demo` -> 307 -> `/kinfolk/tree` 200). Historical now: the mount-path support was removed with the Vercel app on its own origin, so the handler redirects to plain `/tree` -- but the trap is Next's, and it is waiting if a mount ever returns.
- **On a shared domain a cookie must be scoped by PATH, not just named.** The SPA sits at `sagargupta.online/kinfolk` beside other projects on the same host, and cookies are scoped by host and path only -- never by port, never by project. Namespacing the session cookie's NAME stops this app reading a neighbour's; scoping its `path` to the mount stopped a neighbour reading a live session token of ours. Partly historical: with the mount-path support removed and the Vercel app on its own origin, the session cookie's path is back to `/`. The namespaced name stays, and `secure` is still derived from `NODE_ENV` rather than hardcoded `false` -- which was correct for `http://localhost` and wrong the moment it deployed.
- **Only the SPA carries a mount path now.** Pages builds the Vite SPA with `GITHUB_PAGES=true`, so its asset base is `/kinfolk/`, and copies `index.html` to `404.html` for deep links. Vercel stays at its own origin, and the Next app no longer reads a base path at all -- the `NEXT_PUBLIC_BASE_PATH` support was removed in the 0.2.0 rework. Pages calls Vercel through `VITE_API_BASE_URL`; it does not proxy the Next app and needs no apex migration.
- **The session cookie is `kinfolk.session-token`, and the rename was a bug fix.** Auth.js defaults to `authjs.session-token`, and cookies are scoped by HOST, never by port -- so every Auth.js app on `localhost` reads and writes the same name. With `strategy: "database"` the stored token is a `crypto.randomUUID()` (see `@auth/core` `lib/init.js:77`), so a neighbour app running the JWT strategy leaves a 627-character JWE where a 36-character uuid belongs, and `/tree` throws `AdapterError` for a visitor who never signed in. The tell is a `session_token` param starting `eyJ` whose decoded header is `{"alg":"dir","enc":"A256CBC-HS512"}` -- that is a JWE, which the database strategy never mints, so the cookie cannot be ours. Only the session cookie is namespaced; @auth/core merges `cookies` over its defaults, so callback/csrf/pkce keep theirs.
- **Provisioning is retried on every successful sign-in, never derived from a page render.** [lib/tree/provision.ts](lib/tree/provision.ts) gives a user one starter graph and one claimed self (`verification: "self_confirmed"`, `sex` left `unknown`), then repairs tree-without-self and self-without-root partial states after transient failures. `people_claimed_user_idx` is the concurrency invariant: the insert uses `ON CONFLICT DO NOTHING`, selects the winner, and sets a root only while it is null. Auth.js calls it from `createUser` for the first attempt and `signIn` for repair; the SPA calls it on every OAuth completion. It swallows genuine failures so a convenience never costs a valid session, and the next sign-in retries. Never derive `sex` from the display name: it is stored, so a guess outlives the render that made it.
- **SPA sign-in matches a returning user by GitHub id, and by email only to repair.** Both flows store GitHub's numeric id in `accounts`, so an email fallback adds nothing for real accounts; what it did add, until 0.8.0, was a takeover: a new GitHub identity whose verified address matched an existing user was linked to that user. Now `accountlessUser()` reuses an email match only when that user has NO GitHub account (a first sign-in that failed after writing the user row) and otherwise throws `AccountConflict`, a 409 -- the case Auth.js refuses with `OAuthAccountNotLinked`. `linkAccount` inserts with ON CONFLICT DO NOTHING and returns the owner, so two first sign-ins racing settle on one user, and the loser's empty user row is deleted.
- **Pages call `sessionOrNull()`, never `auth()` directly.** Sessions live in the database, so with no `DATABASE_URL` there is nothing to look one up in and Auth.js logs `MissingSecret` on every render. Reading the demo tree needs no auth, so the guard belongs in one place.
