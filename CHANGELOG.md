# Changelog

Notable changes to Kinfolk. Newest first.

Dates are absolute. Each entry says what changed and, where it matters, what was
measured to know it was right -- several of the fixes below were invisible to a file
read and only showed up on a live canvas.

## 0.2.0 -- 2026-08-07 (leaner, redrawn, and staying on the ledger-sync shape)

Three things happened in one release: the working surface got smaller (tests and
hardening out), the graph was redrawn to the conventions relatives already know,
and the two-frontend architecture was CONFIRMED as the requirement -- a
single-app consolidation was built, verified, and then reversed the same day
when the owner confirmed the app must live at `sagargupta.online/kinfolk` the
way ledger-sync does. The reversal was surgical: everything the SPA needs
(`frontend/`, the OAuth bridge, the bearer JSON API, `pages.yml`) is back
byte-for-byte from history, and the round trip left two genuine improvements
behind -- `app/icon.svg`, and a Vite dev proxy the SPA had always been missing.

### Removed

- **The unit suite (26 files, 328 tests), vitest, and both live smoke scripts**,
  deliberately, to keep the working surface small while the product is reshaped.
  `scripts/check-migrations.mts` stays because the deploy workflow runs it, and
  graph maths stays React-free and database-free in `lib/tree/` so a suite can
  return later without restructuring.
- **The hardening layers**: the security-header/CSP block in `next.config.mjs`, the
  gitleaks CI job, and the people-per-hour write budget (`lib/tree/rate-limit.ts`).
  Authorization is not hardening and stays: every write still starts in
  `lib/tree/authz.ts`, contact visibility is still filtered server-side, and the
  SPA's whole data path (bearer, CORS allow-list, HMAC OAuth state, redirect
  allow-list) is load-bearing and untouched.
- **`NEXT_PUBLIC_BASE_PATH` mount support in the Next app.** The Vercel deployment
  owns its origin, so the session and demo cookies scope to `/` and no route
  applies a base path by hand. The `/kinfolk` mount belongs to the SPA alone,
  through Vite's own `base` -- which is how it was deployed in practice anyway.

### The graph, redrawn

How partners connect and how children descend were rebuilt to the convention
every hand-drawn pedigree uses, after checking it against published charting
guides: a couple is joined by ONE horizontal marriage line at mid-card height,
and their children descend from a single stem at its midpoint. Before this,
both partners dropped separate lines to a dot floating in the generation gap --
structurally correct and visually nothing a relative has ever seen on a family
chart.

- `placeUnionJunctions()` (layout.ts, replacing `centreUnionDots()`) puts a
  couple's junction ON the line: x at the couple's midpoint, y at their averaged
  mid-card height. A single-parent union stays in the gap, centred under its one
  parent, so the drop is a straight vertical.
- `partnerPath()` (paths.ts) draws the line card-centre to card-centre; the run
  behind each opaque card is hidden, so the visible line spans exactly the
  gutter. A cross-generation couple gets rounded corners at each end instead of
  a line through somebody's row.
- The junction bead wears the line's own colour and the genogram's status
  language: solid for an intact partnership, hollow for widowed, and a double
  slash THROUGH the line for separated or divorced.
- Measured on the live canvas, not eyeballed -- in the Next app at two detail
  levels AND through the SPA's serialise/parse round trip: 68 of 68 partner
  edges are flat marriage lines, 34 of 34 beads sit on their line (worst offset
  0px), 82 of 82 child drops leave the bead's centre, 0 NaN paths, and the
  orbit arrangement is untouched.

Adding a person was reworked around the same research (Gramps' per-card add is
the reference): the role picker now leads with WHERE the person will land
(parents above, partner and siblings beside, children below), says "both
parents recorded" instead of offering a button that ends in a refusal, and
shows counts for everything else. The fast path is role, name, Enter --
surname, birth year, gender and living status sit behind a More-details
disclosure and submit their defaults untouched. Adding a partner now asks how
the couple is recorded (married / partners / not known), because the canvas
draws that fact; the status applies only when the add CREATES the union, never
to one that already exists.

