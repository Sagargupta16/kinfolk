# Kinfolk

Collaborative family tree maker. Build your own branch, invite relatives, and see what the
combined tree looks like once everyone's branch is stitched together.

**[sagargupta.online/kinfolk](https://sagargupta.online/kinfolk/)** -- the landing page.
Private repo.

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

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19, TypeScript strict |
| Database | Neon Postgres via Drizzle |
| Auth | Auth.js v5, GitHub OAuth |
| Graph canvas | React Flow (`@xyflow/react`) with ELK layered layout |
| Styling | Tailwind 4 |
| Motion | Motion 12, for chrome only |
| Tooling | pnpm, Biome, Vitest |

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
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm lint
```

279 unit tests, all offline. Graph maths lives in `lib/tree/` with no React or database
imports precisely so it stays testable -- two defects that were invisible on screen were
found by writing those tests, because a person who vanishes from a canvas does not
announce that they were dropped for the wrong reason.

Two suites need a real database and are deliberately kept out of Vitest, since a suite
that fails on a fresh clone for want of a database tells you nothing about the code:

```bash
pnpm db:smoke
```

```bash
pnpm db:smoke:kin
```

The second one found a defect nothing offline could: the Neon HTTP driver has no
transaction support, so `db.transaction()` type-checks perfectly and throws at runtime.

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

The **landing page** is GitHub Pages, serving `docs/` at
[sagargupta.online/kinfolk](https://sagargupta.online/kinfolk/). Publishing only that one
directory is what lets this repository stay private while the page is public.

The **app** cannot go on Pages. `pnpm build` emits four dynamic routes -- `/tree` reads
Neon per request, `/demo` is a route handler that sets an httpOnly cookie -- and every
write is a server action. Pages serves static files, so the app runs on Vercel and the
landing page links to it.

The Vercel project exists but is not yet connected to the repository, so the app is not
live. Finishing it needs three dashboard steps, none of which can be done through an API:

1. Install the Vercel GitHub App for this private repo, then link it to the `kinfolk`
   project.
2. Set `DATABASE_URL` and `AUTH_SECRET` in Vercel's environment variables.
3. Add the deployment's callback URL to the GitHub OAuth app.

Then set `APP_URL` in [docs/index.html](docs/index.html) and the two app buttons appear.
They stay hidden while it is empty, because a link to a deployment that does not exist is
worse than no link.

Details in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Changes are in
[CHANGELOG.md](CHANGELOG.md).

## Status

Working: the schema on a live Neon branch, fusion across trees, the layered pedigree with
sibling bars and generation bands, an orbit arrangement, kinship terms on every card,
reveal-on-focus relations, light and dark themes, expand and collapse, the detail panel,
search, a census-driven legend, quick add by relationship, person editing, sign-in,
sharing by invite, and demo mode.

Not built: merge-proposal UI, a contact editor form, a person delete form, and attaching
an existing child to a partnership from the UI. Card avatars are initials rather than
photos because there is no signed-URL route yet, and rendering an `<img>` would either
404 on every card or leak a bucket path.
