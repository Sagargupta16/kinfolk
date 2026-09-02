# Changelog

Notable changes to Kinfolk. Newest first.

Dates are absolute. Each entry says what changed and, where it matters, what was
measured to know it was right -- several of the fixes below were invisible to a file
read and only showed up on a live canvas.

## 0.3.3 -- 2026-09-02 (the nanoid advisory, and the couple-centering fix ships)

### Security

- **nanoid held at `>=3.3.18 <4`** (GHSA-2v37-7h3g-55p8, Dependabot alert #6, high).
  nanoid below 3.3.18 can loop indefinitely when a custom generator is asked for a
  size of zero. The copy here is transitive -- postcss depends on it -- so the fix is a
  fourth entry in the workspace `overrides` block rather than a bump to anything we
  import. The range is capped below 4 deliberately: nanoid 4+ is ESM-only while postcss
  requires it as CommonJS, and an open `>=3.3.18` resolved to 6.0.1, which is not a
  drop-in. This manual bump supersedes the Dependabot update run that had been failing
  since 2026-08-17.

### Fixed

- **A couple now sits above the middle of its own children.** `alignPedigreeRows()` packed
  each generation independently -- centred on its own ELK extent, at minimum gaps -- and
  never consulted the row below, so the parent-over-children alignment ELK had already
  found was discarded on every layout. Measured on the sample tree, a couple sat a mean
  775px from its children's midpoint (median 600px), and on a real 40-person graph the
  viewer's own parents were 807px right of him and his sisters. Nothing on screen explains
  that drift, so it reads as a rendering fault rather than as a layout choice.

  Rows are now packed deepest-first, each household is placed over its own children, and a
  bidirectional relaxation resolves the row within its minimum gaps. Live DOM on the
  117-person tree: 21 of 34 couples within 10px (was 6), 26 within 200px, mean offset
  192px, median 0, and 0 card overlaps.

  The residual 13 are a geometric limit rather than a defect: the widest row needs
  11228px while the children it must reach span 7854px, so not every couple can be
  centred at once. Each of those sits hard against its neighbours at the exact minimum
  gap. Overlapping cards would be the worse failure, so the gap wins.

- **A one-directional sweep cannot centre a family whose children are to its left.** The
  first version of the fix ordered households by ELK's x while their target came from the
  children below, and those orderings disagree -- one couple sat at x=8098 with children
  at x=5929. Pushing right only then pinned every household in that situation, leaving 16
  of 34 misaligned while the offline arithmetic reported success, because it measured the
  intent rather than the result. The row is now re-ordered to follow its children before
  any gap is enforced, which is also the correct pedigree rule: the row below is final, so
  if one family's children sit left of another's, that family belongs left too.

- **A third gap tier separates sibling groups.** Two tiers put a married couple and a
  family boundary both at 56px, so fourteen aunts, uncles and spouses in one row read as
  one undifferentiated strip and no gap said where one set of siblings ended. Now
  22 / 56 / 141px at the card level, each step roughly 2.5x the last, so the eye groups on
  the largest gap before following any line. The boundary is where the parent union
  changes, which is a fact in the data rather than a heuristic on positions.

- **`MAX_BAR_SPAN` raised 900 -> 1600.** The old value predates parent-over-children
  alignment, when a bar's width was partly drift -- so it rejected genuinely wide families
  and genuinely misaligned ones alike, including a set of FOUR siblings at 1052px, which
  is precisely the case a sibling bracket exists for. 1600 is a little over a 1440px
  viewport, so a surviving bar is one the eye can hold at fit zoom, while a seven-child
  span (4847px on a real graph) still takes the curves.

- **The dot level's gap raised 18 -> 30.** The three tiers are ratios of `gap`, so at 18
  they computed to 20 / 35 / 79 against a 56px card: a partner gap a third of a card wide,
  and no grouping visible at the level whose whole purpose is an overview.

### Verification

- Re-ran after the nanoid override: Biome (106 files), both strict TypeScript projects,
  both production builds, and `pnpm audit --prod --audit-level=low` (no known
  vulnerabilities) all pass, and the lockfile resolves exactly one nanoid at 3.3.18.
- Biome, both strict TypeScript projects, both production builds, the dead-Tailwind CSS
  guard (0 matches), `pnpm audit --prod --audit-level=low`, and `git diff --check` pass.
- Measured on the live canvas at 1600x900, not from a file read: 117 person cards, 150
  edges, 0 NaN paths, 0 zero-length paths, 0 hard-corner paths, 0 card overlaps on real
  rendered boxes, one stroke treatment at rest, and 0 amber family edges.
- Sample-tree regression across `full`, `compact` and `dot`, combined and mine-only: 0
  overlaps and 0 sibling-bar collisions in all six.

## 0.3.2 -- 2026-08-08 (MIT licensing and public release)

### Repository

- Added a root MIT license and matching package metadata, making the terms for use,
  modification, and redistribution explicit.
- Approved public visibility after confirming that the current tracked tree contains no
  live credential or real family record. The owner explicitly accepted that the Git and
  GitHub pull-request history retains the author's public identity and early family-like
  sample names and dates.
- Updated the security policy to direct reports to GitHub's private vulnerability form.
  Runtime behavior and database schema are unchanged from 0.3.1.

### Verification

- Biome formatting/lint, both strict TypeScript projects, both production builds, both
  dependency audits, and `git diff --check` pass.
- The root and frontend package metadata both report version 0.3.2 and license MIT, and
  the current tracked tree remains free of environment files, credentials, database
  exports, local MCP configuration, and real family records.

## 0.3.1 -- 2026-08-08 (profile-first editing and public-release hardening)

### Changed

- Removed standalone person creation from the general editor. New people now start from a
  selected profile through **Add relative**, which records the role and family structure in
  one flow. The advanced sheet remains for connecting people who already exist.
- Added a deliberate second confirmation before recording another non-structural relation
  between people who are already immediate family or already share a different relation.
  An exact duplicate remains an idempotent success.
- New Auth.js cookie sessions and SPA bearer sessions now expire after 7 days instead of
  30. Existing database sessions retain their stored expiry until they end or the user
  signs out.

### Fixed

- Added per-connection removal in a profile's **Connections** section. The graph projection
  now carries the exact relation row and owning tree, the control appears only to an editor
  of that tree, and its confirmation states that neither person nor any parent, child,
  sibling, or partnership link will be changed.
- Production CORS no longer trusts localhost, OAuth token delivery accepts only the exact
  production callback path, and development callbacks exist only outside production.
- Unexpected API and OAuth failures now return generic browser messages and log only a
  non-sensitive stage or operation; SQL, bound values, profile payloads, and nested causes
  are not persisted in platform logs.
- Restored an atomic Postgres-backed per-tree creation budget and response security headers,
  including CSP, clickjacking protection, MIME sniffing protection, a permissions policy,
  a referrer policy, and production HSTS. Migration `0004_dusty_karen_page.sql` adds only
  the counter table and its tree foreign key.

### Repository

- Added `SECURITY.md` and `CONTRIBUTING.md`, repository/homepage/issue metadata, sensitive
  local-file and data-export ignore patterns, and public-safe deployment comments. Ad hoc
  SQL files are ignored while ordered `drizzle/*.sql` migration source remains versioned.
- Removed private-repository claims, local absolute paths, provider resource identifiers,
  and stale operational details from current public-facing guidance. The separately merged
  production record for migration `0003_fearless_mongu.sql` remains documented.
- At the time, no open-source license had been selected. The repository remained
  all-rights-reserved and private pending the owner's license and historical-PII decisions;
  0.3.2 records both decisions and adopts MIT.

### Verification

- Biome formatting/lint, both strict TypeScript projects, the Next production build, the
  GitHub Pages-mode Vite build, both full and production dependency audits, and
  `git diff --check` pass. Both audits report no known vulnerabilities.
- The built Pages artifact uses the `/kinfolk/` base, contains only the production API in
  `connect-src`, has no unresolved CSP marker or source map, and passes the CI dead-Tailwind
  guard. The Next production header set contains CSP, Permissions-Policy, Referrer-Policy,
  nosniff, DENY framing, and HSTS with no localhost source.
- Migration `0004_dusty_karen_page.sql` was generated from the schema and inspected: it
  creates only `people_creation_budgets` and its cascading tree foreign key. Current-tree
  secret and public-metadata scans found no live credential; ignored local environment,
  MCP, and Claude settings remain untracked.

## 0.3.0 -- 2026-08-08 (the archival field-desk redesign)

A deliberately visible frontend release across both permanent hosts. The Next app
and Vite SPA now share one archival field-desk language instead of presenting two
similar but drifting landing pages, while the graph, authentication, API and storage
boundaries remain unchanged.

### Redesigned

- Added a framework-neutral `BrandFrame` shared by the Next and Vite front doors.
  Runtime-specific actions remain slots, so Next keeps server-action demo forms and
  the Pages SPA keeps its browser OAuth flow without duplicating layout or copy.
- Replaced the near-empty landing and sign-in surfaces with editorial folio framing,
  warm-paper and deep-evergreen themes, a cross-reference vignette, shared privacy
  ledger, serif display type, tactile controls and a responsive mobile hierarchy.
- Reworked the tree workspace as a field desk: branded record masthead, compact
  instrument-style command dock, stronger search and demo chrome, and opaque reading
  sheets for detail, feed, editor, legend and sharing.
- Rebuilt the shared pedigree around one durable viewed person. Partner-connected
  people are packed into contiguous households on the same row, parent households rank
  above their children, children descend below one shared junction, and contradictory
  cycles still render without dropping people or changing graph facts.
- Added an explicit amber `Viewing` ticket and history docket, distinct quieter `You`
  identity treatment, and matching minimap/dot states. Search, feed and card travel now
  choose the same durable subject, which survives Cards/Rows/Dots and Tree/Orbit
  remounts and becomes the orbit centre and collapse anchor.
- Structured arrangements no longer allow free node dragging, which could immediately
  violate parent/child ranks and leave rails behind. The mobile viewing docket now has
  a pointer-safe lane beside the command dock.
- Person cards now read as index records with ruled-paper texture, inset keylines,
  editorial names and separated metadata. Their outer `NODE_METRICS` dimensions are
  unchanged, so React Flow, ELK, edge anchors and the minimap still agree.
- Detail and feed surfaces now enter from the right as desktop rails and from the
  bottom as mobile sheets. The mobile height remains 55dvh, touch targets remain at
  least 44px, and the shared Escape stack is unchanged.

### Preserved

- Graph projection, stored facts, kinship, privacy, auth, API, server-action and
  database behavior remain unchanged. Contact values still never reach canvas cards or
  their accessible labels, and CSS-only focus/depth state still stays outside layout
  inputs.
- The layout rework changes only the rendered geometry after ELK: fixed
  `NODE_METRICS`, edge facts, union semantics, edit permissions and schema contracts
  remain intact.
- The dual-host architecture remains permanent: Pages owns the Vite SPA at
  `sagargupta.online/kinfolk`; Vercel owns the API, OAuth exchange, writes and Next
  fallback at `kinfolk-neon.vercel.app`.

### Verified

- The final gate passes Biome formatting/lint, both strict TypeScript projects, the
  Next production build and the Vite Pages build. Vite reports only the existing
  mixed static/dynamic import and large-chunk advisories.
- Fresh Next and Vite runs at 1440x900 and 375x812 in light and dark render 151 nodes
  (117 people plus 34 junctions) and 150 family edges. Every parent card is above
  every child card; Cards, Rows and Dots have zero person-card or junction overlaps
  and zero sampled partner-path/card crossings; all 450 SVG paths are finite; and no
  structured node is draggable.
- Fixed card geometry remains 168x92; Rows remain 148x40 and Dots 56x34. Exactly one
  accessible `Viewing` marker follows Russell Nichols through Cards -> Rows -> Dots
  and Tree -> Orbit. Full SPA navigation remaps that same person from mine-only `m1`
  to combined `c1` and back by source identity rather than losing focus to a fused id.
  The current-person docket and minimap agree with that subject.
- Deferred Orbit travel also succeeds when the target is absent from the old radial
  layout: choosing Niklas Niska (`n15`) rebuilds the orbit around him, opens his detail
  sheet and updates the docket only after the new layout contains him.
- Desktop detail framing leaves the selected card beside the 22rem rail. At 375x812,
  the sheet measures 446.59px (55dvh), keeps the viewed card above it, introduces no
  horizontal overflow, and leaves search, the editable dock and viewing docket in
  clear pointer lanes. The command dock is fully transparent and non-interactive while
  a detail/feed sheet is open. Fresh console runs produced no warnings or errors.

### Deployment result

- Production [Deploy run 31256902754](https://github.com/Sagargupta16/kinfolk/actions/runs/31256902754)
  verified 3/4 committed migrations, applied `0003_fearless_mongu.sql`, then
  complete-checked 4/4 before all public endpoint probes passed. The migration is one
  schema statement creating the unique `people_claimed_user_idx`; it contains no
  genealogy rows or credentials.

## 0.2.4 -- 2026-08-08 (the audit hardening rework)

A comprehensive static and live audit of the graph, editor, both authentication
stacks, and both deployment targets. This reworks the failure-prone hot paths rather
than replacing the ledger-sync architecture: the shared React/domain layer still
ships as a Next app on Vercel and a Vite SPA at `sagargupta.online/kinfolk`.

### Reworked

- Canvas state is split by responsibility. ELK layout now depends only on graph
  geometry and data; depth, coarse-pointer mode, focus and dim/lit classes update
  independently, and those classes are reapplied after a real layout epoch. The
  editable-tree set is memoized, pointer-wash animation frames are cancelled on
  cleanup, and the minimap's stable shape layer no longer redraws with its controls.
- Union projection now merges compatible partial/full partnership records, normalizes
  fused self-partnerships without orphan junctions, and preserves child-bearing
  self-unions as honest single-parent families. Collapse skeletons skip direct
  childless partner edges, radial layout handles an empty ring set, and feed travel
  follows the visible partner instead of a hidden anchor.
- Overlay dismissal is coordinated by one LIFO Escape stack. One key press closes one
  top surface, including account, search, legend, editor, share, feed and person
  panels, instead of every mounted listener reacting at once. Feed/detail travel now
  uses request/ack state so an acknowledged destination cannot reopen itself.
- Editor controls now own stable label ids and valid ARIA relationships; stale relation
  subjects/messages clear when canvas selection clears. Duplicate shortcut handling
  and stale/dead props and comments were removed.

### Fixed

- Every runtime enum boundary now distinguishes a deliberate blank from invalid
  nonblank input. Forged gender, living, partnership, parent-role, contact-kind or
  visibility values refuse the whole action instead of throwing a database 500 or
  silently replacing a valid fact with `unknown`.
- Quick-add validates finite counts and component-accurate years (1000-2200), claims a
  free union partner slot inside the conditional update, and removes its newly inserted
  person if both slots lose a concurrent race. No winner can be overwritten and a
  refused request no longer leaves an orphan card.
- Starter-graph provisioning now retries on every successful Auth.js and SPA sign-in,
  repairs tree-without-self and self-without-root states, and is conflict-safe under
  parallel retries. The starter person reuses the user's UUID so retries also collide
  safely if Vercel promotes before migration `0003`; the migration then enforces at
  most one non-null claimed-self row per user. Root updates remain conditional and
  never replace a deliberate root.
- SPA sign-out keeps its bearer token until the API confirms server-side revocation, so
  a network/500 failure is retryable instead of presenting a false signed-out state.
  Expired 401 responses clear stale local tokens, malformed callback responses are
  diagnosed safely, and action exceptions retain CORS-bearing JSON errors. Tree-load
  driver diagnostics stay in server logs instead of appearing in API or UI messages.
- Minimap unsure/junction marks and accent text now keep contrast in both schemes; the
  family feed refreshes relative time when opened and describes partnership events
  honestly. Childless fused unions and hidden feed anchors no longer create misleading
  marks or navigation.

### Deployment and tooling

- CI and Pages use Node 22, the Pages build strips a trailing API-origin slash, and CI
  scans both Next and Vite output CSS for dead Tailwind utilities. Root typechecking now
  includes `.mts` scripts; obsolete supply-chain release-age exceptions were removed.
- Vercel skips `frontend/`-only commits because Pages owns that bundle, while new or
  unknown top-level paths still build by default. The workspace definition is reduced
  to the actual packages.
- Added project-specific Claude workflows for canvas verification and release
  verification plus a graph/privacy reviewer agent. Drizzle SQL and metadata remain
  tracked deployment inputs; local Claude settings and environment secrets remain
  ignored.
- Caught `CLAUDE.md`, `.env.example`, and `docs/SETUP.md` up to the 0.2.3 production
  architecture before recording this release.

### Verified

- The consolidated static gate passes: Biome formatting/lint, both TypeScript projects,
  the Next 16.3 production build and the Vite 8.2 Pages build. Vite reports only its
  existing dynamic-import and large-chunk advisories.
- Live in both frontends at 1440x900 and 375x812, in light and dark: the demo renders
  151 nodes (117 people plus 34 junctions) and 150 base family edges; all 68 partner
  rails stay flat; paths stay finite; no junction intersects a card; labels resolve;
  the overview keeps all 117 people and 34 junction marks; and there is no horizontal
  overflow. Depth, theme and panel changes preserve the viewport, while deliberate
  feed/search travel moves to the selected card.
- The feed renders all 80 hydrated events through the Vite JSON boundary. Feed-to-detail
  travel returns to the feed on one Escape and closes it on the next. On mobile the
  detail sheet is 55dvh and keeps the selected card visible. Fresh interaction runs
  produced no browser warnings or errors; the only later console failures were the
  deliberate 401/404 negative API probes.
- The demo API returns 200 with 151 nodes and 202 serialized edges (150 family-layout
  edges plus 52 dormant relation edges). Cross-origin unauthenticated writes return
  CORS-bearing JSON 401, unknown actions return JSON 404, and preflight returns 204.
  Real OAuth completion and authenticated writes were deliberately not exercised.

### Deferred

- The custom SPA OAuth flow still has a narrow duplicate/orphan-user race when two
  first sign-ins for a GitHub account with no email run concurrently; fixing it needs a
  dedicated identity-upsert design, not a provisioning patch.
- `Result.id` still doubles as explanatory text for invite actions; changing that
  contract requires a typed result migration across both frontends.
- The static SPA's meta CSP cannot express `frame-ancestors`, and development hosts
  remain a separate policy concern. Focus restoration after closing stacked panels is
  also deferred.
- A public discovery feed remains intentionally unbuilt. It requires explicit per-tree
  opt-in privacy semantics; the existing feed stays scoped to already authorized data.

## 0.2.3 -- 2026-08-08 (hotfix: the SPA canvas died on the feed's timestamps)

### Fixed

- **0.2.2 took down the whole SPA canvas in production.** The family feed calls
  `.getTime()` on person-row timestamps, and over the JSON API those arrive as
  ISO STRINGS -- so `familyFeed()` threw inside a render-path `useMemo` and the
  tree screen never mounted: stuck, no visuals, demo included. The
  server-rendered app was fine, which is exactly why it slipped through: the
  feed was verified on the Next app and never re-run through the SPA's
  serialise/parse path. `serialise.ts` had DOCUMENTED this landmine word for
  word ("would throw only on the API path and work fine locally") and
  deliberately left timestamps unrevived while nothing read them; the test
  pinning that contract went out with the suite in 0.2.0.
- `parseTreeView()` now revives every flattened `Date` -- person `createdAt`,
  `updatedAt` and `verifiedAt` on both `primary` and every source row, contact
  `createdAt`/`updatedAt`, union `createdAt` -- so a parsed view is
  indistinguishable from a served one. The revival lives at the boundary, not
  defensively inside consumers: a consumer that copes with strings beside one
  that does not is the same invisible drift as a serialiser disagreeing with
  its parser.

### Verified

- The exact crash path, live: the SPA against the API renders 151 nodes and 150
  edges, the feed opens with all 80 rows and correct relative times, and the
  console is clean. Both typechecks and the Vite build pass.

## 0.2.2 -- 2026-08-08 (the family feed, and a motion pass)

### Added

- **The family feed**: the record as a stream, newest first, behind a FEED
  toggle beside the legend. Rows read the way every feed does -- avatar, name,
  verb, a right-aligned time -- and are scoped the way nothing on a feed is:
  derived entirely from the nodes the viewer already received
  (`lib/tree/feed.ts`), so it can never show a person the canvas would not.
  Three event kinds fall out of timestamps the schema already carries: added to
  the record (`createdAt`), record updated (`updatedAt`, floored so an insert
  does not announce itself twice), and partnership recorded (a union's
  `createdAt`). No events table, no migration, works in the demo and in both
  frontends. Clicking a row travels to that person and opens their panel; the
  feed waits underneath and returns when the panel closes. Grouped into "this
  week / this month / earlier", capped at 80.
- A DELIBERATE boundary, stated in the panel's own header: only people with
  access see the feed. A PUBLIC discovery feed would be an opt-in per tree and
  is not built -- it is a different privacy posture, not a missing feature.
- **Sample data now has a believable timeline.** Every demo row carried the
  same epoch timestamp, which would render the feed as one giant dump. Rows now
  get deterministic moments hashed from their own ids (the demo rebuilds per
  request, and a feed that reshuffles on reload reads as broken), spread over
  seven months with a quarter of records touched again later.

### Fixed

- **Closing a panel after arriving from search could reopen it by itself.** The
  travel request (`goTo`) was never acknowledged, so it sat in state forever
  and any re-fire of the travel effect -- React Flow re-measuring during a
  hover className rewrite is enough -- replayed the last navigation. Found the
  first time a feed row was clicked, but reachable from search all along. The
  canvas now reports the travel handled and the stage clears it, the same
  contract quick-add already used.

### Motion

- The account menu settles in and out with a quick scale-fade instead of
  popping; the feed panel slides on the detail panel's own spring; feed rows
  cascade with a capped stagger so a long section arrives as a column, not a
  minute of drizzle.
- The sign-in page now enters with the landing page's stagger. The two screens
  are one surface, and only one of them arriving with rhythm made the other
  read as a fallback.
- All of it chrome, none of it canvas: the 117 cards and 150 edges stay CSS,
  because a JS animation re-renders a node and React Flow re-measures on
  render. The in-app motion switch governs everything new.

### Verified

- Live against the dev server: the feed opens with 80 events across three
  sections, rows carry kinship chips and relative times, clicking a row
  travels, selects the card and opens the panel, one Escape closes it and the
  feed returns; search-to-travel still works; consoles clean on fresh loads;
  Biome, both typechecks and both production builds green.

## 0.2.1 -- 2026-08-07 (a screenshot audit of every surface)

A full UI sweep with a live browser -- landing, sign-in, the canvas at three
detail levels, the detail panel, the legend, both themes, 1440px and 375px, and
the SPA -- measuring rather than eyeballing. Three real defects and one
under-sized control came out of it, all fixed and re-measured.

### Fixed

- **Five junction beads sat on people's faces.** The marriage-line placement put
  a couple's bead at their midpoint, which is only clear space when the couple
  is laid out adjacent -- with somebody between them (a remarriage chain, a
  fused graph) the midpoint is the middle of that person's card, and union
  nodes painted above cards. Measured: 5 of 34 beads. Two-part fix: the bead's
  x is clamped to the nearest clear gutter between the partners
  (`nearestClearPoint()` in layout.ts), and person cards now carry a higher
  node z-index than junctions so a couple with NO clear gutter hides its bead
  behind a card instead of wearing it. After: 0 of 34, with the marriage-line
  geometry unchanged (68/68 flat, 82/82 drops from the bead centre, 0 NaN).
- **Every right-edge control died while the detail panel was open.** The
  desktop panel is a 22rem rail pinned to the same edge as the arrangement,
  detail-level and legend controls, and it is deliberately non-modal -- so the
  controls underneath it swallowed every click (proved by a click that timed
  out, not by eye). The cluster now slides 22.75rem left while the panel is
  open and slides back when it closes; on a phone the panel is a bottom sheet
  and nothing moves.
- **The overview map floated 152 bare dashes over the canvas.** No backdrop, so
  in a busy corner it read as rendering garbage. It now sits on the same opaque
  bordered surface as the legend.
- **Icon-only toolbar buttons were 35px wide on a phone** (labels hide below
  `sm`), under the 44px floor every other control on this canvas clears. Now
  `min-w-11`.

### Verified

- Re-measured live after each fix, in the Next app and through the SPA: 0 beads
  on cards, 0 NaN paths, marriage lines and child drops byte-identical to
  before the clamp, the KEY/arrangement/detail controls clickable with the
  panel open, clean consoles, and both production builds green.
- Also checked and found healthy: landing and sign-in at both sizes and themes,
  the mobile bottom sheet (55dvh, subject card visible), search, breadcrumbs,
  fold controls, the fixed-frame minimap projection, and horizontal overflow
  (none anywhere).

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
