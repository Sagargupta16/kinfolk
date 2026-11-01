---
paths:
  - "lib/db/**"
  - "drizzle/**"
  - "drizzle.config.ts"
  - "lib/tree/relations.ts"
  - "lib/tree/*-actions.ts"
  - "lib/tree/provision.ts"
  - "lib/tree/oauth-session.ts"
  - "lib/tree/graph.ts"
  - "auth.ts"
  - "scripts/check-migrations.mts"
  - "tests/database.ts"
  - "tests/database.test.ts"
---

# Database and stored relations

Moved verbatim from `CLAUDE.md` on 2026-10-31. Loads when a file matching `paths:` is read or edited.

## Gotchas

- **Neon HTTP supports atomic `db.batch()` transactions, but not interactive `db.transaction()` callbacks.** The original quick-add used the unsupported callback API and failed at runtime despite type-checking; the removed live smoke script caught that defect. In 0.4.0, related writes use `db.batch()` so an error rolls back the batch. Keep race checks inside that transaction: claim a partner slot conditionally, lock the tree before checking child ancestry, and clean up a lost claim inside the same batch. The isolated PGlite suite exercises these paths through the Neon HTTP adapter. Never replace a batch with separate writes or broad compensating deletes.
- **Auth.js Drizzle adapter matches account columns by TS property name in snake_case.** `refresh_token`, `access_token`, `expires_at`, `token_type`, `id_token`, `session_state` stay snake_case in [lib/db/schema.ts](lib/db/schema.ts) even though the rest of the schema is camelCase. `expires_at` must be `integer` (OAuth epoch seconds), not a timestamp. Renaming them to camelCase produces a `DefaultPostgresAccountsTable` type error.
- **Directed relations are stored one way only.** "mentee" is not a stored value; it is the `mentor` row read from the other end via `relationLabel()`. Adding an inverse enum member would let the same fact exist as two rows with nothing to reconcile them.
- **Symmetric relations get id-sorted endpoints via `canonicalPair()`.** That is what makes the unique index able to reject a duplicate friendship recorded from either side. Directed kinds keep caller order, because A holds the role. Never insert a relation without going through `canonicalPair()`.
- **Self-relations are blocked in application code, not by a constraint.** Drizzle cannot express a CHECK inside an index, so `personAId <> personBId` is the caller's job. Fusion can also *create* a self-loop after a merge; `fuseTrees()` drops those.
- **`lib/db/client.ts` must stay importable with no `DATABASE_URL`.** Next collects page data by importing every route's module graph, so throwing at module scope fails `pnpm build` on a fresh clone. The client is always constructed for real and pointed at a placeholder URL whose queries throw a message saying what to do. A lazy Proxy is not an option: the Auth.js Drizzle adapter type-checks the instance it is handed at import time.

## Repo-specific rules

- A new relation kind means three edits, in this order: the `relationKindEnum` member, its `RELATION_KINDS` spec (label, inverse, symmetric, category), and its `.is-<kind>` selector added to that CATEGORY's rule in globals.css. Never a rhythm of its own -- the rhythm names the category, so a per-kind dash would claim a distinction the legend does not make. Skip the spec and `relationLabel()` throws on read.
