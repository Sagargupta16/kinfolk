# Kinfolk

Collaborative family graph. Keep your own record, invite relatives, and join matching
people without overwriting either family's account.

**[sagargupta.online/kinfolk](https://sagargupta.online/kinfolk/)** -- the public SPA.
**[kinfolk-neon.vercel.app](https://kinfolk-neon.vercel.app/demo)** -- the API and
server-rendered fallback, with a sample tree you can explore without an account.

Version **0.4.0 is unreleased**, prepared on **2026-09-10** on
`codex/production-corrections`. This branch adds a simpler family workspace,
consent-based record linking, private contact editing, and stronger safeguards for
family changes and deployment verification. These changes have not been deployed.
The [review and verification report](docs/verification-0.4.0.md) records the fixes,
74 passing regression cases, browser checks, and remaining release steps.

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

Both frontends share a family atlas with light and dark themes, locally served fonts, blue
actions, and purposeful motion. Choose **Tree** for the family structure or **People**
for a searchable directory. Profiles separate **Family**, **About**, and **Contact**.
Appearance includes a persistent Full/Reduced motion choice, with Full as the default.

Select a person, then use **Add relative** to add a parent,
partner, sibling, or child in context. **Options -> Connect existing people** adds
connections between recorded people and attaches or detaches existing children with
explicit parent roles. If two people are already immediate family or share another connection,
Kinfolk requires a second confirmation. A connection can be removed from the person's
**Connections** section without deleting either person or changing structural family links.

Contact values stay on a separate authorized page. **Share** manages invitations;
**Link family records** in the account menu proposes a match for the other owner's consent.
Original records survive linking and unlinking. [Design notes](docs/experience-design.md)
explain the research and the adapted portfolio-react visual direction.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19, TypeScript strict |
| Static frontend | Vite 8 + React 19, sharing the graph components and domain logic |
| Database | Neon Postgres via Drizzle |
| Auth | Auth.js v5, GitHub OAuth |
| Graph canvas | React Flow (`@xyflow/react`) with ELK layered layout |
| Styling | Tailwind 4 with shared light/dark family-atlas tokens |
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

Copy `.env.example` to `.env.local` and configure a separate development database or
branch, then create its schema:

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
pnpm lint
pnpm test
pnpm typecheck
pnpm --dir frontend typecheck
pnpm build
pnpm --dir frontend build
```

The regression suite uses synthetic records and an in-memory PGlite database running
the committed migrations. It covers OAuth state, exact dates, family roles, authorization,
atomic writes, record-link consent, contacts, and deployment probes. It needs no Neon
credentials and makes no production writes.

## Data model

Seven tables that matter, in `lib/db/schema.ts`:

- `trees` -- a workspace. One user can own several.
- `people` -- one tree's claim about a human.
- `unions` -- a partnership node. Both partner columns are nullable.
- `union_children` -- child membership, with biological / adoptive / step / foster / guardian role.
- `person_relations` -- every non-hierarchical connection (cousin, friend, colleague, mentor).
- `person_links` -- cross-tree identity assertions, consent-gated.
- `contact_details` -- one row per channel per person, each with its own visibility.

Plus `tree_members` and `tree_invites` for access grants and pending invitations. The
auxiliary `people_creation_budgets` table stores only per-tree counters used to reserve
creation capacity atomically; it contains no family records.

Access comes from tree ownership, an invitation that grants membership, or one hop
through an accepted record link. Pending proposals grant no access, and linked viewing
does not grant editing. Contact values are filtered server-side by audience and stay
off the canvas.

## Deployment

GitHub Pages builds `frontend/` and serves the public SPA at
[sagargupta.online/kinfolk](https://sagargupta.online/kinfolk/). It reuses the same graph
components and domain code as the Next app, then calls the JSON API on Vercel. Pages uploads
only the generated `frontend/dist` artifact, and production source maps are disabled.

Vercel serves the API, OAuth exchange, database writes, and the server-rendered fallback at
[kinfolk-neon.vercel.app](https://kinfolk-neon.vercel.app/). The SPA keeps its bearer token
in `sessionStorage`; the Vercel app keeps the stronger httpOnly-cookie flow available. This
split is necessary because Pages cannot run Auth.js, query Neon, or execute server actions.

The unreleased branch adds `/api/health` to check database connectivity and required
schema columns, plus authentication configuration. Release probes require the expected
serving commit and verify protected routes, the sample API, and Pages assets.
An authentication-provider response alone does
not prove database readiness. `DATABASE_URL` is a manually configured encrypted
Vercel variable pointing at the existing Neon project; the native integration was removed
after it provisioned a separate empty database.

Details in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Changes are in
[CHANGELOG.md](CHANGELOG.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow. Do not put real family
records, credentials, environment files, database dumps, or local MCP configuration in a
commit. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Kinfolk is available under the [MIT License](LICENSE).

## Status

Implemented and locally verified in the working branch, pending release:
fusion across trees, the layered pedigree with
sibling bars and generation bands, an orbit arrangement, kinship terms on every card,
reveal-on-focus relations, light and dark themes, person cards,
expand and collapse, the detail panel and family feed as responsive reading sheets,
search, a People directory, view options, a census-driven legend, quick add by
relationship, precise removal of non-structural connections, person editing, sign-in,
sharing by invite, record-link proposals and consent, private contact editing, deletion
of unclaimed records, attaching and detaching existing children with explicit parent roles,
and demo mode.

Photo uploads still need an approved private-storage provider and authentication flow.
Avatars use initials. Profiles linked to an account cannot be deleted; other deletion
flows preserve the surviving parent's children and require confirmation.
