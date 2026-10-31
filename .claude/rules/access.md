---
paths:
  - "lib/tree/authz.ts"
  - "lib/tree/read-access.ts"
  - "lib/tree/visibility.ts"
  - "lib/tree/*-actions.ts"
  - "lib/tree/sharing.ts"
  - "lib/tree/links.ts"
  - "lib/tree/invite.ts"
  - "lib/tree/contacts.ts"
  - "lib/tree/contact-state.ts"
  - "lib/tree/load.ts"
  - "lib/tree/view.ts"
  - "lib/tree/graph.ts"
  - "app/api/**"
  - "app/contacts/**"
  - "components/contacts/**"
  - "components/tree/SharePanel.tsx"
  - "components/tree/LinkPanel.tsx"
  - "components/tree/NodeAdd.tsx"
  - "components/tree/TreeCanvas.tsx"
  - "frontend/src/shims/**"
  - "tests/database.test.ts"
---

# Read access, write permission and privacy

Moved verbatim from `CLAUDE.md` on 2026-10-31. Loads when a file matching `paths:` is read or edited.

## Gotchas

- **Phone numbers are stored as entered, never normalised.** Relatives abroad have country codes, older records have landlines, and rewriting the string loses information the owner deliberately typed. Dedupe compares trimmed + lowercased values only.
- **An accepted link is symmetric, so the FAR tree's owner loads your tree too.** Their `loadTreeView()` reports `trees: 2`, not 1 -- that is the product working, and the invariant to check is that the far tree arrives at `linked` access with its tree-private contacts stripped, not that it is absent.

## Repo-specific rules

- **Write permission comes from [lib/tree/authz.ts](lib/tree/authz.ts), never `treeAccessForUser()` in [lib/tree/read-access.ts](lib/tree/read-access.ts).** The read helper includes owners, invited viewers, and one hop through accepted links. `editableTreeIds()` requires ownership or an `owner`/`editor` grant; linked access alone cannot edit. A link records shared identity with both owners' consent and preserves each family's source records. `assertSameTree()` still refuses structural connections across trees.
- **Who may READ a graph's access list and who may CHANGE it are different.** Owners and editors see members and pending invites; only the owner invites, withdraws an invite or removes a member (`assertOwnsTree`), because editing the records is not deciding who reads them, and an editor could otherwise remove a co-editor the owner chose. `ShareState.canManage` tells the panel which to draw. Pages can run ahead of Vercel, so the SPA reads a missing `canManage` as the old behaviour (true) rather than showing the owner a read-only panel until the API lands.
- **A relation or union may never straddle two trees.** `assertSameTree()` enforces it, because `person_relations` and `unions` have nowhere to record the other family's consent -- that is what `person_links` is for. Without the check, one user could unilaterally write an edge into somebody else's graph.
- **`editableTreeId` on the view is a RENDERING hint, not a permission.** It decides whether the `+` handles and their strips are drawn (null in demo mode and for a read-only viewer, which hides the editor rather than disabling it -- a disabled control advertises an action that can never work). Every action re-checks server-side, because a value that reached the client is a value the client can change.