The picker and the partnership status were verified by compile, typecheck and
build; the write path could not be exercised live, because the demo canvas
renders no editor and minting a real session to test with is forbidden.

### Fixed

- **The SPA's sign-in button did nothing in local dev, ever.** `startSignIn()`
  built `new URL("/api/oauth/authorize")` from a relative string with no base,
  which throws before any request is made -- invisible in production, where
  `VITE_API_BASE_URL` makes the string absolute. The URL is now anchored on the
  page's own origin, and the base argument is ignored when the string is
  absolute, so production is unchanged.
- **The Vite dev server had no `/api` proxy**, despite `src/api.ts` documenting
  one ("Empty in dev, where the Vite proxy serves /api from the same origin").
  Every SPA fetch in dev got index.html back with a 200, which renders as
  "Could not reach the server" and reads as an API failure. The proxy now hands
  `/api` to the Next app on port 3007.
- A childless couple is joined by one direct line instead of a union dot pointing
  at nobody (#29, shipped 2026-08-07 and previously missing from this log).

### Added

- `app/icon.svg` -- the favicon the SPA had and the Next app never did. Found as
  the only console error on a clean load.

### Dependencies

Everything current across both workspace packages, on the newest lines: Next
16.3, Motion 13 (major, both packages together -- the shared components require
the pin to match), @vitejs/plugin-react 6, lucide-react 1.29, Biome 2.5.7 (config
migrated), tsx 4.23.9, plus type packages. `next-auth` stays on `5.0.0-beta.32`
deliberately: the v5 beta IS the newest line, and the `latest` npm tag still
points at v4.

### Verified

- Biome, both `tsc` projects, the Next production build and the Vite Pages build
  all pass; the full route table is back (`/api/tree`, `/api/action/[name]`,
  `/api/share`, the three `/api/oauth/*` routes, Auth.js, `/tree`, `/signin`,
  `/demo`).
- Live in a browser: the SPA landing renders at `localhost:5173`, "See the
  sample tree" renders **151 nodes and 150 edges through the JSON API** with a
  clean console, and "Sign in with GitHub" completes the authorize leg --
  GitHub's login page reached with the `redirect_uri` accepted and the same
  state shape observed live on `sagargupta.online/ledger-sync` moments earlier.
  The final keystroke of a sign-in is deliberately not automated.
- The Next app's demo flow re-verified after the dependency bumps: same node and
  edge counts, no console errors.

## 2026-08-07 (security and deployment audit)

### Fixed

- Invite roles are now parsed from an allow list, so a forged form cannot grant
  `owner`. Postgres enforces the same rule on both pending invites and memberships.
- GitHub usernames are normalized case-insensitively before invites are stored or
  claimed.
- Attaching an existing child now refuses an edge that would make somebody their own
  ancestor.
- The live database had schema changes but no trustworthy migration history. Migration
  `0000` was safely baselined, `0001` made Auth.js email nullable, and `0002` added the
  role constraints. A preflight checker now verifies that live history is an exact
  prefix of committed migrations before deploys can write.
- The Pages SPA now has a script CSP with its no-flash theme bootstrap in an external
  file, plus a favicon so a clean page load produces no console errors.

### Deployment

- CI now typechecks and builds both the Next and Vite frontends, and Biome covers the
  Vite source and public scripts.
- Deploys check migration history before and after `drizzle-kit migrate`.
- Deployment docs now describe the actual split: `frontend/` on Pages, with the API,
  OAuth exchange and server-rendered fallback on Vercel. `DATABASE_URL` is a manual
  encrypted variable pointing at the existing Neon project, not a native integration.

### Verified

- 328 unit tests across 26 files, Biome, both TypeScript projects, and both production
  builds pass.
- `pnpm audit --prod` reports no vulnerabilities.
- All 3 committed migrations are applied, and both live Neon smoke suites pass and
  clean up.
- Production probes return the expected 200/307 statuses. The Pages SPA was checked at
  desktop and mobile sizes in light and dark themes with zero console errors.

## 2026-08-06 (production hardening)

### Security

- **5 dependency vulnerabilities closed**, 3 of them HIGH: four in postcss, one in
  sharp. Both nested under `next` rather than imported here, so the fix is a pnpm
  override that stops the old copies existing. postcss runs only at build time and
  sharp is shipped-but-unused, but "we do not call it today" is a fact about this
  week's code, not a property of the dependency.
- **Security headers**, where only HSTS was set. Added `nosniff`, a referrer policy,
  a permissions policy, `X-Frame-Options` and a Content Security Policy with
  `default-src 'self'`, a `connect-src` naming the only two hosts this app may reach,
  `frame-ancestors 'none'`, `object-src 'none'` and `base-uri 'self'`.
- **A write budget**: 500 people per hour per owner, counted in Postgres. The API
  previously accepted unbounded authenticated writes, so one token could create rows
  until Neon stopped it.

### Two CSP attempts that broke the app, both caught in a browser

Worth recording because the header looked correct in both cases.

`'strict-dynamic'` disables host-based allowlisting by design, so `'self'` stopped
applying and every `/_next/static/chunks/*.js` was blocked. The shell rendered, the
theme script ran, and the canvas came up with **zero nodes** -- which reads as a data
bug rather than a policy one. It cannot work here regardless: it bootstraps from a
nonce, and these pages are cached rather than rendered per request.

Then a sha256 hash of the theme script alongside `'unsafe-inline'`. The browser said
it outright: a hash makes `'unsafe-inline'` ignored, so adding the hash **blocked
every other inline script** instead of narrowing anything. Those others are React's
streaming payload, emitted per render and unhashable, and Next's own inline bootstrap
needs the allowance anyway -- so externalising our own script would not have helped.

`script-src` therefore keeps `'unsafe-inline'`, and the comment says so plainly
rather than implying the policy is stricter than it is.

### Verified

Live in production: all six headers present, all five endpoints answering, the canvas
rendering 151 nodes and 150 edges with **zero console errors**. The rate limit was
proven against the real database -- at the limit refused, a different user unaffected,
5-left/want-5 allowed while want-6 refused. Mobile re-checked at the `max-width: 640px`
breakpoint: detail sheet at 55% of viewport height, no horizontal overflow, and no
contact value anywhere in the panel.

### Not fixed, and why

A static export is **impossible** without deleting the auth flow, which was measured
rather than assumed: `output: "export"` fails on `/demo`, and `/api/auth/*` plus the
server-side `signIn()` redirect cannot exist in a static file. Hosting the UI on Pages
would mean rebuilding sign-in as a client-side OAuth dance and putting a bearer token
in `localStorage`, which is less secure than what exists now.

## 2026-08-06 (one environment, and no builds for docs)

### Changed

- **Preview deployments are off.** There is one environment now, production. A pull request
  was producing its own deployment alongside the production one, so the dashboard listed
  three environments for a project that only ever serves from one.
- **A commit touching only documentation no longer builds.** `ignoreCommand` runs
  [scripts/vercel-ignore-build.sh](scripts/vercel-ignore-build.sh), which skips when every
  changed path is under `docs/`, `drizzle/`, `.github/`, `.claude/` or is markdown.
  Measured on PR #11: one changed markdown file produced a full production-grade build and a
  preview deployment, which on a Hobby plan is the single concurrent build slot spent on a
  file the runtime never reads. It also put a "Deployment has completed" check on a pull
  request whose deployment proved nothing.

The filter is a DENY list rather than an allow list, deliberately: a new top-level directory
builds until somebody decides otherwise, because a wrongly skipped deploy is a deployment
that silently never happens. Production always builds, and so does any commit the script
cannot diff. Verified against 13 path combinations plus the real docs-only commit that
wasted a build earlier.

## 2026-08-06 (sign-in configured)

### Added

- **Sign-in is configured and the app is fully live.** `/api/auth/providers` returns 200
  and reports the GitHub provider, so the daily health check now passes all five probes
  where it previously failed that one.
- `DATABASE_URL` comes from **Vercel's native Neon integration** rather than a pasted
  string. The credential is provisioned into the project and rotated by Vercel, so it never
  passes through a terminal, a transcript or a third-party API -- strictly better than any
  copy-paste route. The integration also sets `POSTGRES_*`, `PG*` and
  `DATABASE_URL_UNPOOLED`, which are unused and harmless here.
- `AUTH_GITHUB_ID` is stored as `plain`, not `sensitive`. An OAuth client id is public by
  specification (RFC 6749 section 2.2) and appears in the authorize URL every user's browser
  visits, so encrypting it would imply a secrecy it does not have.

### Verified, not assumed

- The `callbackUrl` Auth.js reports matches the OAuth app's registered callback exactly,
  which is what rules out `redirect_uri_mismatch`.
- Clicking "Continue with GitHub" reaches GitHub's own login with PKCE (`S256`) and
  `scope=read:user user:email`. GitHub **accepted** the redirect URI rather than rejecting
  it, which is the assertion that matters.
- `/api/auth/session` returns `null` rather than an `AdapterError`, proving the Drizzle
  adapter reached Postgres. A broken connection surfaces there first.
- `pnpm db:smoke` passes all 22 live checks, including fusion across two graphs, kinship
  terms, and a private phone number never reaching a linked viewer.

The final keystroke of a sign-in is deliberately not automated: minting a real session for
a real account to test with is forbidden, so provisioning is proven by the smoke script
against the same database.

## 2026-08-06 (later)

### Fixed

- **`AUTH_URL` pointed at the SSO-gated alias**, which would have broken sign-in even once
  the secrets were added: Auth.js builds its callback from that value, so GitHub would have
  rejected the redirect. Now `https://kinfolk-neon.vercel.app`, matching the callback the
  OAuth app must register. Found by listing the project's variables rather than trusting
  what was set an hour earlier.
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) said "the origin Vercel gives you"**, which
  was fine when there was one and misleading now there are three and two are unusable. The
  exact hostname is written out in both the variable table and the OAuth app steps.
