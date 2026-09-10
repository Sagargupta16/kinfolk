# Kinfolk 0.4.0 review and local verification

Recorded **2026-09-10** on `codex/production-corrections`, based on
`1244783a370cc6382ca0d5ccd6287361de3ef5da` (0.3.3).
Both workspace packages now declare 0.4.0. This report records local verification
before PR publication. No release tag, merge, production deployment, or production
database write was performed during this work.

The initial review identified defects in date preservation, OAuth state validation,
authenticated SPA identity, source-record editing, partnership indexing, parent roles,
and dependency versions. The corrective work also completed record-link consent,
contact editing, and existing-person family connections, then rebuilt the shared
interface. Four agents contributed backend review, UI review, documentation, and a
focused layout correction; their changes were integrated and checked together.

## Architecture and boundaries

Kinfolk has two delivery paths: the Vite application on GitHub Pages and the Next.js
application on Vercel. They share the graph domain and workspace components. The SPA
uses serialized API responses and bearer sessions; Next routes use the same services
with cookie sessions. Transport differences require explicit mutation refresh and
date/map revival in the SPA.

A person row remains a record owned by one family. Accepted links combine records for
display without rewriting either source. Read access includes directly granted trees
and one hop through accepted links; it is not an unrestricted traversal. Editing always
resolves an authorized source row. An editor grant does not allow an editor to provide
the owner's consent to a cross-family link.

Unions and child memberships retain their domain meaning independently of rendered
canvas nodes. This matters for childless couples, adopted children, and multiple
parenting groups. Contact visibility is evaluated on the server before values leave
the API. Contact values are displayed on their authorized page, outside the canvas.

The schema is unchanged apart from an exported TypeScript type. No migration was added.
The regression database applies all five existing committed migrations in memory.

## Corrections and completed features

| Area | Result | Evidence |
| --- | --- | --- |
| Profile dates | Exact birth/death dates survive unrelated edits; partial updates honor field presence. | Regression tests; browser rename preserved `1983-02-19`. |
| OAuth and session identity | Missing or mismatched initiating state is rejected; blocked storage is handled; an unsaved bearer is revoked. Authenticated API views include account identity. | Eight OAuth cases; bearer API and browser account controls. |
| Write origins | The action API rejects an untrusted Origin before dispatch. | Real route-handler regression with a session-bearing request. |
| Source records | Fused profiles retain all writable source IDs and grants. Advanced edits use the selected writable source and refresh both runtimes. | Serialization, permission, and browser edit checks. |
| Partnerships and parentage | Childless partners remain in profiles/activity. Biological, adoptive, step, foster, and guardian roles survive loading and fusion. | Domain tests and browser family labels. |
| Quick add | Ambiguous parenting groups require a choice. Concurrent initial additions recheck family state under a tree lock; failed claims leave no orphan record. | Atomic batch rollback and interleaved-race cases. |
| Existing children | Attach/detach with a parent role; reject cross-tree, duplicate, and cyclic connections. | Database cases; browser foster attachment and removal preserved both people and the existing adoptive relationship. |
| Deletion | Claimed/account-linked profiles cannot be deleted. Removing another person preserves the surviving parent's children and clears a deleted root pointer. | Database regressions and synthetic browser deletion. |
| Record links | Propose, consent as the other owner, reject, withdraw, and unlink. Pending links grant no access; new proposals cannot reuse stale consent. | Database permissions/CAS cases; browser owner switch, accept, and unlink without source-record loss. |
| Contacts | Add, edit, choose audience, and confirm removal on an authorized contact page. | Database validation/visibility cases; browser create/edit/remove round trip. |
| Invitations | Claim and membership creation are atomic. Withdrawal cannot revoke a previously claimed invitation. | Rollback and stale-decision cases. |
| Forms and async state | Failed submissions retain drafts, submitter decisions are preserved, stale requests are ignored, and form state follows the selected record. | UI review and synthetic authenticated flows. |
| Layout | Isolated people no longer collide with a shifted childless couple after household alignment. Existing family geometry and fixed node dimensions are retained. | Seven layout cases, additional synthetic variations, and a browser reload of the original seven-person reproducer. |
| Dependencies | Next.js 16.3.4 and patched Sharp, preserving the compatible Nano ID override. | Frozen install, both builds, full and production dependency audits. |

## Interface and motion

The shared interface follows the current local portfolio-react implementation and its
project rules: opaque surfaces, restrained blue accents, separate light/dark tokens,
and locally served Bricolage Grotesque, Inter, and JetBrains Mono.
[The design brief](experience-design.md) records the research inputs and decisions.

