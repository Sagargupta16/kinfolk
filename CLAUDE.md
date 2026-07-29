# CLAUDE.md

> This file stacks on top of the workspace root at `C:\Code\GitHub\`:
> - Root [`CLAUDE.md`](../../CLAUDE.md) -- voice, rules, routing map, references, skills, slash commands, conventions.
> - Root [`MEMORY.md`](../../MEMORY.md) -- live facts across repos.
> - Root [`STATUS.md`](../../STATUS.md) -- live PR/CI/security dashboard.
> - [`.claude/resources/`](../../.claude/resources/README.md) -- deep reference for collaboration, workflow, git, OSS, debugging, voice.
>
> Read those first. The guidance below only adds **repo-specific context** -- it does not override anything in the root.

## Project

Kinfolk is a family tree maker where relatives each keep their own tree and then link them, so the combined graph shows how several families actually join up. Private repo, GitHub OAuth sign-in.

The distinguishing feature is the combined view: two people who have never met can both record the same grandparent, and Kinfolk merges those records without either side losing their own data.

It is also a contact graph, not only a pedigree. Anyone can be a node -- a friend, a colleague, a neighbour -- and any two nodes can carry a named relation with their own contact details attached.

## Stack

- **Language**: TypeScript 7
- **Framework**: Next.js 16 (App Router, Turbopack)
- **Database**: Neon Postgres via Drizzle ORM
- **Auth**: Auth.js v5 (`next-auth@5` beta), GitHub provider only, database sessions
- **UI**: Tailwind 4, React Flow (`@xyflow/react`) canvas, ELK (`elkjs`) layout, Motion, lucide-react
- **Package manager**: pnpm
- **Deploy target**: not deployed yet (Vercel + Neon when it ships, mirroring `prod/kalchar`)

## Run

```
pnpm install
pnpm dev --port 3007
pnpm build
```

Preview via the Browser pane uses [`.claude/launch.json`](../../.claude/launch.json) at the **workspace root**, not this repo -- the tool only reads the root file.

## Test

```
pnpm test
pnpm typecheck
pnpm lint
```

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
- [lib/tree/layout.ts](lib/tree/layout.ts) -- ELK layered layout, generation bands, node dimension constants
- [lib/tree/view.ts](lib/tree/view.ts) -- `TreeView`, the one shape the UI renders. Demo and database both produce it.
- [lib/tree/load.ts](lib/tree/load.ts) -- the database path to a `TreeView`; [lib/tree/demo.ts](lib/tree/demo.ts) is the sample-data path
- [lib/tree/visibility.ts](lib/tree/visibility.ts) -- server-side contact filtering. Nothing else may decide what a viewer receives.
- [lib/tree/neighbourhood.ts](lib/tree/neighbourhood.ts) -- who lights up on hover, traversing through union dots
- [components/tree/TreeCanvas.tsx](components/tree/TreeCanvas.tsx) -- canvas, owns layout-on-data-change and nothing else
- [app/globals.css](app/globals.css) -- design tokens; do not hardcode colours in components

## The data model, in five sentences

Read this before adding a table or a query -- most "obvious" schema changes here are wrong.

1. **A family tree is a DAG, not a tree.** Two hierarchical edge kinds (partner, parent-child), and the same human can be described by several users independently.
2. **Parentage hangs off a `unions` row, never a (father, mother) column pair.** Remarriages, half-siblings, single parents, and adoption then fall out for free instead of each needing a special case. A child can belong to two unions (birth and adoptive), which is why parentage is not a column on `people`.
3. **`people` is a claim, not a person.** "Your grandfather and my grandfather are the same man" is a consent-gated `person_links` row, never a destructive rewrite -- both owners keep their rows and unlinking restores separate views.
4. **`person_relations` holds every non-hierarchical connection** (cousin, friend, colleague, mentor, neighbour...) as one row per pair per kind. It is a separate table from `unions` because a friendship carries no generation, so it must never reach the layout engine.
5. **`contact_details` is rows, not columns.** One row per channel per person, each carrying its own visibility. A phone column could not hold two numbers and would need a migration every time a new platform appeared.

## Gotchas

- **Auth.js Drizzle adapter matches account columns by TS property name in snake_case.** `refresh_token`, `access_token`, `expires_at`, `token_type`, `id_token`, `session_state` stay snake_case in [lib/db/schema.ts](lib/db/schema.ts) even though the rest of the schema is camelCase. `expires_at` must be `integer` (OAuth epoch seconds), not a timestamp. Renaming them to camelCase produces a `DefaultPostgresAccountsTable` type error.
- **`experimental.useTypeScriptCli: true` in [next.config.mjs](next.config.mjs) is load-bearing.** TypeScript 7 removed the compiler API Next reaches for directly; without the flag dev boot throws "TypeScript 7.0.2 does not provide the compiler API required". Remove it once Next supports TS 7 natively.
- **pnpm 11 reads build-script approval from [pnpm-workspace.yaml](pnpm-workspace.yaml) (`allowBuilds:`), not `package.json`.** A `pnpm.onlyBuiltDependencies` field in package.json is silently ignored and installs fail with `ERR_PNPM_IGNORED_BUILDS`.
- **Dates are `date`, never `timestamp`.** A birthday has no timezone; storing it as an instant shifts people across midnight depending on who reads it. Fuzzy dates go in the separate `*Approx` text columns ("about 1890").
- **`unknown` is a real stored value**, not a missing one. Genealogy is mostly incomplete data and forcing a guess corrupts the record.
- **Only accepted links reach `fuseTrees()`.** A pending proposal must never change what anyone sees; callers filter on status.
- **A relation edge must never influence node placement.** `FlowEdge.layout` is the discriminator and [lib/tree/layout.ts](lib/tree/layout.ts) filters on it before handing edges to ELK. Feed a "friend" edge to the layered algorithm and that friend gets shoved into a lower generation, which silently misrepresents the family. [lib/tree/layout.test.ts](lib/tree/layout.test.ts) asserts the family skeleton's positions are identical with and without relation edges present -- if that test fails, the overlay leaked into the skeleton.
- **Withholding social edges from ELK creates a second problem, which `anchorFamilylessNodes()` in layout.ts solves.** A friend with no parents and no partner is an isolated node to ELK, so it lands in the FIRST layer and renders as somebody older than the grandparents. The post-layout pass moves those people onto the row of a contact they know. It deliberately runs after layout instead of as an ELK constraint, so the skeleton cannot shift to accommodate a friend.
- **Relation edges are `pointer-events: none` on themselves AND every descendant.** They render above the cards (`zIndex: 1001`) so their labels are not painted over, which means an edge label's `<rect>` sits on top of a card. React Flow sets `pointer-events: all` on labels, and that beats a `none` on the ancestor group, so the `*` selector in globals.css is load-bearing: without it a label swallows the drag that should move the card.
- **A relation label is revealed by hovering the PERSON, not the edge.** Since the overlay takes no pointer events, focus comes from `onNodeMouseEnter`/`onNodeClick` in [components/tree/TreeCanvas.tsx](components/tree/TreeCanvas.tsx) toggling `is-active`. That is applied in its own effect that only rewrites `className` -- folding focus into the `flowEdges` memo would re-run ELK on every hover, because the layout effect depends on that memo.
- **Directed relations are stored one way only.** "mentee" is not a stored value; it is the `mentor` row read from the other end via `relationLabel()`. Adding an inverse enum member would let the same fact exist as two rows with nothing to reconcile them.
- **Symmetric relations get id-sorted endpoints via `canonicalPair()`.** That is what makes the unique index able to reject a duplicate friendship recorded from either side. Directed kinds keep caller order, because A holds the role. Never insert a relation without going through `canonicalPair()`.
- **Self-relations are blocked in application code, not by a constraint.** Drizzle cannot express a CHECK inside an index, so `personAId <> personBId` is the caller's job. Fusion can also *create* a self-loop after a merge; `fuseTrees()` drops those.
- **Contact values never reach the canvas.** A card shows only which channels exist; a canvas gets screenshotted. Values default to `visibility: "tree"` (the narrowest) and require a deliberate click.
- **Phone numbers are stored as entered, never normalised.** Relatives abroad have country codes, older records have landlines, and rewriting the string loses information the owner deliberately typed. Dedupe compares trimmed + lowercased values only.
- **`next-env.d.ts` is excluded from Biome.** Next regenerates it with CRLF on every dev boot, so formatting it just loses the race. [.gitattributes](.gitattributes) pins LF for everything else.
- **React Flow error#004 ("parent container needs a width and a height") is not always noise.** While the container measures 0x0 React Flow never measures nodes, so edges render as an empty container. Framing keys off `useNodesInitialized`, not `requestAnimationFrame`, for exactly this reason.
- **`lib/db/client.ts` must stay importable with no `DATABASE_URL`.** Next collects page data by importing every route's module graph, so throwing at module scope fails `pnpm build` on a fresh clone. The client is always constructed for real and pointed at a placeholder URL whose queries throw a message saying what to do. A lazy Proxy is not an option: the Auth.js Drizzle adapter type-checks the instance it is handed at import time.
- **Pages call `sessionOrNull()`, never `auth()` directly.** Sessions live in the database, so with no `DATABASE_URL` there is nothing to look one up in and Auth.js logs `MissingSecret` on every render. Reading the demo tree needs no auth, so the guard belongs in one place.
- **Only the INNER card animates on entrance, never the node wrapper.** React Flow owns the wrapper's `transform` for positioning; animating it fights the layout and the node lands in the wrong place. Hence `.kf-enter > *` in globals.css rather than `.kf-enter`.
- **Import `getNodesBounds` from `useReactFlow()`, not the package root.** The standalone export has no node lookup, cannot handle sub-flows, and warns on every single call.
- **The fusion reveal reads `contributingTreeIds.length`, so it is a property of the data, not a flag.** Mine-only mode produces `merged 0` and therefore no stacked sheets, automatically. The sheets carry no `z-index`: they and the card are all `z-index: auto`, so paint order alone puts the card on top, and that survives an ancestor gaining a stacking context in a way a negative index would not.
- **Generation bands come from person nodes only.** A union dot sits between two rows, so including one invents a half-generation. The entrance stagger therefore snaps each node to its NEAREST band rather than an exact y match, or every union dot gets delay 0 and pops in ahead of the couple it joins.

## Repo-specific rules

- Design follows the `design` skill's taste-2026 module: near-black canvas (never `#000`), monochrome token stack plus ONE accent (warm amber, deliberately not product blue), 1px hairlines instead of heavy shadows, mono + `tabular-nums` for metadata and numbers, 44px minimum hit targets, ease-out under 300ms, mobile-first.
- Keep graph maths in `lib/tree/` with no React or DB imports so it stays unit-testable. Every fusion change needs a test in [lib/tree/graph.test.ts](lib/tree/graph.test.ts).
- Fused ids must be deterministic (smallest member id) so output never depends on input order. There is a test for this; do not "optimise" it away.
- Relation categories are distinguished by **dash rhythm, not colour** (kin `8 3`, care `9 3 1 3`, social `5 4`, professional `2 4`, other `1 4` -- see [app/globals.css](app/globals.css)). Colour-coding them would break the one-accent rule. All five have an explicit rule, ordered tightest rhythm to sparsest so the dash reads as distance from kinship; each rule sets ONLY `stroke-dasharray`, since weight belongs to closeness and colour to `--color-edge-soft`.
- A new relation kind means three edits, in this order: the `relationKindEnum` member, its `RELATION_KINDS` spec (label, inverse, symmetric, category), and its `.is-<kind>` selector added to that CATEGORY's rule in globals.css. Never a rhythm of its own -- the rhythm names the category, so a per-kind dash would claim a distinction the legend does not make. Skip the spec and `relationLabel()` throws on read.
- **Contrast is a measurement, not a taste call.** Text owes 4.5:1 (WCAG SC 1.4.3) and an edge, ring or arrowhead owes 3:1 (SC 1.4.11) against the surface behind it, so anything drawn with `opacity` has to be scored on the COMPOSITE (`fg*a + bg*(1-a)`) rather than on the token. That is why closeness is stroke weight only, an ended relation gets `--color-edge-past` instead of a fade, and the `.kf-dim` rules sit at 0.5 / 0.6 rather than the 0.28 / 0.25 that took a dimmed name to 2.29:1. Prefer a second token over an opacity: a value can be checked, a composite has to be recomputed every time the backdrop moves.
- **Edge colour is two tokens, and both were verified in the browser rather than in the file.** `--color-edge` (7.50:1) is the family skeleton, `--color-edge-soft` (4.03:1) the relation overlay. The skeleton rule is `.react-flow .react-flow__edge-path`, doubly qualified on purpose: React Flow's stylesheet is imported after globals.css, so a single-class rule loses on source order and the skeleton silently renders in their `#b1b1b7` default. Any new React Flow override needs the same treatment -- read the computed style off a real element to confirm it landed, since the file will look correct either way.
- Private repo, so no Renovate.