- Recorded that `DATABASE_URL` on Vercel wants the **pooler** host while `drizzle-kit push`
  wants the **direct** one. Opposite requirements, easy to conflate, and stated wrongly
  once in conversation.

### Known gap, unchanged

- Sign-in still needs four secrets only their owner may set. The daily health check fails
  on `/api/auth/providers` alone and passes its other four probes, which is the check
  working rather than a regression.

## 2026-08-06

### Deployed

- **The app is LIVE** at <https://kinfolk-neon.vercel.app>. Once the Vercel GitHub App was
  installed by hand, the same `gitSource` deployment call that had been refused four times
  succeeded and built on the first attempt -- so the 400 never named its real cause.
  Verified live: `/demo` 307s to `/tree` and the canvas renders 151 nodes, 150 edges and
  34 union junctions from sample data.
- **The landing page's two app buttons now appear**, pointing at that host. They were
  hidden while `APP_URL` was empty, because a link to a deployment that does not exist is
  worse than no link.
- `PRODUCTION_URL` is set as a repo variable, so the deploy-verify and daily health jobs
  stop skipping.

### Fixed

- **Picked the right alias out of three.** Vercel assigned
  `kinfolk-sagargupta16s-projects.vercel.app`, which sits behind SSO protection and 302s
  every request to a Vercel login -- a public visitor would meet a sign-in for an account
  they do not have, and when probed it looks exactly like a broken deployment.
  `kinfolk.vercel.app` belongs to an unrelated project. Only `kinfolk-neon` answers 200.

