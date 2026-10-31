---
paths:
  - "lib/tree/*-actions.ts"
  - "lib/tree/editable.ts"
  - "lib/tree/person-patch.ts"
  - "lib/tree/kin-plan.ts"
  - "lib/tree/authz.ts"
  - "components/tree/PersonEdit.tsx"
  - "components/tree/NodeEdit.tsx"
  - "components/tree/NodeAdd.tsx"
  - "components/tree/PersonDetail.tsx"
  - "components/tree/TreeStage.tsx"
  - "components/tree/TreeCanvas.tsx"
  - "app/api/action/**"
  - "frontend/src/api.ts"
  - "frontend/src/shims/**"
  - "tests/records.test.ts"
  - "tests/node-editor.test.ts"
  - "tests/database.test.ts"
---

# Editing records and server writes

Moved verbatim from `CLAUDE.md` on 2026-10-31. Loads when a file matching `paths:` is read or edited.

## Key files

- [components/tree/PersonEdit.tsx](components/tree/PersonEdit.tsx) -- the edit form behind the panel's pencil, including your own record: name, birth year, gender (male, female, other, not known), status (living, passed away, not known), and delete. It posts only those keys, so every other column is left as stored

## Gotchas

- **An edit writes to a SOURCE row, never to `FusedPerson.id`.** The fused id is the smallest member id (a uuid comparison, chosen in `fuseTrees` so output never depends on input order), so on a person described by two families it is the FAR family's row about half the time -- and `treeIdForEditablePerson` would refuse the write, telling somebody they may not edit their own record. `editTarget()` in [lib/tree/editable.ts](lib/tree/editable.ts) resolves the contributing row that sits in a tree the viewer may write to. Verified against the exact trap: a merged person with fused id `aaa` (theirs) resolves to `zzz` (mine). It takes a LIST of editable trees rather than the view's single `editableTreeId`, because a viewer can hold grants on several graphs and a merged person can carry a row in more than one.
- **A form must be prefilled from the TARGET row, not from `primary`.** `primary` is whichever contributing row won the display contest (the viewer's own tree if present, else most recently updated), so on a merged person it can hold the far family's values -- and a form prefilled from their row copies their data into yours the moment you press save. A corruption with no visible tell, which is why `editInitialValues()` exists rather than reading `person.primary` at the call site.
- **`updatePerson` patched by KEY PRESENCE, and the version that did not was silently destructive.** It wrote every column unconditionally, and `orNull(form.get("x"))` is null for a field the form never rendered -- so saving a compact edit NULLED `birthFamilyName`, `deathPlace` and `sourceNote`. A birth surname is searchable ([lib/tree/search.ts](lib/tree/search.ts)), so that was data loss on a field the user could not even see. The rule now: an ABSENT key is left alone, a key present but BLANK is a deliberate erasure. That is the only rule under which a partial form is safe, and it lets one action serve a compact quick-edit and a full form. The decision lives in [lib/tree/person-patch.ts](lib/tree/person-patch.ts) so it is pure and could be asserted rather than eyeballed (12 unit tests plus live checks proved birth surname, source note and occupation survive a four-field edit, before the suite was removed).
- **`verification` is not user-editable, and its absence from the edit form is the point.** It is a provenance claim the card renders as a tick, so letting somebody mark their own row `documented` would turn the strongest evidence level into a self-assessment -- which is exactly what the separate `self_confirmed` level already means without overstating it. `treeId`, `claimedByUserId` and the `verified*` columns are omitted for the same reason: a tree id would move a person between graphs.
- **A write action whose every caller refreshes must not `revalidatePath` too.** A server action that revalidates the path being viewed RETURNS the re-rendered page, and the caller's `router.refresh()` then asks for a second render: two `loadTreeView`s and two layouts per write in the Next app. Since 0.8.0 the canvas writes, link decisions and sharing actions leave it to the caller; the API-only writes and the contact actions, whose callers re-read their own state, keep it.
- **A submitted blank enum and an invalid enum are different facts.** Blank means "use the honest default" (`unknown`, or the action's documented narrow default); invalid nonblank input refuses the entire action before the first write. Falling invalid edits back to `unknown` silently erased valid stored facts while reporting success, and letting Postgres reject them turned ordinary validation into a 500. `oneOf()` returns a checked result, and every caller must unwrap it.
- **The SPA and the API deploy separately, so the client posts for BOTH versions.** Pages can serve the new app minutes before Vercel serves the new API, and the previous `addRelative` reads only `givenName` / `familyName`: given only `name`, it stored the placeholder "Child 1" while the toast showed the typed name. Every name form posts the split columns alongside `name`, which the current API lets win. In the other direction `addRelative` refuses `count` other than 1 out loud ("Add one person at a time."), because a tab still open on the batch UI would otherwise get one person and an ok.
- **A bare birth year goes in `birthDateApprox`, never `birthDate`.** `birthDate` is a real `date`, so "1952" is not a value it can hold, and coercing it to 1952-01-01 invents a birthday nobody recorded -- exactly the false precision the separate `*Approx` columns exist for. `birthYearColumns()` also bounds the year (1000-2200), because "19" and "20255" are typos that would be indistinguishable from a real value once stored.

## From the release workflow notes

Person editing shipped 2026-07-31: a pencil in the detail panel header opens a form over the read view. It shipped covering name, birth surname, nickname, gender, living status, birth and death years, birthplace, current place, work, notes and a source note; since 0.6.0 PersonEdit has four controls -- name, birth year, gender and status -- plus delete. It writes through `updatePerson`, which was rewritten to patch by key presence after the old version was found to null three fields it never rendered. Contact VALUES stay out: the panel still shows only which channels exist, because a canvas gets screenshotted and this component cannot tell a screenshot from a private read.
