---
paths:
  - "lib/tree/workspace.ts"
  - "lib/tree/write-form.ts"
  - "lib/tree/links.ts"
  - "lib/tree/link-actions.ts"
  - "components/tree/TreeStage.tsx"
  - "components/tree/TreeCanvas.tsx"
  - "components/tree/NodeAdd.tsx"
  - "components/tree/NodeEdit.tsx"
  - "components/tree/NodeStrip.tsx"
  - "components/tree/PersonEdit.tsx"
  - "components/tree/PersonDetail.tsx"
  - "components/tree/EmptyFamily.tsx"
  - "components/tree/AccountBar.tsx"
  - "components/tree/AccountMenu.tsx"
  - "components/tree/LinkPanel.tsx"
  - "components/tree/FeedPanel.tsx"
  - "components/contacts/ContactWorkspace.tsx"
  - "tests/workspace.test.ts"
  - "tests/write-form.test.ts"
---

# State machines

Written 2026-11-09, when every implicit state machine in the app was inventoried (0.9.0). Loads when a file matching `paths:` is read or edited.

## The rule

**State that has to agree with other state is one transition in one machine, never an effect that patches it afterwards.** Every bug this replaced had the same shape: two pieces of state kept consistent by an effect, a nonce or a hand-written "close the other one" in each handler, and one ordering nobody had patched. A panel reopened itself after arriving from search (a travel request that was never acknowledged); a feed button toggled a rail the viewer could not see (the profile lived in another component); a strip painted over the profile it opened (an effect closed it, for one ordering only); a strip and a profile stacked along the bottom of a phone (the other ordering); the first person was added twice (no state for "saved, waiting for the view").

So, before adding state to a component, ask what it must agree with. If anything:

- Add an EVENT to the machine that owns the other state, and make the rule part of that event's transition. Do not add a `useEffect` that watches one value to set another; that effect runs after both were committed, and it only covers the orderings somebody thought of.
- A machine is a pure function in `lib/tree/` (no React, no DB), returning the SAME object for an event that changes nothing, with a test that asserts its table and, where it fits, a walk over random event sequences checking the invariants.
- One variable with no partner (an open/closed popover, a selected tab) stays plain `useState`. A machine for it is ceremony.

## The machines

- **Workspace** -- [lib/tree/workspace.ts](lib/tree/workspace.ts), held by `TreeStage` above the provider key, read by `TreeCanvas` through the `workspace` prop and changed only through `dispatch`. State: `viewed`, `profile`, `feed`, `strip`, `travel`. Invariants: the strip belongs to the viewed person (a new subject closes it); the strip and the profile never show together (opening either closes the other); the feed waits under a profile or a strip (`feedShown`), and Recent activity always shows it; a travel completes exactly once, when the canvas dispatches `arrived`, and a pick made meanwhile cancels it; `rearranged` (a detail level or arrangement change) closes only the strip, so the profile, the feed and a pending travel survive the remount the way folds and the trail do; `present` drops a profile, edit strip or travel about somebody no longer in the graph. Search opens the profile only on a read-only canvas; the stage decides that (`onFind`), not the canvas.
- **Write form** -- [lib/tree/write-form.ts](lib/tree/write-form.ts), used by the add strip, the edit strip, the profile's edit form and the empty family. Phases `editing -> saving -> done`, `editing -> confirming -> deleting -> done`, a refusal returning to the phase it came from with the error. No delete can be asked for during a save and no save starts during a confirmation; `done` is for a form that waits on screen for the refreshed view. A strip that closes mid-write reports a late failure through `useLateFailure` (NodeStrip.tsx) to the canvas toast.
- **Link proposals** -- `linkDecisions()` in [lib/tree/links.ts](lib/tree/links.ts), the ONE table of who may accept, reject or revoke a link in each status. `linkState` derives the panel's buttons from it and `decideLink` refuses whatever it does not list, so the panel can never offer a decision the server refuses. `LINK_STATUS_AFTER` maps a decision to its status, and `REPROPOSABLE` says which statuses a fresh proposal may replace.
- **Account corner** -- `AccountBar`'s `corner` union: closed, the account menu, the share panel (loading, failed, or ready with an optional failed re-read) or the links panel. One at a time, because all four sit in the same corner: the menu used to open UNDER an open share panel, with Sign out unreachable. `AccountMenu` is controlled for this reason.
- **Contact rows** -- `ContactWorkspace`'s `row`: none, editing one detail (or the new one), or confirming one removal.
- **Profile view** -- `PersonDetail` resets its edit form and section DURING render, against the subject they were set for (`shownFor`), so a profile that moves to somebody else never renders the previous person's form for them. The effect it replaced ran after that render, and a travel arrives outside an input event, so the wrong frame was painted.

## Deliberately not machines

Read before "fixing" one of these.

- **The write choreography** (`writeAnchor`, `pendingBirth`, the glide parity, `createdPersonId` -> `newId`, `updatedId`, `leavingId` in TreeCanvas) is an animation timeline consumed inside the layout effect, documented in node-editor.md. No reachable wrong combination was found, and moving it would mean re-measuring every frame of the storyboard.
- **The relation reveal** (`pinnedId ?? focusedId`) is a precedence, not a machine; see edges.md. Its clean-up effect reconciles with changed data, which is what effects are for.
- **The viewed person's restore** (`viewedSources`, `restoredViewedSources`, sessionStorage) syncs with storage and with new data; it dispatches `view` into the workspace.
- **Already explicit:** the layout `phase` and `layoutEpoch`, the SPA's `Data` union (App.tsx), the search cursor keyed by its query, the Escape stack (escape.ts), `Collapsed` and its toggles, `pushTrail`, theme and motion, the callback screen, sign-out (`useActionState`), the strip's placement (derived from its measurement), the handles' intro window, toasts and flashes on timers, the offline notice, the loading delay, the ELK worker fallback.
- **Kept in the database:** invites (`pending -> accepted | revoked`, expiry derived from `expires_at` in each SQL predicate), provisioning (idempotent repair of a partial first sign-in), the OAuth state token (stateless HMAC). Their transitions are conditional SQL updates, which is the atomic form; a JS table could not be shared with them.
- **Consistent as they are:** LinkPanel's load and notice, SharePanel's method and message, a profile connection's removal.
- **Landing sign-in** has no in-flight state on purpose: a page restored from the back-forward cache after GitHub would come back stuck in it.
