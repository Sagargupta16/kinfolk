---
paths:
  - "lib/tree/view.ts"
  - "lib/tree/serialise.ts"
  - "lib/tree/load.ts"
  - "lib/tree/demo.ts"
  - "lib/tree/kinship.ts"
  - "lib/tree/relatives.ts"
  - "lib/tree/feed.ts"
  - "app/api/tree/**"
  - "frontend/src/App.tsx"
  - "components/tree/PersonNode.tsx"
  - "components/tree/PersonDetail.tsx"
  - "components/tree/FeedPanel.tsx"
  - "tests/records.test.ts"
  - "tests/family.test.ts"
---

# TreeView, the JSON boundary and kinship

Moved verbatim from `CLAUDE.md` on 2026-10-31. Loads when a file matching `paths:` is read or edited.

## Key files

- [lib/tree/relatives.ts](lib/tree/relatives.ts) -- one person's family in ROLES (parents, partners, children, siblings, relations), for the detail panel. Distinct from kinship.ts, which answers what somebody is to the VIEWER: open your grandmother's panel and it must list HER children, not yours.
- [lib/tree/feed.ts](lib/tree/feed.ts) -- `familyFeed()`, the family activity feed as a pure derivation over row timestamps the `TreeView` already carries (earliest source `createdAt`, latest `updatedAt`, a union's `createdAt`) -- no events table, no schema change, capped at 80

## Gotchas

- **The JSON boundary owns Date revival (0.2.3).** 0.2.2 broke the prod SPA: [lib/tree/feed.ts](lib/tree/feed.ts) called `.getTime()` on timestamps that arrive from the JSON `/api/tree` response as ISO STRINGS, so `familyFeed()` threw inside a render-path `useMemo` and the canvas never mounted -- while the server-rendered app, which never crosses JSON, worked perfectly. The fix (0.2.3): `parseTreeView()` in [lib/tree/serialise.ts](lib/tree/serialise.ts) revives every flattened timestamp -- person `createdAt`/`updatedAt`/`verifiedAt` on `primary` AND every source row, contact stamps, union `createdAt` -- so a parsed view is indistinguishable from a served one. The rule: any new `Date` field added to `TreeView` MUST be revived in `parseTreeView`, and downstream code may then assume real `Date` objects. Do NOT add per-consumer defensive parsing: a consumer that copes with strings beside one that does not is the same invisible drift as a serialiser disagreeing with its parser.
- **`view.kinship` is a `Map`, not a record.** `kinship[id]` type-checks (index signatures on a Map object) and returns `undefined` for every id, so an assertion written that way passes vacuously against an empty expectation. Always `kinship.get(id)`.
- **Kinship is walked from the graph, never guessed from `sex`.** `sexEnum` includes `"other"` and defaults to `"unknown"`, so `kinship.ts` returns neutral terms ("parent", "sibling") when the stored value cannot name a gendered one. Guessing to get a nicer word would assert something nobody recorded, and it is also why the gender-required layout libraries were rejected.
- **An inferred kinship is drawn a step fainter than a proven one.** `via: "in_law"` and `via: "relation"` are read off a partner's line or a stored relation rather than proven by the ancestor walk, so they get `text-ink-faint` where a walked term gets `text-ink-muted` -- the same how-firmly-drawn-tracks-how-well-known hierarchy as the provenance tick.