### Known gap

- **Sign-in is not live yet.** It needs `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`
  and `AUTH_GITHUB_SECRET` set in Vercel by their owner, plus the production callback URL
  added to the GitHub OAuth app. `/api/auth/providers` returns 500 until then, which is
  the expected shape rather than a fault. `AUTH_TRUST_HOST` and `AUTH_URL` are set, both
  being non-secret.

## 2026-08-05

### Deployed

- **The landing page is live at <https://sagargupta.online/kinfolk/>**, served by GitHub
  Pages from `docs/`. Publishing only that directory is what lets a private repository
  have a public front door.
- **A Vercel project exists for the app** (`kinfolk`, `sin1`, the same region as the Neon
  database). It is not linked to the repository yet: Vercel's GitHub App cannot see a
  private repo until it is installed from the dashboard, and that is not an API action.
  Verified rather than assumed, from three refused attempts -- personal scope, team
  scope, and a direct `gitSource` deploy, all rejected as "repository can't be found".

### Fixed

- The app builds and serves at the domain root with no `basePath` set, which is the shape
  the Vercel deployment uses. Confirmed live: `/demo` sets its cookie and forwards to
  `/tree`, which renders 151 nodes and 150 edges.

### Changed

- `shared-workflows`' reusable `node-ci.yml` gained `run-typecheck`, `tests-before-build`
  and a `build-env` secret, so this repo's CI can eventually call it instead of carrying
  its own copy. Every default preserves the old behaviour, so the five repositories
  already calling it are untouched.

