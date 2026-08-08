# Kinfolk

Collaborative family graph. Keep your own record, invite relatives, and join matching
people without overwriting either family's account.

**[sagargupta.online/kinfolk](https://sagargupta.online/kinfolk/)** -- the public SPA.
**[kinfolk-neon.vercel.app](https://kinfolk-neon.vercel.app/demo)** -- the API and
server-rendered fallback, with a sample tree you can explore without an account. Private repo.

Current release: **0.3.0**, the shared archival field-desk redesign.

## Why this is not just a tree widget

A family tree is not a tree. It is a directed acyclic graph, and the interesting problems are
social rather than visual:

- **The same human appears in several trees.** Your grandfather exists in your tree and in your
  cousin's. Both descriptions are legitimate and neither owner should lose their copy.
- **Merging must be non-destructive.** Kinfolk records "person A and person B are the same human"
  as a link that both sides consent to. Nothing is overwritten, and an unlink restores the
  separate views.
- **Parentage hangs off a union, not a parent pair.** Remarriages, half-siblings, single parents,
  and adoption are then ordinary data instead of special cases in the renderer.
- **Most genealogy data is missing or fuzzy.** `unknown` is a stored value, and approximate dates
  ("about 1890") have their own fields rather than being rounded into a lie.

It is also a contact graph, not only a pedigree. Anyone can be a node -- a friend, a
colleague, a neighbour -- and a friendship carries no generation, so it must never reach
the layout engine.

## Interface

Both hosts now use the same archival field-desk system: warm paper in light mode, deep
evergreen in dark mode, editorial folio framing, index-card people, an instrument-like
canvas dock, and opaque reading sheets. The public landing structure lives in
`components/ui/BrandFrame.tsx`; authentication and demo actions remain host-specific
slots, so sharing the design does not blur the Next/Vite runtime boundary.

The visual rework deliberately leaves `NODE_METRICS`, ELK inputs, graph projection,
privacy filtering, API contracts and auth unchanged. Contact values never appear on
cards or in their accessible labels.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19, TypeScript strict |
| Static frontend | Vite 8 + React 19, sharing the graph components and domain logic |
| Database | Neon Postgres via Drizzle |
| Auth | Auth.js v5, GitHub OAuth |
| Graph canvas | React Flow (`@xyflow/react`) with ELK layered layout |
| Styling | Tailwind 4 with one shared archival field-desk token system |
| Motion | Motion 13, for chrome only |
| Tooling | pnpm, Biome |

Same shape as `prod/kalchar`, so the conventions carry over.

The layout stack was measured against the alternatives rather than assumed: `family-chart`
and `relatives-tree` both require a binary gender on every node, which would corrupt a
record whose sex column defaults to `unknown`, and neither models non-family relations.
`d3-flextree` and `react-tree-graph` are strict trees, one parent per node. See CLAUDE.md
before swapping any of it out.

## Local dev

```bash
pnpm install
```

Copy `.env.example` to `.env.local` and fill it in, then:

```bash
pnpm db:push
```

```bash
pnpm dev --port 3007
```

The GitHub OAuth app needs its callback set to
`http://localhost:3007/api/auth/callback/github`.

`DATABASE_URL` must be the **direct** Neon host, not the `-pooler` one: the app is happy
either way over the HTTP driver, but `drizzle-kit push` opens a plain TCP connection the
pooler endpoint will not serve.

Full setup, click by click, is in [docs/SETUP.md](docs/SETUP.md).

## Test

```bash
pnpm typecheck
```

```bash
pnpm lint
```

The unit suite and the live smoke scripts were removed in the 0.2.0 rework, so these two
commands are the whole gate. Graph maths still lives in `lib/tree/` with no React or
database imports -- while the suite existed it found two defects that were invisible on
screen, because a person who vanishes from a canvas does not announce that they were
dropped for the wrong reason. A live smoke script (since removed) caught the one defect
nothing offline could: the Neon HTTP driver has no transaction support, so
`db.transaction()` type-checks perfectly and throws at runtime.

## Data model

Seven tables that matter, in `lib/db/schema.ts`:

- `trees` -- a workspace. One user can own several.
- `people` -- one tree's claim about a human.
- `unions` -- a partnership node. Both partner columns are nullable.
- `union_children` -- child membership, with biological / adoptive / step / foster / guardian role.
- `person_relations` -- every non-hierarchical connection (cousin, friend, colleague, mentor).
- `person_links` -- cross-tree identity assertions, consent-gated.
- `contact_details` -- one row per channel per person, each with its own visibility.

Plus `tree_members` and `tree_invites` for access grants and pending invitations.

Private by default: no `tree_members` row means no access. Contact values are filtered
server-side and never reach the canvas, because a canvas gets screenshotted.

## Deployment

GitHub Pages builds `frontend/` and serves the public SPA at
[sagargupta.online/kinfolk](https://sagargupta.online/kinfolk/). It reuses the same graph
components and domain code as the Next app, then calls the JSON API on Vercel. Pages uploads
only `frontend/dist`, so the private source repository is not published.

Vercel serves the API, OAuth exchange, database writes, and the server-rendered fallback at
[kinfolk-neon.vercel.app](https://kinfolk-neon.vercel.app/). The SPA keeps its bearer token
in `sessionStorage`; the Vercel app keeps the stronger httpOnly-cookie flow available. This
split is necessary because Pages cannot run Auth.js, query Neon, or execute server actions.

Use that hostname, not the other aliases Vercel assigned:
`kinfolk-sagargupta16s-projects.vercel.app` sits behind Vercel's SSO protection and
redirects every visitor to a Vercel login, and `kinfolk.vercel.app` belongs to an
unrelated project.

Both the sample tree and GitHub sign-in work. `/api/auth/providers` returns 200, which is
the canary for a fully configured deployment: it answers 200 only when `AUTH_SECRET` and
the GitHub provider are both present. `DATABASE_URL` is a manually configured encrypted
Vercel variable pointing at the existing Neon project; the native integration was removed
after it provisioned a separate empty database.

Details in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Changes are in
[CHANGELOG.md](CHANGELOG.md).

## Status

Working: the schema on a live Neon branch, fusion across trees, the layered pedigree with
sibling bars and generation bands, an orbit arrangement, kinship terms on every card,
reveal-on-focus relations, archival light and dark themes, index-record person cards,
expand and collapse, the detail panel and family feed as responsive reading sheets,
search, an instrument-style command dock, a census-driven legend, quick add by
relationship, person editing, sign-in, sharing by invite, and demo mode.

Not built: merge-proposal UI, a contact editor form, a person delete form, and attaching
an existing child to a partnership from the UI. Card avatars are initials rather than
photos because there is no signed-URL route yet, and rendering an `<img>` would either
404 on every card or leak a bucket path.