## Demo mode

Sample data is reachable before auth exists, following the ledger-sync pattern: ONE UI, two data sources, a flag, and mutation guards. The difference is that Kinfolk renders on the server, so the flag is an httpOnly cookie read in a server component rather than a client store -- which also keeps `lib/tree/sample.ts` out of the client bundle entirely.

- Both paths produce the same `TreeView` ([lib/tree/view.ts](lib/tree/view.ts)), so no component knows which one it is rendering.
- [lib/tree/demo.ts](lib/tree/demo.ts) calls the real `fuseTrees` and `toFlowGraph` rather than shipping pre-computed positions. If fusion breaks, the demo must break too; a demo that cannot fail is a screenshot, not a proof.
- Mine-only mode drops the other tree AND its links, so it is a genuinely smaller dataset rather than the same tree with nodes hidden. That is what a viewer without a share grant would actually get.
- A real session beats the demo cookie, so signing in from inside the demo shows your own (possibly empty) tree instead of silently keeping sample data on screen.

## Status

Built and verified (67 tests, typecheck, lint, build): schema, fusion + layout pipeline, generation bands, relation overlay, server-side contact visibility filtering, canvas with staggered entrance / hover focus / fusion reveal, design tokens, demo mode, `/signin`, `/tree` with both data sources.

Not built yet: the tree editor, invite/share flow, merge-proposal UI, contact and relation editor UI. No migration has been run against a real Neon branch, so `loadTreeView()` is verified by types and unit tests only -- every live check so far has been on the demo path. Sign-in itself is unexercised: it needs `AUTH_SECRET` plus a GitHub OAuth app.
