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
- [app/demo/page.tsx](app/demo/page.tsx) -- combined-vs-mine-only demo, runs on `lib/tree/sample.ts`, no database
- [app/api/auth/[...nextauth]/route.ts](app/api/auth/%5B...nextauth%5D/route.ts) -- Auth.js handler
- [auth.ts](auth.ts) -- Auth.js config

## Key files

- [lib/db/schema.ts](lib/db/schema.ts) -- the brain. Read this before touching any data logic.
- [lib/tree/graph.ts](lib/tree/graph.ts) -- fusion (union-find) plus React Flow projection. Pure, no browser or DB deps.
- [lib/tree/layout.ts](lib/tree/layout.ts) -- ELK layered layout, node dimension constants
- [components/tree/TreeCanvas.tsx](components/tree/TreeCanvas.tsx) -- canvas, owns layout-on-data-change and nothing else
- [app/globals.css](app/globals.css) -- design tokens; do not hardcode colours in components

## The data model, in three sentences

Read this before adding a table or a query -- most "obvious" schema changes here are wrong.

1. **A family tree is a DAG, not a tree.** Two edge kinds (partner, parent-child), and the same human can be described by several users independently.
2. **Parentage hangs off a `unions` row, never a (father, mother) column pair.** Remarriages, half-siblings, single parents, and adoption then fall out for free instead of each needing a special case. A child can belong to two unions (birth and adoptive), which is why parentage is not a column on `people`.
3. **`people` is a claim, not a person.** "Your grandfather and my grandfather are the same man" is a consent-gated `person_links` row, never a destructive rewrite -- both owners keep their rows and unlinking restores separate views.

## Gotchas

- **Auth.js Drizzle adapter matches account columns by TS property name in snake_case.** `refresh_token`, `access_token`, `expires_at`, `token_type`, `id_token`, `session_state` stay snake_case in [lib/db/schema.ts](lib/db/schema.ts) even though the rest of the schema is camelCase. `expires_at` must be `integer` (OAuth epoch seconds), not a timestamp. Renaming them to camelCase produces a `DefaultPostgresAccountsTable` type error.
- **`experimental.useTypeScriptCli: true` in [next.config.mjs](next.config.mjs) is load-bearing.** TypeScript 7 removed the compiler API Next reaches for directly; without the flag dev boot throws "TypeScript 7.0.2 does not provide the compiler API required". Remove it once Next supports TS 7 natively.
- **pnpm 11 reads build-script approval from [pnpm-workspace.yaml](pnpm-workspace.yaml) (`allowBuilds:`), not `package.json`.** A `pnpm.onlyBuiltDependencies` field in package.json is silently ignored and installs fail with `ERR_PNPM_IGNORED_BUILDS`.
- **Dates are `date`, never `timestamp`.** A birthday has no timezone; storing it as an instant shifts people across midnight depending on who reads it. Fuzzy dates go in the separate `*Approx` text columns ("about 1890").
- **`unknown` is a real stored value**, not a missing one. Genealogy is mostly incomplete data and forcing a guess corrupts the record.
- **Only accepted links reach `fuseTrees()`.** A pending proposal must never change what anyone sees; callers filter on status.
- **`next-env.d.ts` is excluded from Biome.** Next regenerates it with CRLF on every dev boot, so formatting it just loses the race. [.gitattributes](.gitattributes) pins LF for everything else.
- **React Flow error#004 ("parent container needs a width and a height") is not always noise.** While the container measures 0x0 React Flow never measures nodes, so edges render as an empty container. Framing keys off `useNodesInitialized`, not `requestAnimationFrame`, for exactly this reason.

## Repo-specific rules

- Design follows the `design` skill's taste-2026 module: near-black canvas (never `#000`), monochrome token stack plus ONE accent (warm amber, deliberately not product blue), 1px hairlines instead of heavy shadows, mono + `tabular-nums` for metadata and numbers, 44px minimum hit targets, ease-out under 300ms, mobile-first.
- Keep graph maths in `lib/tree/` with no React or DB imports so it stays unit-testable. Every fusion change needs a test in [lib/tree/graph.test.ts](lib/tree/graph.test.ts).
- Fused ids must be deterministic (smallest member id) so output never depends on input order. There is a test for this; do not "optimise" it away.
- Private repo, so no Renovate.

## Status

Scaffold. Built and verified: schema, fusion + layout pipeline (15 tests), canvas, design tokens, demo route.

Not built yet: `/signin` page (referenced by [auth.ts](auth.ts)), the tree editor, invite/share flow, merge-proposal UI, DB-backed data loading. No migration has been run against a real Neon branch.
