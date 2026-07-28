# Kinfolk

Collaborative family tree maker. Build your own branch, invite relatives, and see what the
combined tree looks like once everyone's branch is stitched together.

Private repo. Not deployed yet.

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

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19, TypeScript strict |
| Database | Neon Postgres via Drizzle |
| Auth | Auth.js v5, GitHub OAuth |
| Graph canvas | React Flow (`@xyflow/react`) with ELK layered layout |
| Styling | Tailwind 4 |
| Motion | Motion 12 |
| Tooling | pnpm, Biome, Vitest |

Same shape as `prod/kalchar`, so the conventions carry over.

## Local dev

```bash
pnpm install
```

Copy `.env.example` to `.env.local` and fill it in, then:

```bash
pnpm db:push
```

```bash
pnpm dev
```

The GitHub OAuth app needs its callback set to `http://localhost:3000/api/auth/callback/github`.

## Data model

Seven tables that matter, in `lib/db/schema.ts`:

- `trees` -- a workspace. One user can own several.
- `people` -- one tree's claim about a human.
- `unions` -- a partnership node. Both partner columns are nullable.
- `union_children` -- child membership, with biological / adoptive / step / foster / guardian role.
- `person_links` -- cross-tree identity assertions, consent-gated.
- `tree_members`, `tree_invites` -- access grants and pending invitations.

Private by default: no `tree_members` row means no access.

## Status

Scaffold. Schema and stack are settled; the canvas, auth wiring, and merge flow are not built yet.