Tree, People, search, and adding a relative are the main actions. Profiles use Family,
About, and Contact sections. Canvas arrangement, card density, activity, and advanced
connections live under Options. Sharing and record linking have separate, named flows.
Optional form fields are disclosed as needed.

The public family illustration assembles in relationship order. Menus and panels use
short transform/opacity transitions. Full/Reduced motion is explicit and persistent;
Reduced removes decorative movement and animated viewport travel. Canvas node sizes
remain stable. Mobile Options clear the toolbar, and visit history no longer obscures
the selected person above the profile sheet.

## Final local checks

Checks ran on Windows with Node 26.4.0 and pnpm 11.10.0. The configured Linux/Node 22
remote CI result is reported separately on the pull request.

| Check | Result |
| --- | --- |
| Frozen workspace install | Passed with the existing pnpm store; no lockfile mismatch. |
| Biome | Passed, 135 files. |
| Vitest | **74 passed across six files**: database 29, records 9, family 12, OAuth 8, production safeguards 9, layout 7. |
| Strict TypeScript | Both projects passed; Next production build also completed its TypeScript check. |
| Next production build | Passed with database/OAuth variables explicitly empty and a local dummy auth secret. |
| Vite Pages production build | Passed with `/kinfolk/` base and the configured API origin. |
| Dependency audits | Full and production-only audits both reported no known vulnerabilities at the time of checking. |
| Built CSS | No obsolete Tailwind variable shorthand found in either output. |
| Pages artifacts | 27 manifest entries, 28 referenced files, no missing files, no source maps; `404.html` is identical to the app shell. |
| Pages probe | `check-production.mts --spa` passed against the final local artifact with expected commit `development`, including the tree deep link, lazy canvas, fonts, CSS, and theme script. |
| Diff hygiene | `git diff --check` passed. The user's pre-existing `next-env.d.ts` content was preserved. |

The final Next build and current Vite source were checked in a real browser at
1440 x 900 and 375 x 812 in both light and dark themes. All eight combinations had
117 people, 151 nodes, 34 junctions, and 150 family edges, with zero invalid paths,
person overlaps, junction/person overlaps, or document-level horizontal overflow.
No contact values appeared on the canvas.

The broader interaction pass covered Cards/Rows/Dots, Tree/Orbit, the SPA 3D option,
descendant collapse/expand, keyboard search, profile sections, People, activity, theme
changes without viewport movement, and Full/Reduced persistence. The mobile profile
sheet remained 55dvh and left the selected card visible above it. Fresh checked flows
had no browser warning/error entries.

Authenticated browser writes ran only against synthetic accounts and an in-memory
PGlite database through the real route handlers and Neon HTTP batch adapter. The
fixture loaded committed migrations, used `.invalid` email addresses, disabled
environment-file loading, and made no real OAuth exchange or production database call.
This exercised profile editing, adding a parent, link proposal/acceptance/unlinking,
contact editing/removal, and attaching/detaching a foster child.

The local Next production server correctly returned 401 for protected API reads and
307 from the signed-out tree to sign-in. With database and OAuth configuration
deliberately absent, `/api/health` returned a generic, uncached 503 with no family data.
That verifies failure behavior; it does not establish production readiness.

## Deployment safeguards and remaining work

CI now runs the isolated suite and dependency audit. Deployment checks wait for the
expected serving commit and validate API identity, required schema, auth configuration,
protected reads, sample data, and Pages assets. Missing required production settings
fail verification. The Pages API origin and CSP use the same validated value.

Before release, the final commit must pass remote CI and the serving-commit checks on
both deployed surfaces. A real GitHub sign-in and authorized smoke check are still
required after deployment; provider metadata cannot prove a complete OAuth flow.
No production migration, credential validation, or live release verification was run
for this branch. See [DEPLOYMENT.md](DEPLOYMENT.md).

Photo upload is the remaining requested feature awaiting the user's required approval
of the external storage/authentication flow. Private Vercel Blob with authorized API
reads and rotating Vercel OIDC credentials was proposed; no SDK, credentials, or
placeholder upload workflow was added. Avatars continue to use initials.

The Vite main entry is approximately 190 kB minified / 60 kB gzip, with the workspace
loaded separately at 472 kB / 145 kB gzip. ELK remains a separate lazy chunk of about
1.43 MB / 442 kB gzip and emits a size warning. This work does not claim large-graph
performance, full assistive-technology coverage, real-device touch testing, or a user
study. The activity feed is still a derived recent-history view, not a durable audit log;
biography and location do not acquire per-field contact-style privacy controls.