## 2026-08-04

### Added

- **CI, deploy, Pages and health workflows.** CI runs a secret scan plus lint, typecheck,
  test and build. A guard greps the built CSS for dead Tailwind arbitrary-value rules,
  because nothing else catches them -- not the build, not Biome, not the browser.
- **A configurable mount path** (`NEXT_PUBLIC_BASE_PATH`), so the app can be served under
  a subpath beside other projects on one domain.

### Fixed

- **The session cookie was scoped to `/` and never `Secure`.** On a shared domain that
  sends a live session token to every other project on the host, over plain HTTP. Now
  scoped to the mount and `Secure` in production.
- **`NextResponse.redirect` is not rewritten by `basePath`.** The demo link 404'd under a
  subpath mount and was fine everywhere else, so the failure only existed in production.
- **A Pages job with its own `permissions` block dropped `contents: read`.** A job-level
  block REPLACES the workflow default rather than adding to it, and on a private repo the
  checkout then fails with "repository not found" -- which reads like a wrong URL and is
  actually a token that cannot see the repo.
- **The deploy verification probed a URL nobody had confirmed.** A guessed hostname
  belonged to an unrelated project and returned three green checks. `PRODUCTION_URL` is
  now required rather than inferred.

## 2026-08-03

### Added

- **Relationship-first quick add.** A `+` on each card opens a role sheet ("father",
  "sibling", a batch of children) with four fields only: name, gender, birth year,
  living status. `lib/tree/kin-plan.ts` turns a role into a plan -- which union to find
  or create, how many people, what the role implies about sex.
- **Person editing**, including your own record, behind a pencil in the detail panel.
- **An orbit arrangement** (`lib/tree/radial.ts`): one person centred, everybody else on
  rings by relationship distance. Answers "who surrounds this person", which a
  generation-banded pedigree cannot.
- **Per-card 3D tilt**, applied to the card and never the pane.
- **Connector geometry as pure strings** (`lib/tree/paths.ts`), so a corner that inverts
  is a failing test rather than something you squint at.

### Fixed

- **`db.transaction()` throws at runtime on the Neon HTTP driver while type-checking
  perfectly.** The first `addRelative` wrapped five writes in one and would have failed
  on every single use. Found by a live smoke script, because nothing offline can find it.
  Multi-write actions are now sequenced so a partial failure is a shape the app renders.
- **`updatePerson` was silently destructive**, writing every column unconditionally and
  nulling three fields the form never rendered -- including a searchable birth surname.
  Now patches by key presence: absent means leave alone, blank means erase.
