# CLAUDE.md

Repository-specific guidance for Kinfolk. See [CONTRIBUTING.md](CONTRIBUTING.md) for the public development workflow.

## Project

Kinfolk is a family tree maker where relatives each keep their own tree and then link them, so the combined graph shows how several families actually join up. It uses GitHub OAuth sign-in.

The distinguishing feature is the combined view: two people who have never met can both record the same grandparent, and Kinfolk merges those records without either side losing their own data.

It is also a contact graph, not only a pedigree. The schema lets anyone be a node -- a friend, a colleague, a neighbour -- and any two nodes can carry a named relation with their own contact details attached. The interface adds only parents, partners and children today; a relation can be shown and removed but not yet added.

## Stack

- **Language**: TypeScript 7
- **Framework**: Next.js 16.4 (App Router, Turbopack)
- **Database**: Neon Postgres via Drizzle ORM
- **Auth**: Auth.js v5 (`next-auth@5` beta), GitHub provider only, database sessions
- **UI**: Tailwind 4 with a shared family atlas, React Flow (`@xyflow/react`) canvas, ELK (`elkjs`) layout, Motion, lucide-react. `BrandFrame` shares public framing across Next and Vite without sharing runtime actions. Fonts are locally served Bricolage Grotesque, Inter, and JetBrains Mono.
- **Package manager**: pnpm
- **Deploy target**: Vite SPA on GitHub Pages, with the API and server-rendered fallback on Vercel + Neon. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Deploy state, as of 2026-10-28

