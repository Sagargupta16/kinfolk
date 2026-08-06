# Changelog

Notable changes to Kinfolk. Newest first.

Dates are absolute. Each entry says what changed and, where it matters, what was
measured to know it was right -- several of the fixes below were invisible to a file
read and only showed up on a live canvas.

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