- **An edit wrote to the wrong row on a merged person.** The fused id is the smallest
  member uuid, so on a person two families describe it is the far family's row about half
  the time, and the server would refuse somebody's edit to their own record.
- **A form prefilled from the wrong row copied the other family's data into yours** on
  save. A corruption with no visible tell.
- **Two single-parent unions instead of one couple** when adding a father and a mother.
  It looked like a rendering fault, which is the worst class of bug here.
- **Union dots sat beside couples rather than between them** -- all 34, worst by 498px.
- **82 of 150 edges turned through hard 90 degree corners**, and one sibling bar ran
  6013px against a 200px median. Now 3, all straight drops with no corner to round.
- **An 18px dead zone where edges met a union dot.** React Flow anchors to handles offset
  outward from the node box; the junction centre is now passed down explicitly. 150 of
  150 endpoints land on their dot.
- **Partner edges emitted paths of literal `NaN`**, so a couple's line vanished entirely.
  Testing `data` for truthiness is not testing the field the branch needs.

## 2026-07-31

### Added

- **Light, dark and system themes** on `[data-theme]`, with a render-blocking inline
  script so there is no flash of the wrong scheme.
- **An in-app motion switch** instead of `prefers-reduced-motion`. These animations carry
  information, so an OS flag set years ago to stop banners jumping would silently delete
  a data channel.
- **A person detail panel** -- side rail on a pointer device, bottom sheet on a phone,
  one component for both.
- **DAG-safe expand and collapse** in both directions, with per-card hidden counts.
- **Eleven keyboard shortcuts** whose bindings and help sheet come from one array, so a
  help sheet that lies is not possible.
- **Loading, error, alone, search-empty and offline states.**

### Fixed

- **Collapse blocked the person instead of their union**, which renders a marriage with
  one participant. Found by a test asserting both halves of the contradiction.
- **A collapse walk seeded from the roots could not fold ancestors at all**, because the
  roots are exactly what an upward fold hides.
- **The living-status colour painted 80% of every surface green** -- 94 of 117 card rails,
  93 of 152 minimap rects, 93 of 117 dots. Every individual green cleared its contrast
  floor; only a screenshot showed that 94 of them shared a canvas.
- **Fold targets measured 35px, not 44**, because everything inside the canvas viewport
  sits in a scaled layer. Then the fixed target grew wider than the card it belonged to,
  so clicking a person opened a fold.
- **The mobile detail sheet covered the very card it described** at 70dvh. Now 55dvh.
- **This project's own documentation compiled a dead CSS rule into production.** Tailwind
  scans markdown and comments as class-name sources, so spelling out a broken utility
  creates it. Found by grepping the built stylesheet.

## 2026-07-30

### Changed

- **Relations are revealed one person at a time rather than drawn at rest.** The 52
  relation edges were 73% of all edge ink at a median span of 2214px, against the family
  skeleton's 69px. The resting canvas went from 202 edges wearing 15 stroke treatments to
  150 wearing one.
- **The accent was reclaimed from the skeleton.** 68 of 150 family edges rendered amber,
  which is not an accent but a theme.

## 2026-07-29

### Added

- Neon Postgres schema live on a real branch: 12 tables, 10 enums, 28 indexes, 24 foreign
  keys, verified by a live smoke script rather than by trusting a migration's exit code.
- GitHub OAuth sign-in end to end, sign-out verified down to the deleted session row.
- Sharing by invite, with 14-day expiry and viewer-by-default.
- The graph editor: person, relation and partnership, gated by `lib/tree/authz.ts`.
- Demo mode: one UI, two data sources, an httpOnly cookie, and no database needed.

### Fixed

- **A neighbour app's session cookie threw `AdapterError` on `/tree`** for a visitor who
  had never signed in. Cookies are scoped by host and never by port, so every Auth.js app
  on localhost was reading and writing one name.