0.4.0 was released and deployed on 2026-09-10: the Deploy workflow applied migrations and verified the serving commit, and Pages published on the follow-up HTTPS verification fix (#43). On 2026-10-28 `GET https://kinfolk-neon.vercel.app/api/health` returned `ready`, version 0.8.0, commit `f1a65e2`, database ready, auth configured, and the Pages SPA's `kinfolk-commit` meta named the same commit. The layout below was first recorded on 2026-08-08 and still holds:

- The Vite SPA is served from <https://sagargupta.online/kinfolk/> by GitHub Pages.
  Pages uploads only `frontend/dist`; source maps remain disabled.
- The API, OAuth exchange, writes, and server-rendered fallback are served from
  <https://kinfolk-neon.vercel.app>.
- The Next app cannot be statically exported because Auth.js, route handlers, and server
  actions require a server. The Vite SPA is the static front end and stores its bearer
  token in `sessionStorage`; the Next fallback uses an httpOnly cookie.
- Production uses one deployment environment. `scripts/vercel-ignore-build.sh` always
  builds production (`VERCEL_ENV=production`); its documentation-only skip applies only to
  non-production builds, and those are switched off.
- `AUTH_TRUST_HOST=true` is set for clarity: on Vercel `@auth/core` infers `trustHost`
  anyway (`lib/utils/env.js` checks `AUTH_URL`, `AUTH_TRUST_HOST`, `VERCEL` and `CF_PAGES`).
  `AUTH_URL` must be the exact deployment origin, and the GitHub OAuth callback must match
  it exactly.
- Vercel uses the Neon pooler URL. Local Drizzle schema commands use a direct URL. Ordered
  production schema changes go through committed migrations, never `db:push`.
- Unexpected API failures log only a non-sensitive stage or operation; browser responses remain
  generic, and error objects with SQL, bound values, or provider payloads are not persisted.
- Set secrets only through the deployment provider's trusted secret interface. Never put
  credentials in automation transcripts, commands, logs, issues, or repository files.

## Run

```
pnpm install
pnpm dev --port 3007
pnpm build
```

## Test

```
pnpm lint
pnpm test
pnpm typecheck
pnpm --dir frontend typecheck
pnpm build
pnpm --dir frontend build
pnpm audit --audit-level=low
pnpm audit --prod --audit-level=low
git diff --check
```

`pnpm test` runs the Vitest regression suite with synthetic identities and an in-memory
PGlite database using the committed migrations. It disables environment-file loading and
needs no production credentials. The old live smoke scripts remain removed.
For canvas changes, also verify the documented node/edge counts, geometry, mobile layout,
and a clean browser console in both frontends. Compilation alone does not verify behavior.

`pnpm bench:layout` times the full layout on the sample and on seeded generated families
(50, 200, 1000 people by default); rerun it after a layout change and update the README
table from its output. `pnpm screenshots` recaptures the README images in
`docs/screenshots/` and both Open Graph cards (`app/opengraph-image.png`,
`frontend/public/og-image.png`) from the live Pages app, or from `--base <url>`; rerun it
after a visible UI change.

The README's architecture and release diagrams are orrery specs in `docs/diagrams/*.yaml`,
with `evidence:` pointing at the files they come from. After a hosting, auth or workflow
change, update the spec, run `orrery verify` and `orrery validate --strict` on it, and
re-render both SVGs with the command in its header.

## Database

Production was recorded as Postgres 17 on 2026-08-08. Schema changes are committed as ordered Drizzle migrations and applied by the deployment workflow. The repository contains five migrations, `0000` through `0004`; 0.4.0 adds no migration.

**Migration `0003_fearless_mongu.sql` is applied in production.** [Deploy run 31256902754](https://github.com/Sagargupta16/kinfolk/actions/runs/31256902754) verified 3/4 committed migrations before `drizzle-kit migrate`, then complete-checked 4/4 and passed every public endpoint probe. The file is tracked schema history -- not a database dump -- and contains one `CREATE UNIQUE INDEX` for `people_claimed_user_idx`, with no genealogy rows or credentials.

Release 0.3.1 adds schema-only migration `0004_dusty_karen_page.sql`: one atomic creation-budget counter table and its cascading tree foreign key. It contains no family records or credentials. The runtime temporarily falls back to the previous timestamp count if application promotion wins the race with migration deployment.

## Entry points

- [app/page.tsx](app/page.tsx) -- landing page
- [app/tree/page.tsx](app/tree/page.tsx) -- the tree. One page, two data sources; resolves session first, demo cookie second.
- [app/signin/page.tsx](app/signin/page.tsx) -- GitHub sign-in, with the demo offered just as prominently
- [app/demo/route.ts](app/demo/route.ts) -- sets the demo cookie and redirects to `/tree`. A route handler, not a page: a page cannot set a cookie during render.
- [app/api/auth/[...nextauth]/route.ts](app/api/auth/%5B...nextauth%5D/route.ts) -- Auth.js handler
- [auth.ts](auth.ts) -- Auth.js config plus `sessionOrNull()`, which pages use instead of `auth()`

## Key files

- [lib/db/schema.ts](lib/db/schema.ts) -- the brain. Read this before touching any data logic.
- [lib/tree/relations.ts](lib/tree/relations.ts) -- `RELATION_KINDS`, the single source of truth for what each relation means, its inverse, and whether it is symmetric. Insert, display, and canvas all read it.
- [lib/tree/graph.ts](lib/tree/graph.ts) -- fusion (union-find) plus React Flow projection. Pure, no browser or DB deps.
- [lib/tree/layout.ts](lib/tree/layout.ts) -- ELK layered layout followed by household alignment
- [lib/tree/siblings.ts](lib/tree/siblings.ts) -- every family's run and lane in a generation gap, computed after ELK
- [lib/tree/kinship.ts](lib/tree/kinship.ts) -- `kinshipMap()`, what every person is to the viewer ("grandmother", "second cousin", "friend"). The card's second line.
- [lib/tree/view.ts](lib/tree/view.ts) -- `TreeView`, the one shape the UI renders. Demo and database both produce it.
- [lib/tree/load.ts](lib/tree/load.ts) -- the database path to a `TreeView`; [lib/tree/demo.ts](lib/tree/demo.ts) is the sample-data path
- [lib/tree/read-access.ts](lib/tree/read-access.ts) -- direct ownership/membership plus one hop through accepted person links; pending proposals grant no access
- [lib/tree/visibility.ts](lib/tree/visibility.ts) -- server-side contact filtering. Nothing else may decide what a viewer receives.
- [lib/tree/authz.ts](lib/tree/authz.ts) -- who may WRITE. Separate from the read path on purpose; every mutation starts here.
- [lib/tree/edit-actions.ts](lib/tree/edit-actions.ts) -- person, relationship, child-membership, and contact mutations, shared by server actions and the SPA action API
- [lib/tree/link-actions.ts](lib/tree/link-actions.ts) -- record-link proposals, owner consent, rejection, withdrawal, and revocation
- [components/tree/LinkPanel.tsx](components/tree/LinkPanel.tsx) -- the consent workflow opened through Link family records in the account menu
- [components/contacts/ContactWorkspace.tsx](components/contacts/ContactWorkspace.tsx) -- private contact reading and editing outside the canvas
- [lib/tree/neighbourhood.ts](lib/tree/neighbourhood.ts) -- who lights up on hover, traversing through union dots
- [lib/tree/relatives.ts](lib/tree/relatives.ts) -- one person's family in ROLES, for the detail panel; not kinship.ts
- [lib/tree/collapse.ts](lib/tree/collapse.ts) -- expand/collapse as REACHABILITY, not subtraction. A family tree is a DAG, so "the subtree below X" is not a set X owns.
- [lib/tree/editable.ts](lib/tree/editable.ts) -- WHICH row an edit writes to. A fused person is several rows; the fused id is the smallest, which is frequently not yours.
- [lib/tree/person-patch.ts](lib/tree/person-patch.ts) -- which columns an edit actually writes. Absent key means leave alone; blank key means erase.
- [components/tree/PersonEdit.tsx](components/tree/PersonEdit.tsx) -- the full edit form behind the panel's pencil, including your own record
- [lib/tree/kin-plan.ts](lib/tree/kin-plan.ts) -- "add a father" as a PLAN, plus `splitName()`
- [lib/tree/node-add.ts](lib/tree/node-add.ts) -- the `+` handles as data: which ones, where they sit, their hit boxes
- [components/tree/NodeAdd.tsx](components/tree/NodeAdd.tsx) -- the `+` handles and the add strip
- [components/tree/NodeStrip.tsx](components/tree/NodeStrip.tsx) -- the one small strip both card actions open
- [components/tree/NodeEdit.tsx](components/tree/NodeEdit.tsx) -- the edit strip a second tap on the viewed card opens
- [lib/tree/paths.ts](lib/tree/paths.ts) -- connector geometry as strings
- [lib/tree/radial.ts](lib/tree/radial.ts) -- the ORBIT arrangement: one person centred, everybody else on rings
- [components/tree/ViewControls.tsx](components/tree/ViewControls.tsx) -- tree/orbit arrangement plus the 3D depth switch, two controls because they compose
- [lib/tree/feed.ts](lib/tree/feed.ts) -- `familyFeed()`, the activity feed derived from row timestamps
- [components/tree/FeedPanel.tsx](components/tree/FeedPanel.tsx) -- the feed rail, in the detail panel's shell
- [components/ui/BrandFrame.tsx](components/ui/BrandFrame.tsx) -- the shared family-atlas landing and sign-in shell; auth and demo actions arrive as runtime-specific slots
- [lib/theme.ts](lib/theme.ts) -- theme + motion preference, and `THEME_SCRIPT`, the render-blocking inline script that resolves the stored theme before first paint
- [components/tree/TreeCanvas.tsx](components/tree/TreeCanvas.tsx) -- canvas geometry, focus, collapse and framing; consumes but does not own the durable viewed person
- [components/tree/TreeStage.tsx](components/tree/TreeStage.tsx) -- owns Tree / People navigation, Options and `viewedId` above the keyed React Flow provider
- [components/tree/PeopleDirectory.tsx](components/tree/PeopleDirectory.tsx) -- a searchable directory of authorized people that opens the same profile as the canvas
- [components/tree/AccountMenu.tsx](components/tree/AccountMenu.tsx) -- authenticated identity, family access and the server-backed Sign out action; absent in demo mode because there is no session to revoke
- [components/tree/PersonDetail.tsx](components/tree/PersonDetail.tsx) -- Family / About / Contact sections in a desktop side panel or mobile bottom sheet; contact values stay on their own authorized page
- [components/tree/sheet-motion.ts](components/tree/sheet-motion.ts) -- one responsive motion source for right-to-left desktop rails and bottom-up mobile sheets
- [components/tree/TreeShortcuts.tsx](components/tree/TreeShortcuts.tsx) -- the keyboard bindings AND the help sheet, from one array so they cannot drift
- [components/tree/TreeStates.tsx](components/tree/TreeStates.tsx) -- loading, error, search-empty, offline
- [components/ui/AppearanceMenu.tsx](components/ui/AppearanceMenu.tsx) -- light/dark/system and explicit Full/Reduced motion, shared across both frontends
- [components/ui/MotionPreference.tsx](components/ui/MotionPreference.tsx) -- connects the persisted motion setting to Motion components; canvas travel also honors Reduced
- [app/globals.css](app/globals.css) -- design tokens; do not hardcode colours in components

## The data model, in five sentences

Read this before adding a table or a query -- most "obvious" schema changes here are wrong.

1. **A family tree is a DAG, not a tree.** Two hierarchical edge kinds (partner, parent-child), and the same human can be described by several users independently.
2. **Parentage hangs off a `unions` row, never a (father, mother) column pair.** Remarriages, half-siblings, single parents, and adoption then fall out for free instead of each needing a special case. A child can belong to two unions (birth and adoptive), which is why parentage is not a column on `people`.
3. **`people` is a claim, not a person.** "Your grandfather and my grandfather are the same man" is a consent-gated `person_links` row, never a destructive rewrite -- both owners keep their rows and unlinking restores separate views.
4. **`person_relations` holds every non-hierarchical connection** (cousin, friend, colleague, mentor, neighbour...) as one row per pair per kind. It is a separate table from `unions` because a friendship carries no generation, so it must never reach the layout engine.
5. **`contact_details` is rows, not columns.** One row per channel per person, each carrying its own visibility. A phone column could not hold two numbers and would need a migration every time a new platform appeared.

## Area rules

The gotchas and rules that matter only for one part of the code live in `.claude/rules/`, moved there verbatim. Each file loads by itself when a file matching its `paths:` is read or edited; read the matching one first when planning work in its area. Where a rule or a code comment says "CLAUDE.md", it means this file together with these.

- [.claude/rules/editing.md](.claude/rules/editing.md) -- edit targets, partial patches, enums, birth years, server writes
- [.claude/rules/node-editor.md](.claude/rules/node-editor.md) -- adding relatives: `planKin`, the `+` handles, the strips, the write choreography
- [.claude/rules/layout.md](.claude/rules/layout.md) -- ELK, household rows, gap tiers, lanes, junctions, connectors, orbit, 3D, card size
- [.claude/rules/layout-libraries.md](.claude/rules/layout-libraries.md) -- why elkjs + React Flow, and the alternatives measured against it
- [.claude/rules/canvas.md](.claude/rules/canvas.md) -- `viewedId`, collapse, touch targets, phone chrome, Escape, shortcuts, React Flow quirks
- [.claude/rules/edges.md](.claude/rules/edges.md) -- edge styling, the relation reveal, dash and stroke tokens, the taper, the legend
- [.claude/rules/ui-styling.md](.claude/rules/ui-styling.md) -- colour tokens, contrast, themes, motion, the CSS cascade, fonts, public screens
- [.claude/rules/access.md](.claude/rules/access.md) -- read access versus write permission, sharing, record links, contacts
- [.claude/rules/auth-hosting.md](.claude/rules/auth-hosting.md) -- session cookie, OAuth sign-in, provisioning, `sessionOrNull()`, mount paths
- [.claude/rules/database.md](.claude/rules/database.md) -- Neon batches, the Auth.js adapter columns, the client module, relation rows
- [.claude/rules/tree-view.md](.claude/rules/tree-view.md) -- the `TreeView` JSON boundary, the kinship `Map`, kinship terms, feed, relatives
- [docs/agent-history.md](docs/agent-history.md) -- 0.4.0 validation and the dated observations of earlier sessions; no edit needs it

## Gotchas

- **A Playwright full-page capture can duplicate this fixed-height app while stitching tiles.** Diagnose with `innerWidth`/`innerHeight`, element counts and a viewport screenshot before treating the repeated image as a duplicate React render. The live DOM has one workspace; the capture artefact does not.
- **Tailwind 4 scans markdown and CSS comments for class names, so documenting a broken utility COMPILES it.** The square-bracket gotcha note in this very file emitted a live `--tw-duration: --duration-base` rule into the production stylesheet (verified 2026-07-31 by grepping `.next/static/**/*.css`: 1 dead rule, traced to CLAUDE.md line 127, 0 after rewording). Describe a broken form in prose; never spell it.
- **`experimental.useTypeScriptCli: true` in [next.config.mjs](next.config.mjs) is load-bearing.** TypeScript 7 removed the compiler API Next reaches for directly; without the flag dev boot throws "TypeScript 7.0.2 does not provide the compiler API required". Remove it once Next supports TS 7 natively.
- **pnpm 11 reads build-script approval from [pnpm-workspace.yaml](pnpm-workspace.yaml) (`allowBuilds:`), not `package.json`.** A `pnpm.onlyBuiltDependencies` field in package.json is silently ignored and installs fail with `ERR_PNPM_IGNORED_BUILDS`.
- **Dates are `date`, never `timestamp`.** A birthday has no timezone; storing it as an instant shifts people across midnight depending on who reads it. Fuzzy dates go in the separate `*Approx` text columns ("about 1890").
- **`unknown` is a real stored value**, not a missing one. Genealogy is mostly incomplete data and forcing a guess corrupts the record.
- **Only accepted links reach `fuseTrees()`.** A pending proposal must never change what anyone sees; callers filter on status.
- **Contact values never reach the browser with the tree.** A card shows only which channels exist; a canvas gets screenshotted. Until 0.8.0 the `TreeView` still CARRIED every visible value (in the page props and the `/api/tree` JSON) and only the components declined to draw it; `FusedPerson.contacts` is now `ContactChannel[]`, the row without `value`, after fusion has deduped on the values server-side. Values load only on the contact page (`contactState`). Values default to `visibility: "tree"` (the narrowest) and require a deliberate click.
- **`next-env.d.ts` is excluded from Biome.** Next regenerates it with CRLF on every dev boot, so formatting it just loses the race. [.gitattributes](.gitattributes) pins LF for everything else.
- **`DATABASE_URL` in `.env.local` must be the DIRECT host, not the `-pooler` one.** The app talks to Neon over their serverless HTTP driver, which is happy either way, but `drizzle-kit push` opens a plain TCP connection that the pooler endpoint will not serve. One variable feeds both, so the direct host is the only value that satisfies both readers.
- **`drizzle-kit push` on Windows prints `Changes applied` and THEN crashes** with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` and exit code 3221226505. That is libuv tearing down the websocket after the work has committed, not a failed migration. Confirm against `information_schema` rather than trusting the exit code -- the live smoke script that used to do this was removed in the 0.2.0 rework.
- **`tsx` compiles a bare `.ts` script to CJS here**, because package.json has no `"type": "module"`, so top-level `await` fails with "not supported with the cjs output format". Name a script `.mts` to get ESM.
- **A Tailwind 4 CSS variable in an arbitrary value needs PARENTHESES, not brackets.** `duration-(--duration-base)` compiles to `var(--duration-base)`; the square-bracket form emits the literal property name instead, which is not a valid duration, so the property silently falls back to its initial value and the transition simply does not happen. Nothing warns -- not the build, not Biome, not the browser console. 34 utilities across this repo were dead this way; when adding one, confirm the computed style on a real element rather than trusting the class list. **Do not write the broken form out in prose anywhere in this repo, including this file and CSS comments**: Tailwind's scanner reads markdown and comments as class-name sources, so spelling it literally compiles a dead rule into the production stylesheet -- verified 2026-07-31, this very line was doing it.

## Repo-specific rules

- Design is a simple family atlas adapted from portfolio-react: flat opaque surfaces, near-black `#0b1012` in dark mode, blue `#2563eb` primary actions, and `#60a5fa` dark-mode accents. Use locally served Bricolage Grotesque headings, Inter body text, and JetBrains Mono metadata. Keep Tree / People and search prominent, and adding a relative on the viewed card's own `+` handles; place secondary controls under Options. Preserve both themes, 44px minimum hit targets, mobile reading space, and explicit Full/Reduced motion.
- Keep graph maths in `lib/tree/` with no React or DB imports so it stays pure and assertable. The current Vitest suite covers family roles, planning, projection, and record boundaries. The earlier suite was removed in 0.2.0; its collapse and relatives defects remain useful historical examples of bugs that a screenshot alone can miss.
- Fused ids must be deterministic (smallest member id) so output never depends on input order. Editing and profile persistence must resolve contributing source ids; do not replace them with the display id.
- **Never send real user records, credentials, or private deployment data to an external LLM API.** Synthetic source and fixtures still need the same secret/PII review as any other outbound data.

## Tree acceptance rules

What Sagar asked the tree to look and feel like, collected from the sessions where he steered it (2026-07-29 to 2026-10-28). The tree view was rebuilt seven times across Claude Code, Kiro and Codex while these lived only in chat, so check any layout, connector or editing change against them before calling it done, and add a line here when he adds a rule. The mechanism that meets each one today is in brackets.

Layout

- A family reads top to bottom: parents directly above their children and centred over all of them, never placed off to the side (2026-07-29, 2026-08-08). [household alignment in `lib/tree/layout.ts`]
- Children sit just below their parents with even spacing, and as the family widens (uncles, aunts, cousins) households stay evenly spaced instead of drifting sideways (2026-08-08). [`pedigreeOrder()`, gap sizing from `lib/tree/siblings.ts`]
- Partners stand side by side on one row. A couple without children is two cards joined to each other, with no arrow between them (2026-08-06). [partner row, union dot]

Lines

- Every line can be followed by eye: no broken or split lines, nothing off-centre, and no two families' lines merged so that it is unclear whose child is whose. Lines do not have to be straight (2026-07-31, 2026-08-08). [sibling bracket, a lane per family per generation gap]
- Direction is shown without heavy arrowheads; the first arrows were rejected as hard to read (2026-07-29, 2026-07-31). [tapered stroke, `#kf-taper`]
- A line keeps the same gap from the card it meets above and below, so it never looks as if it touches a box early (2026-10-28).

Cards and adding people

- A card carries the name and the relationship, not handles, phone numbers or other detail (2026-07-29).
- Adding a person asks only for a name and a gender answer; birth year is optional and living or passed away may be recorded; nothing else is asked (2026-07-31, 2026-10-27). [`NodeAdd.tsx` strip]
- The family is built from the cards themselves: a `+` above for a parent, below for a child, beside for a partner, and once two people are partners their children come from one shared `+` under the pair. No separate input forms on the canvas (2026-07-31, 2026-10-27). [`lib/tree/node-add.ts`]

Views and data

- Besides the layered tree there is a view with the selected person in the centre and everyone else on rings around them, plus a 3D option (2026-07-31). [Orbit arrangement and the depth switch, `ViewControls.tsx`]
- Look and motion follow portfolio-react (2026-07-30). [Repo-specific rules above]
- The sample family is public sample data of a few hundred people, never his own family or family names (2026-07-29, 2026-10-28). [Wikidata sample in `lib/tree/sample.ts`]

## Demo mode

Sample data is reachable before auth exists, following the ledger-sync pattern: ONE UI, two data sources, a flag, and mutation guards. The difference is that Kinfolk renders on the server, so the flag is an httpOnly cookie read in a server component rather than a client store -- which also keeps `lib/tree/sample.ts` out of the client bundle entirely.

- Both paths produce the same `TreeView` ([lib/tree/view.ts](lib/tree/view.ts)), so no component knows which one it is rendering.
- [lib/tree/demo.ts](lib/tree/demo.ts) calls the real `fuseTrees` and `toFlowGraph` rather than shipping pre-computed positions. If fusion breaks, the demo must break too; a demo that cannot fail is a screenshot, not a proof.
- Mine-only mode drops the other tree AND its links, so it is a genuinely smaller dataset rather than the same tree with nodes hidden. That is what a viewer without a share grant would actually get.
- A real session beats the demo COOKIE, so signing in from inside the demo shows your own (possibly empty) tree instead of silently keeping sample data on screen. An explicit `?demo=1` beats the session, on the page and on `/api/tree` alike: "Explore the sample" from a signed-in browser showed the visitor's own family under the sample banner until 0.8.0. The SPA sends `demo=1` only for a `?demo=1` URL; a signed-out `/tree` goes to the front door.

## Status

Current version: **0.8.1**, dated **2026-10-28**: every line between two generations gets a lane of its own, at least a third of the gap from the cards (a crowded gap grows to fit), and a remarried person stands between the people they married -- found by watching 0.8.0 in production, where three marriages and two families shared lines. It builds on 0.8.0 (2026-10-28): a whole-repository audit with every finding fixed -- an email-takeover path in SPA sign-in closed, contact values off the tree view, access changes left to a graph's owner, ceilings on every write, folding that actually folds, lines that draw on, brackets centred in their gap, layout in a Web Worker, and a real sample family from Wikidata (Queen Victoria's and Christian IX's: 216 people from 228 records in two trees joined by 12 links). 0.8.0 built on 0.7.0 (2026-10-28): a tap only picks a person, the `+` and a second tap open one small strip at the card, and a write is choreographed. 0.6.0 built the family from the canvas with `+` handles above, beside and below the viewed card. Both workspace packages record 0.8.1, and `/api/health` reports the root package version after deploy. 0.4.0 was released and deployed on **2026-09-10**. See [CHANGELOG.md](CHANGELOG.md).

0.4.0 added Tree / People navigation, profile sections, private contact editing, owner-consent record linking, confirmed deletion of unclaimed people, and attachment/detachment of existing children with explicit parent roles. Account-linked profiles cannot be deleted. Photo uploads still need an approved private-storage provider and verified authentication; avatars remain initials.

The 0.4.0 validation record and the dated historical observations are in [docs/agent-history.md](docs/agent-history.md).

### Current development and release workflow

Setup for a fresh clone is [docs/SETUP.md](docs/SETUP.md). Production is [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): CI runs lint, both typechecks, isolated regression tests, dependency auditing, both builds, and the built-CSS guard. `deploy.yml` checks migration history, applies committed migrations, complete-checks the history, then waits for the expected serving commit and readiness. `pages.yml` checks its published commit and manifest assets. `health.yml` checks API readiness and Pages assets daily.

**`deploy.yml` runs `db:migrate`, never `db:push`.** Missing production `DATABASE_URL` or `PRODUCTION_URL` fails the relevant job. Vercel's Git integration builds independently, so this workflow cannot guarantee that migrations finish before application promotion; runtime changes must tolerate that ordering. CI passes a blank `DATABASE_URL` and a throwaway `AUTH_SECRET`, and needs no production database secret.

**`ci.yml` remains inline.** Historically, `Sagargupta16/shared-workflows` gained `run-typecheck`, `tests-before-build`, and `build-env` on 2026-08-05, while Kinfolk kept its repo-specific built-CSS guard. The current workflow retains that guard alongside tests and auditing.

The editor is the canvas: tap a person to pick them, and use the `+` above their card for a parent, beside it for a partner, and below it (one shared `+` under a couple) for a child; siblings are children of their parents. Tap the picked card again to change their name or year, open their full profile, or delete them. 0.6.0 removed the role picker, the More-details form, the toolbar and panel Add relative buttons, and the Connect existing people panel; the server actions behind that panel (`addRelation`, `addUnion`, `addChild`, `removeChild`) remain on the action API with no UI. Removing a connection preserves the person's record. Private contact values are edited on a separate authorized page, and **Link family records** in the account menu handles owner consent.

Sign-in works end to end as of 2026-07-29: the GitHub OAuth app exists, a real round trip completed, and sign-out is verified down to the session row being deleted from Postgres. Sharing by invite shipped alongside it (invite by email or GitHub username, 14-day expiry, `viewer` by default, claimed in the `signIn` event) with 10 live checks including viewer-cannot-edit and expired-invite-refused. There is no mail sender, so an invite returns its explanatory text for the inviter to pass on.

Photo storage remains unconfigured. Do not expose `photoKey` as an image URL or enable uploads before the private provider and authentication flow are approved.

The canvas was screenshotted for the first time on 2026-07-30, and that is what found the rework. Earlier sessions could only measure per-element (the Browser pane would not composite -- `document.visibilityState === "hidden"` -- so edge paths read 0), and every individual value checked out: each token cleared its contrast floor, each stroke weight sat on the scale. The picture was still wrong, because nothing per-element can see that 52 lines share a canvas. **Screenshot the canvas before claiming a visual change is done** -- a metric per mark cannot answer how the marks add up.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes -- APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

Next.js can generate this block during `next dev`. This repository sets `agentRules: false` in `next.config.mjs` so local previews preserve the reviewed instructions.

<!-- END:nextjs-agent-rules -->
