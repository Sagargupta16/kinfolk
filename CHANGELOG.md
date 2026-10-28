# Changelog

Notable changes to Kinfolk. Newest first.

Dates are absolute. Each entry says what changed and, where it matters, what was
measured to know it was right -- several of the fixes below were invisible to a file
read and only showed up on a live canvas.

## 0.8.0 -- 2026-10-28

A whole-repository audit, every finding fixed, and a sample family of real, public records.
No schema or migration change.

### Security

- **SPA sign-in no longer hands an account to whoever holds its email address.** When no
  account row matched the GitHub id, sign-in matched `users.email` and linked the new GitHub
  identity to that user, so an address that moved to another GitHub account took the family
  with it. Only a user with no GitHub account at all -- the half-written state a failed first
  sign-in leaves -- is repaired now; anything else is refused with a 409, as Auth.js refuses
  the same case.
- **Contact values no longer reach the browser with the tree.** The view (the page props and
  `/api/tree`) carried every value the viewer may see; it now carries only each channel's
  kind, label and visibility. Values load on the contact page alone, as its code always said.
- **Only a graph's owner changes who has access.** Editors could invite, withdraw invites and
  remove members, including other editors. They now see the access list read-only.
- **Writes have ceilings.** 2,000 characters per free-text field and 200 per name; per hour,
  500 partnerships and 500 connections per graph, 50 invites per graph and 100 link proposals
  per proposer; 50 contact details per person.
- The server-rendered sign-in takes only a GitHub address that GitHub has verified. The
  provider's own fallback picked the primary or first address unchecked, and that address
  matches invites.
- A failed query is never rethrown or logged with its bound values -- a phone number, an
  invitee's email, the session token being revoked. Actions log their name and the Postgres
  code; sign-out, provisioning and invite claims log a stage.
- The SPA refuses to render inside a frame, since a meta CSP cannot carry `frame-ancestors`.
- CI checkouts no longer keep the GitHub token, the Pages API origin reaches its script
  through `env`, and the dependency audit fails at `low`, as documented.

### Changed

- **The sample family is real and public**: Queen Victoria's and Christian IX's families from
  Wikidata (CC0), recorded as two trees of 228 records with 12 accepted links where the
  dynasties married into each other, so the canvas fuses them into 216 people and 40
  partnerships, with godparents and divorces. `pnpm sample:build` rebuilds it. An explicit
  `?demo=1` now shows it even to a signed-in visitor, on the page and the API alike, where a
  session used to win and showed their own family under the sample banner.
- **Layout runs in a Web Worker.** ELK is 97% of a layout, so a large family no longer freezes
  the page while it lays out, and one engine is reused instead of built per layout. If the
  worker cannot start, layout falls back to the page thread instead of hanging.
- **Social links is a switch, not a reload.** It only changes what is drawn, so it is client
  state mirrored into the address bar; it used to refetch the tree, rerun the layout and drop
  every fold. "All trees" still reloads, and now keeps the social-links and demo state.
- Sibling brackets run through the middle of the gap between generations, the same distance
  from the parents' row as from the children's. Lanes are no longer capped at three: each
  takes the most families that fit, and spacing shrinks to keep every lane in the gap, so no
  two families ever share a line.

### Fixed

- **Folding works.** Folding someone's ancestors hid nobody whenever they had a sibling (0 of
  176 folds on the sample hid anyone), and folding descendants leaked back through every
  married-in spouse. The walk never enters a folded branch now, and folds and the breadcrumb
  trail survive a change of detail level or arrangement.
- **Lines draw on again.** The draw-on keyframes counted in pixels on paths normalised to a
  length of 1, so every line popped in at its delay; they count in path lengths now.
- Kinship: a divorced or separated partner is an ex-wife, ex-husband or former partner, an
  unmarried one a partner; grandparents and grandchildren by marriage are gendered when sex is
  recorded.
- The profile lists half-siblings, shows a biological father as father rather than
  "father / stepfather", keeps a relation's own label and sorts relations by their stored
  closeness. Each relative row puts the name over its kinship term, so a long term no longer
  leaves a phone eight letters of the name.
- Single-parent partnerships merge transitively across linked records, so one family no
  longer comes out as two junctions sharing a child depending on load order; a couple
  recorded twice keeps the strongest status.
- Deleting a person, or detaching a single parent's last child, removes the partnership it
  leaves empty instead of an orphan dot and a "Choose which family" question later.
- Inviting an existing viewer as an editor upgrades them, where it marked the invite accepted
  and left the role. Expired invites no longer show as pending.
- A link that would make two different people in one family into one person, through a link
  already made, is refused at proposal and again at acceptance.
- Malformed ids, impossible or fuzzy exact dates and blank names are refused with a message
  instead of a 500; re-adding a contact says it is already recorded instead of "saved".
- Sign-in: two first sign-ins racing settle on one user; a `null` body is a 400; GitHub calls
  time out after 10 seconds; a spent code is a 400, a rejected secret or an outage a logged
  502; a failed sign-out is a 500 the SPA reports, keeping the session to retry.
- Sign-up splits a name the canvas way ("Rakesh Kumar Gupta" is Rakesh Kumar / Gupta).
- The add and edit strips focus their name field once on screen. Focus stayed on the `+`, so
  the first letter typed went to the shortcuts -- a "d" changed the detail level.
- Phone: a docked strip follows the keyboard and pans the canvas so its card's `+` stays above
  it; a saved toast moves to the top while a strip is open; the profile sheet takes at most 55%
  of the canvas, not of the screen; the travel buttons are icons; the trail shows the last
  three people; text fields are 16px, so iOS no longer zooms the workspace.
- The search list closes on an outside tap, when focus leaves, and on Escape from anywhere.
- The Viewing flag no longer covers a folded branch's chevron, fold targets grow into the gap
  between generations, and the generation rails sit behind the lines instead of over them.
- Status marks: "not recorded" meets 3:1; living wears no colour in the profile either; the
  legend's samples are drawn from the canvas's own marks.
- The contacts page's Save label was ink on an ink fill; it is readable, and Remove is red.
- Pressed toggles look pressed, the profile form's Save matches the strip's, hover styles apply
  only where something can hover (a tapped `+` stayed lit), floating chrome is opaque, and
  panel headers, close buttons and focus rings match.
- The browser bar follows the in-app Light/Dark choice; the Appearance menu fits a phone.
- SPA: a refresh that fails after a save keeps the canvas and offers a retry; a chunk lost to
  a redeploy reloads once and otherwise shows a reload prompt; requests time out; a response in
  an older shape says the app and server are out of step; a signed-out `/tree` goes to the
  front door instead of the sample; an account with no graph offers the same way forward in
  both runtimes; the first person cannot be added twice.
- Opening a profile or a toolbar popover never leaves a strip painted over it.
- A Vercel preview whose file list was large enough to fill the pipe skipped its build.
- Speed: the tree loads in 4 round trips instead of 6, read actions run their queries
  together, a write in the Next app renders the tree once instead of twice, the zoom no longer
  re-renders the whole canvas every frame, and the sample is built once per server.

### Removed

- Dead code the audit found: `lib/tree/acyclic.ts`, `editablePeople`, `EditButton`,
  `TreeAlone`, `kinshipOf`, `kindsByCategory`, `barCollisions`, `PERSON_WIDTH` and
  `PERSON_HEIGHT`, the unused Drizzle relation definitions, six unused CSS rules, and the
  `export` on 49 declarations nothing else imports. `lib/tree/names.ts` went with the invented
  sample.

### Documentation

- README, CLAUDE.md, the guides and the essay describe the Wikidata sample, the current add
  flow and the measured benchmark; stale version labels, health times and file references are
  fixed, and the architecture diagrams' evidence lines point at the current code.
- Corrected the 0.7.0 entry: the handle pings end about 5.4 seconds after a pick, not inside
  five.

### Verification

- Headless Chromium, on the Next fallback and on the SPA through the JSON API, at 1440x900 and
  375x812 in both themes: 256 nodes, 216 people, 40 junctions and 265 edges on every surface,
  0 broken paths, 0 overlaps, no horizontal overflow, one theme-color tag, and a clean console.
  The layout worker loaded on both, and the production Pages build loaded it from
  `/kinfolk/assets/` under the real CSP; with the worker blocked, layout fell back and still
  drew all 256 nodes.
- Brackets: 0 collisions at every detail level, against 6 to 8 before; 19 of 33 sit exactly in
  the middle of their gap, and every lane stays at least 14px clear of the cards.
- On a phone: the sheet measured 55% of the canvas with the tapped card above it; a `+` at
  y=743 under the docked strip was panned to 674, clear of it at 682; a second add while the
  toast was up left the answer buttons uncovered; the strip's name field had focus.
- Social links switched with no reload and no new request; a fold survived `d`; the search
  list closed on a canvas tap; a failed sign-out showed its message and kept the session.
- Sixteen server checks against the real Drizzle and Neon HTTP path on in-memory Postgres: the
  takeover refused, the account-less user repaired, a sign-in race on one user, the 400 / 502 /
  409 answers, no token in the sign-out failure log, owner-only sharing, the role upgrade, the
  empty-union cleanup, every refusal above, and the sample served for `?demo=1` with a session.
- `pnpm test` 88/88, both typechecks, Biome, both production builds.

## 0.7.0 -- 2026-10-28

Every edit happens on the card, and the tree moves to make room. No schema or migration
change.

### Changed

- **On a family you can edit, a tap only picks a person.** It used to open the profile too,
  a panel of Family, About and Contact sections that covered half a phone, so putting the
  `+` handles on somebody always brought a box of sections with it. A tap now makes them
  the viewed person and pins their relations, and nothing opens. The profile opens from the
  edit strip's Profile button, the People list, the activity feed, or the `p` key; search
  travels and selects without opening it. The demo and other read-only canvases keep
  tap-to-read.
- **The `+` opens a small strip at the card instead of a sheet.** No heading row, no label
  row and no close button: the name field, whose placeholder says whose relative it is
  ("Morgan and Alex's child"), the year, and the two answers. It opens beside the `+` on
  the side the relative goes, flips when that side has no room, follows the card as the
  canvas pans, and docks along the bottom of a phone. The open `+` turns into a cross that
  closes it, as do a tap on the canvas and Escape.
- **A second tap on the picked card edits it in place.** The edit strip holds the name and
  year, Save, Profile, and Delete with its confirm in the same strip. Gender, status and the
  other columns are left exactly as stored, and the full edit form is still in the profile.
  An unchanged save closes without a write; `r` opens the strip from the keyboard.

### Added

- **Motion for every write from the canvas, as one storyboard under 1.5 seconds**, timed
  with svg-forge's short preset. The strip grows out of the `+` on a damped spring and
  folds back into it. Cards that change place glide there from where they were on screen
  while the viewed card holds still. The new relative comes out of the `+` they were added
  from and lands through a 4% overshoot with a ring, and the family lines that moved draw
  back on as the cards come to rest. An edit sweeps a light across its card once, a deleted
  person shrinks away before the record goes, and a refused save shakes the strip. Picking
  a person pops their handles in one after another and pings them three times, ending about
  5.4 seconds after the pick. The Reduced setting makes all of it instant.
- `p` (profile) and `r` (edit in place) shortcuts, listed in the help sheet.

### Fixed

- The hold that keeps the viewed card still through a relayout now moves the viewport in
  the same commit as the new positions. It used to wait for measurement, which left a frame
  of new positions under the old viewport.

### Verification

- On an isolated in-memory database with a synthetic owner, by mouse and by touch: a first
  tap on another card opened nothing and moved the handles there, and a second tap opened
  the edit strip 18px beside the card with no heading and no visible label. A new year saved
  and swept the card. The open `+` turned 45 degrees and its strip opened 18px below it.
  Through a birth, the new card's first frame was centred exactly on the `+` (323, 486) at
  30% scale; it overshot to 198px wide, rested at 191px with transform `none`, and the viewed
  card moved 0px. Delete shrank the card first. Search opened nothing, `p` and `r` opened the
  profile and the edit strip, and a write six seconds after a pick left every handle without
  an animation. On a phone the strip docked 12px from the bottom and sides with no
  horizontal overflow. Under Reduced the strip opened at full scale and the new animations
  ran 0.01ms.
- The read-only demo on both frontends, 1440x900 and 375x812, dark and light (8 runs): 151
  nodes and 150 edges, 0 bad paths, 0 curves, one stroke treatment, 0 overlaps, no handles,
  the feed rendering 80 rows, and no console errors. A tap on the Vite demo still opened the
  profile.
- Biome, both strict TypeScript projects, 88 Vitest cases, both production builds, the
  dead-Tailwind guard, 0 inlined fonts in the Pages build, both dependency audits and
  `git diff --check` pass.

## 0.6.1 -- 2026-10-27

The Pages app no longer logs a Content Security Policy error on every load. No schema, API
or UI change.

### Fixed

- **Fonts are never inlined into the SPA's stylesheet.** Vite inlines any asset under 4 KiB
  as a `data:` URI, and JetBrains Mono's Cyrillic Extended subset is 2028 bytes, so the
  Pages build embedded it in the CSS, where the SPA's `font-src 'self'` policy blocked it on
  every page load, the landing page included, and the face could never load.
  `build.assetsInlineLimit` in `frontend/vite.config.ts` now opts font files out, so the
  subset ships as its own file under `/kinfolk/assets/` and is fetched only when a page asks
  for those characters. The policy stays strict. The Next fallback was never affected: its
  build emits every font as a file.

### Verification

- A production build served by `vite preview` under the same policy, desktop and phone, with
  the demo through the local Next app. On main's config the landing page logged 1
  `font-src` violation, and loading the Cyrillic Extended face was rejected with a
  NetworkError. With the fix: 0 violations, 0 console errors, and the face loads from its
  file. The sample tree drew 117 people and 150 edges in both. The Pages-shaped build has 0
  inlined fonts, was 1.
- Biome, both strict TypeScript projects, 88 Vitest cases, both production builds, the
  dead-Tailwind guard, both dependency audits and `git diff --check` pass.

## 0.6.0 -- 2026-10-27

The family is built from the canvas itself. No schema or migration change.

### Changed

- **Relatives are added from `+` handles on the viewed card.** A `+` above the card adds a
  parent while a parent slot is free, a `+` beside it adds a partner on the side with no
  partner already, and a `+` below it adds a child. A couple shares ONE `+` in the gutter
  under the pair, on the drop line their child will hang from, instead of one under each
  card. A person with a single-parent family keeps a `+` under their own card for it,
  beside any couple's. The handles are drawn for the viewed person only, at the card and
  row levels; the dot overview and the orbit stay read-only. Press `a` to jump to them from
  the keyboard, since they sit after every card in the tab order.
- **One minimal add sheet.** A name (required), an optional birth year, and two answers --
  Father or Mother, Husband or Wife, Son or Daughter -- that are themselves the submit
  buttons, so the press records the relationship and the sex at once. The recorded parent's
  complement is offered first. Enter moves from name to year to the answers and never
  saves, because the first answer would otherwise be chosen for whoever pressed Enter.
  Husband and wife are recorded as married. When two families qualify (birth and adoptive
  parents, two single-parent families) the sheet asks which with nothing pre-chosen, and
  labels them by parents, parentage role and the children already in each.
- **The canvas holds still after an add.** The viewed card stays at the same place on
  screen through the relayout -- measured, a card at (469, 486) was still at (469, 486)
  after its parent was added above it -- so the next `+` is where the last one was, and the
  new card flashes once to show where it landed. A fold that would hide the new person is
  opened, since a written but hidden relative read as a failed save.
- **The edit form is four controls:** name, birth year, gender (male, female, other, not
  known) and status (living, passed away, not known), plus delete. It posts only those keys,
  so every other stored column is left alone, and it posts the name only when it was
  retyped. Not known stays an answer, so a sex or status set by a canvas press can be
  corrected back to unknown.
- **One name field everywhere.** The add sheet, the edit form and the empty-family screen
  take one name, split on its last word into given and family name ("Rakesh Kumar Gupta"
  is Rakesh Kumar of the Guptas; a single word is a given name). The two columns are posted
  alongside, so a page served before the API finishes deploying still saves the name the
  previous API reads.
- **Siblings stand eldest first.** The layout hands ELK a depth-first family order with each
  set of siblings sorted by birth year; people without a year keep their entry order after
  those with one. Eldest-first sibling pairs went 28/48 -> 47/48 on the sample tree,
  16/29 -> 29/29 mine-only and 0/12 -> 12/12 on a family entered youngest first. The
  generation rails print each row's birth-year span ("IV 44 b. 1952-1989").
- **Every family draws the same bracket.** Families wider than 1600px used to fall back to
  per-child curves -- 4 families and 15 child edges on the sample tree -- so the canvas mixed
  straight brackets and fans, and the curves merged a wide family into one bundle. Now there
  are 0 curve paths among the 150 family edges.
- A childless sibling keeps ELK's offset from its nearest sibling with children, and a
  household with neither parents nor children moves to the end of its row. The second fixes
  an unlinked childless couple taking the slot between two sets of grandparents and pushing
  one set away from its daughter.

### Removed

- The nine-role picker, the More-details form (surname, gender, living status, partnership
  status), batches of numbered placeholder children, the toolbar and profile **Add
  relative** buttons, and **Options -> Connect existing people**. The server actions behind
  that panel stay on the action API. `addRelative` now requires a name and adds one person,
  and refuses a batch from a tab still open on the previous version rather than quietly
  adding one of the people it asked for.
- Birth surname, nickname, death year, places, work, notes and source from the edit form;
  their stored values are untouched.

### Documentation

- The README screenshots and both Open Graph cards are recaptured from this build's sample
  tree with `pnpm screenshots --base`, so they show bracket connectors and siblings eldest
  first. The five WebP files total 219 KiB, was 207.
- The README layout benchmark is rerun on the new layout, same machine and Node 26.10. The
  1,000-person median is 5706 ms, with back-to-back runs of 5732 and 6290 ms (the 0.5.0
  table had 8781). ELK is still 98% or more of the time at every size.

### Verification

- Biome, both strict TypeScript projects, 88 Vitest cases, both production builds, the
  dead-Tailwind guard, both dependency audits and `git diff --check` pass. New cases pin the
  model order as a permutation with siblings eldest first, the family choices and their
  distinct labels, the single-parent `+` beside a couple's, a partner `+` kept off an
  occupied side, targets that never cross the generation gap or cover a fold pill, the one
  name field, husband or wife as married, and refusals for a nameless add and a batch.
- Headless Chromium, both frontends, 1440x900 and 375x812, dark and light (12 runs): demo
  canvas 151 nodes and 150 edges in both, 0 bad paths, 0 curves, one stroke treatment at
  rest, 0 card overlaps, 0 junctions on cards, no horizontal overflow, no console errors.
- On an isolated in-memory database with a synthetic account: parents, partners and
  children added by mouse and by touch, kinship read correctly for each ("daughter",
  "father-in-law", "husband"), birth year reordering a child live, the edit form saving
  name, year and status, and `+` targets 44x44 screen pixels at fit zoom on both card levels
  with no fold chevron covered. Zoomed out to 0.52, 0.3 and 0.17, no card's centre is under a
  `+` target: the targets shrink (25x27 at 0.3) rather than reach into the next row. A
  two-family choice had nothing pre-checked, Enter on it saved nothing, and an answer
  pressed without a family was blocked.

## 0.5.2 -- 2026-10-23

The README diagrams redrawn with orrery 0.12.0's 64 px icons. Documentation only; no schema,
API or UI behavior change.

### Documentation

- `docs/diagrams/architecture-*.svg` and `docs/diagrams/release-*.svg` are re-rendered with
  orrery 0.12.0, which draws icon tiles at 64 px instead of 48. The architecture spec is
  unchanged (909 x 789, `orrery review --width 880` scores 99.6).
- The release spec gains `layout: { spacing: compact }`: with the bigger tiles it had grown to
  652 x 1279, and the compact gaps bring it back to 628 x 1165 (score 99.3, up from 99.2 with
  normal gaps). Nodes, edges and labels are unchanged; `orrery verify` still finds all 13
  evidence entries. The README's release `<img>` width follows the new canvas (684 to 628).

## 0.5.1 -- 2026-10-21

Architecture and release diagrams in the README. Documentation only; no schema, API or UI
behavior change.

### Documentation

- The README's Architecture section shows an [orrery](https://github.com/Sagargupta16/orrery)
  diagram in place of the Mermaid sketch: the browser, the Vite SPA on GitHub Pages, the
  Next.js JSON API and server-rendered fallback on Vercel (sin1), GitHub OAuth and Neon, with
  the bearer token and httpOnly cookie paths drawn separately. It covers everything the
  Mermaid version showed.
- The Deployment section gains a release diagram: a push to main starts the Vercel build,
  `deploy.yml` (migrate Neon, then wait for the serving commit) and `pages.yml` (build,
  publish and verify the SPA) independently, and `health.yml` probes both surfaces nightly.
- Both specs live in `docs/diagrams/*.yaml` with `evidence:` on every node and edge;
  `orrery verify` finds all 26 entries, `orrery validate --strict` reports 0 errors and 0
  warnings, and `orrery review --width 880` scores 99.6 and 99.4 in both themes. Each
  renders to a light and a dark SVG for the README's `<picture>` blocks.

## 0.5.0 -- 2026-10-18

Showcase, link previews, a self-hosting path and the first measured layout numbers. No
schema, API or canvas behavior change.

### Added

- README screenshots of the live sample tree: the Tree view in dark and light, a person
  profile, the People directory, and the phone bottom sheet. `pnpm screenshots`
  (`scripts/capture-screenshots.mts`, Playwright plus sharp) recaptures all of them from the
  Pages app or any `--base` URL, always on the read-only `?demo=1` sample. The five WebP
  files total 207 KiB.
- Open Graph and Twitter card metadata on both frontends, so a shared link unfurls with a
  title, description and image instead of a bare URL. The 1200x630 card is composed by the
  same script from the canvas strip and the app's own fonts and tokens. Next serves it
  through the `app/opengraph-image.png` file convention with `metadataBase` taken from
  `VERCEL_PROJECT_PRODUCTION_URL`; the Pages `index.html` points at
  `https://sagargupta.online/kinfolk/og-image.png`. Checked on a local production build:
  `/` emits `og:image` and `twitter:image` at 1200x630 and `/opengraph-image.png` returns
  200 `image/png`.
- A Deploy with Vercel button that clones the repository, provisions a Neon database through
  the Marketplace integration and prompts for `AUTH_SECRET`, `AUTH_GITHUB_ID` and
  `AUTH_GITHUB_SECRET`. [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md) covers the OAuth app,
  the one-time `pnpm db:migrate`, the `/api/health` check, and which workflows a copy should
  configure or disable.
- `pnpm bench:layout` (`scripts/bench-layout.mts`) times the full layout on the sample and on
  seeded generated families, and times `elk.layout()` on its own to split the total. On an
  i9-14900HX laptop under Node 26.10, three back-to-back runs gave medians of 138 to 188 ms
  for the 117-person sample, 232 to 291 ms for 200 people and 8,781 to 9,752 ms for 1,000
  people (7 timed runs each). ELK is 97% or more of the time at every size; Kinfolk's own
  passes take 26 to 32 ms at 1,000 people. That makes moving ELK into a Web Worker the next
  performance fix.
- [A family tree is not a tree](docs/a-family-tree-is-not-a-tree.md), a write-up of the union
  data model, consent links fused by union-find at read time, and the layout library choice.

### Dependencies

- `playwright` and `sharp` as root dev dependencies, for the capture script only. Neither
  reaches either production bundle.

## 0.4.1 -- 2026-10-18

A dependency and documentation refresh. No schema, API or UI behavior change.

### Security and dependencies

- Next.js 16.3.4 to 16.3.8 (#45), the patch release Renovate's security branch was
  targeting.
- Renovate adopted through the shared preset (#44). Major updates wait for its scheduled
  monthly group.
- In-range bumps in both workspace packages, kept in lockstep: Next 16.4.2, React and
  React DOM 19.3.1, React Flow 12.12.0, lucide-react 1.59.0, Vite 8.3.4,
  `@vitejs/plugin-react` 6.1.2, Biome 2.5.15, Vitest 5.0.5, drizzle-orm 0.45.4,
  `@neondatabase/serverless` 1.2.0, tailwind-merge 3.7.0, PGlite 0.5.10, drizzle-kit
  0.31.11, tsx 4.23.15 and the React and Node type packages. The PostCSS override floor
  moves to 8.5.30 so the direct and nested copies resolve to the same release.
  Motion 14 and dotenv 18 are majors and stay with Renovate's group.
- Measured after the bumps: Biome over 136 files, both strict typechecks, 74 of 74
  regression cases, `pnpm audit --audit-level high` with no known vulnerabilities, and
  both production builds.

### Documentation

- README, CLAUDE.md, SECURITY.md and the docs/ headers now say 0.4.0 is released and
  deployed. They had still described it as an unpublished branch. On 2026-10-18
  `/api/health` returned `ready`, version 0.4.0, commit `8eb9b35`.
- README gains CI, health and license badges, a link to the sample tree, an architecture
  diagram and a short list of the key design decisions.

## 0.4.0 -- 2026-09-10

Released and deployed on 2026-09-10. The Deploy workflow applied migrations and passed its
serving-commit and readiness checks; Pages published with the HTTPS verification fix (#43).
Local checks before release passed 74 regression cases, both builds, and both dependency
audits. See the [verification report](docs/verification-0.4.0.md) for that evidence.

### Added

- Tree and People views, searchable family profiles with Family/About/Contact sections,
  direct sharing, simpler view options, and a shared visual system adapted from portfolio-react.
- Locally served Bricolage Grotesque, Inter, and JetBrains Mono fonts. The family illustration
  assembles in relationship order; new relatives open after saving. Full/Reduced motion
  is explicit and persistent, including canvas travel.
- Record-link proposals, acceptance by the other owner, rejection, withdrawal, and unlinking.
  Both source records remain intact. Only already readable records are offered for matching.
- Private contact pages with add, edit, audience selection, and confirmed removal.
  Existing children can be attached with biological, adoptive, step, foster, or guardian roles;
  removing a parenting connection preserves the child's record.
- A schema-aware readiness endpoint and release checks for the expected Vercel/Pages commit,
  protected routes, sample data, Pages deep links, and emitted JavaScript, CSS, and font assets.
- An isolated regression suite using the real committed schema through PGlite.

### Fixed

- Profile edits preserve exact birth and death dates. SPA OAuth rejects missing or mismatched
  initiating state and handles blocked browser storage without leaving an active orphan session.
- Authenticated API views include account identity, all writable tree IDs, and original union
  metadata. The SPA refreshes after mutations and ignores superseded responses.
- Advanced edits resolve original writable records, childless partners appear in profiles and
  activity, and parent roles survive loading, fusion, and kinship derivation.
- Adding relatives and attaching children use atomic HTTP database batches, with duplicate,
  cycle, partner-slot, and race checks. Ambiguous parenting groups require an explicit choice.
  Initial-family races are rechecked under the tree lock instead of leaving disconnected people.
- Deleting an unclaimed record preserves the surviving parent's children and clears root pointers.
  Account-linked profiles cannot be deleted. Invite claim/withdrawal and link decisions are atomic.
- A real session takes precedence over a leftover sample cookie for writes.
  Contact and family API responses disable caching.
- Search results respond to keyboard activation. Read-only profiles do not offer editing.
  Profile and contact state stays tied to the selected record; failed forms preserve drafts.
- Mobile Options clear the toolbar, and visit history does not obscure the selected card.
  Isolated people remain clear of couples after household alignment.

### Security and deployment

- Updated Next.js to 16.3.4 and the Sharp override to 0.35.4 or newer in the same minor series.
  The existing Nano ID override remains in place.
- CI runs regression checks and dependency auditing. Production verification fails for missing
  configuration instead of reporting skipped checks as a healthy release.
- The action API rejects untrusted request origins before dispatch. A renewed link proposal
  requires fresh consent, and the Pages API origin and CSP share one validated setting.
- Pages verification uses HTTPS when GitHub reports an inherited custom-domain URL as HTTP,
  retaining the reported host and path and all strict readiness checks.
- No new migration is introduced. Photo uploads remain pending approval of a private
  storage provider and its authentication flow.

## 0.3.3 -- 2026-09-02 (the nanoid advisory, and the couple-centering fix ships)

### Security

- **nanoid held at `>=3.3.18 <4`** (GHSA-2v37-7h3g-55p8, Dependabot alert #6, high).
  nanoid below 3.3.18 can loop indefinitely when a custom generator is asked for a
  size of zero. The copy here is transitive -- postcss depends on it -- so the fix is a
  fourth entry in the workspace `overrides` block rather than a bump to anything we
  import. The range is capped below 4 deliberately: nanoid 4+ is ESM-only while postcss
  requires it as CommonJS, and an open `>=3.3.18` resolved to 6.0.1, which is not a
  drop-in. This manual bump supersedes the Dependabot update run that had been failing
  since 2026-08-17.

### Fixed

- **A couple now sits above the middle of its own children.** `alignPedigreeRows()` packed
  each generation independently -- centred on its own ELK extent, at minimum gaps -- and
  never consulted the row below, so the parent-over-children alignment ELK had already
  found was discarded on every layout. Measured on the sample tree, a couple sat a mean
  775px from its children's midpoint (median 600px), and on a real 40-person graph the
  viewer's own parents were 807px right of him and his sisters. Nothing on screen explains
  that drift, so it reads as a rendering fault rather than as a layout choice.

  Rows are now packed deepest-first, each household is placed over its own children, and a
  bidirectional relaxation resolves the row within its minimum gaps. Live DOM on the
  117-person tree: 21 of 34 couples within 10px (was 6), 26 within 200px, mean offset
  192px, median 0, and 0 card overlaps.

  The residual 13 are a geometric limit rather than a defect: the widest row needs
  11228px while the children it must reach span 7854px, so not every couple can be
  centred at once. Each of those sits hard against its neighbours at the exact minimum
  gap. Overlapping cards would be the worse failure, so the gap wins.

- **A one-directional sweep cannot centre a family whose children are to its left.** The
  first version of the fix ordered households by ELK's x while their target came from the
  children below, and those orderings disagree -- one couple sat at x=8098 with children
  at x=5929. Pushing right only then pinned every household in that situation, leaving 16
  of 34 misaligned while the offline arithmetic reported success, because it measured the
  intent rather than the result. The row is now re-ordered to follow its children before
  any gap is enforced, which is also the correct pedigree rule: the row below is final, so
  if one family's children sit left of another's, that family belongs left too.

- **A third gap tier separates sibling groups.** Two tiers put a married couple and a
  family boundary both at 56px, so fourteen aunts, uncles and spouses in one row read as
  one undifferentiated strip and no gap said where one set of siblings ended. Now
  22 / 56 / 141px at the card level, each step roughly 2.5x the last, so the eye groups on
  the largest gap before following any line. The boundary is where the parent union
  changes, which is a fact in the data rather than a heuristic on positions.

- **`MAX_BAR_SPAN` raised 900 -> 1600.** The old value predates parent-over-children
  alignment, when a bar's width was partly drift -- so it rejected genuinely wide families
  and genuinely misaligned ones alike, including a set of FOUR siblings at 1052px, which
  is precisely the case a sibling bracket exists for. 1600 is a little over a 1440px
  viewport, so a surviving bar is one the eye can hold at fit zoom, while a seven-child
  span (4847px on a real graph) still takes the curves.

- **The dot level's gap raised 18 -> 30.** The three tiers are ratios of `gap`, so at 18
  they computed to 20 / 35 / 79 against a 56px card: a partner gap a third of a card wide,
  and no grouping visible at the level whose whole purpose is an overview.

### Verification

- Re-ran after the nanoid override: Biome (106 files), both strict TypeScript projects,
  both production builds, and `pnpm audit --prod --audit-level=low` (no known
  vulnerabilities) all pass, and the lockfile resolves exactly one nanoid at 3.3.18.
- Biome, both strict TypeScript projects, both production builds, the dead-Tailwind CSS
  guard (0 matches), `pnpm audit --prod --audit-level=low`, and `git diff --check` pass.
- Measured on the live canvas at 1600x900, not from a file read: 117 person cards, 150
  edges, 0 NaN paths, 0 zero-length paths, 0 hard-corner paths, 0 card overlaps on real
  rendered boxes, one stroke treatment at rest, and 0 amber family edges.
- Sample-tree regression across `full`, `compact` and `dot`, combined and mine-only: 0
  overlaps and 0 sibling-bar collisions in all six.

## 0.3.2 -- 2026-08-08 (MIT licensing and public release)

### Repository

- Added a root MIT license and matching package metadata, making the terms for use,
  modification, and redistribution explicit.
- Approved public visibility after confirming that the current tracked tree contains no
  live credential or real family record. The owner explicitly accepted that the Git and
  GitHub pull-request history retains the author's public identity and early family-like
  sample names and dates.
- Updated the security policy to direct reports to GitHub's private vulnerability form.
  Runtime behavior and database schema are unchanged from 0.3.1.

### Verification

- Biome formatting/lint, both strict TypeScript projects, both production builds, both
  dependency audits, and `git diff --check` pass.
- The root and frontend package metadata both report version 0.3.2 and license MIT, and
  the current tracked tree remains free of environment files, credentials, database
  exports, local MCP configuration, and real family records.

## 0.3.1 -- 2026-08-08 (profile-first editing and public-release hardening)

### Changed

- Removed standalone person creation from the general editor. New people now start from a
  selected profile through **Add relative**, which records the role and family structure in
  one flow. The advanced sheet remains for connecting people who already exist.
- Added a deliberate second confirmation before recording another non-structural relation
  between people who are already immediate family or already share a different relation.
  An exact duplicate remains an idempotent success.
- New Auth.js cookie sessions and SPA bearer sessions now expire after 7 days instead of
  30. Existing database sessions retain their stored expiry until they end or the user
  signs out.

### Fixed

- Added per-connection removal in a profile's **Connections** section. The graph projection
  now carries the exact relation row and owning tree, the control appears only to an editor
  of that tree, and its confirmation states that neither person nor any parent, child,
  sibling, or partnership link will be changed.
- Production CORS no longer trusts localhost, OAuth token delivery accepts only the exact
  production callback path, and development callbacks exist only outside production.
- Unexpected API and OAuth failures now return generic browser messages and log only a
  non-sensitive stage or operation; SQL, bound values, profile payloads, and nested causes
  are not persisted in platform logs.
- Restored an atomic Postgres-backed per-tree creation budget and response security headers,
  including CSP, clickjacking protection, MIME sniffing protection, a permissions policy,
  a referrer policy, and production HSTS. Migration `0004_dusty_karen_page.sql` adds only
  the counter table and its tree foreign key.

### Repository

- Added `SECURITY.md` and `CONTRIBUTING.md`, repository/homepage/issue metadata, sensitive
  local-file and data-export ignore patterns, and public-safe deployment comments. Ad hoc
  SQL files are ignored while ordered `drizzle/*.sql` migration source remains versioned.
- Removed private-repository claims, local absolute paths, provider resource identifiers,
  and stale operational details from current public-facing guidance. The separately merged
  production record for migration `0003_fearless_mongu.sql` remains documented.
- At the time, no open-source license had been selected. The repository remained
  all-rights-reserved and private pending the owner's license and historical-PII decisions;
  0.3.2 records both decisions and adopts MIT.

### Verification

- Biome formatting/lint, both strict TypeScript projects, the Next production build, the
  GitHub Pages-mode Vite build, both full and production dependency audits, and
  `git diff --check` pass. Both audits report no known vulnerabilities.
- The built Pages artifact uses the `/kinfolk/` base, contains only the production API in
  `connect-src`, has no unresolved CSP marker or source map, and passes the CI dead-Tailwind
  guard. The Next production header set contains CSP, Permissions-Policy, Referrer-Policy,
  nosniff, DENY framing, and HSTS with no localhost source.
- Migration `0004_dusty_karen_page.sql` was generated from the schema and inspected: it
  creates only `people_creation_budgets` and its cascading tree foreign key. Current-tree
  secret and public-metadata scans found no live credential; ignored local environment,
  MCP, and Claude settings remain untracked.

## 0.3.0 -- 2026-08-08 (the archival field-desk redesign)

A deliberately visible frontend release across both permanent hosts. The Next app
and Vite SPA now share one archival field-desk language instead of presenting two
similar but drifting landing pages, while the graph, authentication, API and storage
boundaries remain unchanged.

### Redesigned

- Added a framework-neutral `BrandFrame` shared by the Next and Vite front doors.
  Runtime-specific actions remain slots, so Next keeps server-action demo forms and
  the Pages SPA keeps its browser OAuth flow without duplicating layout or copy.
- Replaced the near-empty landing and sign-in surfaces with editorial folio framing,
  warm-paper and deep-evergreen themes, a cross-reference vignette, shared privacy
  ledger, serif display type, tactile controls and a responsive mobile hierarchy.
- Reworked the tree workspace as a field desk: branded record masthead, compact
  instrument-style command dock, stronger search and demo chrome, and opaque reading
  sheets for detail, feed, editor, legend and sharing.
- Rebuilt the shared pedigree around one durable viewed person. Partner-connected
  people are packed into contiguous households on the same row, parent households rank
  above their children, children descend below one shared junction, and contradictory
  cycles still render without dropping people or changing graph facts.
- Added an explicit amber `Viewing` ticket and history docket, distinct quieter `You`
  identity treatment, and matching minimap/dot states. Search, feed and card travel now
  choose the same durable subject, which survives Cards/Rows/Dots and Tree/Orbit
  remounts and becomes the orbit centre and collapse anchor.
- Structured arrangements no longer allow free node dragging, which could immediately
  violate parent/child ranks and leave rails behind. The mobile viewing docket now has
  a pointer-safe lane beside the command dock.
- Person cards now read as index records with ruled-paper texture, inset keylines,
  editorial names and separated metadata. Their outer `NODE_METRICS` dimensions are
  unchanged, so React Flow, ELK, edge anchors and the minimap still agree.
- Detail and feed surfaces now enter from the right as desktop rails and from the
  bottom as mobile sheets. The mobile height remains 55dvh, touch targets remain at
  least 44px, and the shared Escape stack is unchanged.

### Preserved

- Graph projection, stored facts, kinship, privacy, auth, API, server-action and
  database behavior remain unchanged. Contact values still never reach canvas cards or
  their accessible labels, and CSS-only focus/depth state still stays outside layout
  inputs.
- The layout rework changes only the rendered geometry after ELK: fixed
  `NODE_METRICS`, edge facts, union semantics, edit permissions and schema contracts
  remain intact.
- The dual-host architecture remains permanent: Pages owns the Vite SPA at
  `sagargupta.online/kinfolk`; Vercel owns the API, OAuth exchange, writes and Next
  fallback at `kinfolk-neon.vercel.app`.

### Verified

- The final gate passes Biome formatting/lint, both strict TypeScript projects, the
  Next production build and the Vite Pages build. Vite reports only the existing
  mixed static/dynamic import and large-chunk advisories.
- Fresh Next and Vite runs at 1440x900 and 375x812 in light and dark render 151 nodes
  (117 people plus 34 junctions) and 150 family edges. Every parent card is above
  every child card; Cards, Rows and Dots have zero person-card or junction overlaps
  and zero sampled partner-path/card crossings; all 450 SVG paths are finite; and no
  structured node is draggable.
- Fixed card geometry remains 168x92; Rows remain 148x40 and Dots 56x34. Exactly one
  accessible `Viewing` marker follows Russell Nichols through Cards -> Rows -> Dots
  and Tree -> Orbit. Full SPA navigation remaps that same person from mine-only `m1`
  to combined `c1` and back by source identity rather than losing focus to a fused id.
  The current-person docket and minimap agree with that subject.
- Deferred Orbit travel also succeeds when the target is absent from the old radial
  layout: choosing Niklas Niska (`n15`) rebuilds the orbit around him, opens his detail
  sheet and updates the docket only after the new layout contains him.
- Desktop detail framing leaves the selected card beside the 22rem rail. At 375x812,
  the sheet measures 446.59px (55dvh), keeps the viewed card above it, introduces no
  horizontal overflow, and leaves search, the editable dock and viewing docket in
  clear pointer lanes. The command dock is fully transparent and non-interactive while
  a detail/feed sheet is open. Fresh console runs produced no warnings or errors.

### Deployment result

- Production [Deploy run 31256902754](https://github.com/Sagargupta16/kinfolk/actions/runs/31256902754)
  verified 3/4 committed migrations, applied `0003_fearless_mongu.sql`, then
  complete-checked 4/4 before all public endpoint probes passed. The migration is one
  schema statement creating the unique `people_claimed_user_idx`; it contains no
  genealogy rows or credentials.

## 0.2.4 -- 2026-08-08 (the audit hardening rework)

A comprehensive static and live audit of the graph, editor, both authentication
stacks, and both deployment targets. This reworks the failure-prone hot paths rather
than replacing the ledger-sync architecture: the shared React/domain layer still
ships as a Next app on Vercel and a Vite SPA at `sagargupta.online/kinfolk`.

### Reworked

- Canvas state is split by responsibility. ELK layout now depends only on graph
  geometry and data; depth, coarse-pointer mode, focus and dim/lit classes update
  independently, and those classes are reapplied after a real layout epoch. The
  editable-tree set is memoized, pointer-wash animation frames are cancelled on
  cleanup, and the minimap's stable shape layer no longer redraws with its controls.
- Union projection now merges compatible partial/full partnership records, normalizes
  fused self-partnerships without orphan junctions, and preserves child-bearing
  self-unions as honest single-parent families. Collapse skeletons skip direct
  childless partner edges, radial layout handles an empty ring set, and feed travel
  follows the visible partner instead of a hidden anchor.
- Overlay dismissal is coordinated by one LIFO Escape stack. One key press closes one
  top surface, including account, search, legend, editor, share, feed and person
  panels, instead of every mounted listener reacting at once. Feed/detail travel now
  uses request/ack state so an acknowledged destination cannot reopen itself.
- Editor controls now own stable label ids and valid ARIA relationships; stale relation
  subjects/messages clear when canvas selection clears. Duplicate shortcut handling
  and stale/dead props and comments were removed.

### Fixed

- Every runtime enum boundary now distinguishes a deliberate blank from invalid
  nonblank input. Forged gender, living, partnership, parent-role, contact-kind or
  visibility values refuse the whole action instead of throwing a database 500 or
  silently replacing a valid fact with `unknown`.
- Quick-add validates finite counts and component-accurate years (1000-2200), claims a
  free union partner slot inside the conditional update, and removes its newly inserted
  person if both slots lose a concurrent race. No winner can be overwritten and a
  refused request no longer leaves an orphan card.
- Starter-graph provisioning now retries on every successful Auth.js and SPA sign-in,
  repairs tree-without-self and self-without-root states, and is conflict-safe under
  parallel retries. The starter person reuses the user's UUID so retries also collide
  safely if Vercel promotes before migration `0003`; the migration then enforces at
  most one non-null claimed-self row per user. Root updates remain conditional and
  never replace a deliberate root.
- SPA sign-out keeps its bearer token until the API confirms server-side revocation, so
  a network/500 failure is retryable instead of presenting a false signed-out state.
  Expired 401 responses clear stale local tokens, malformed callback responses are
  diagnosed safely, and action exceptions retain CORS-bearing JSON errors. Tree-load
  driver diagnostics stay in server logs instead of appearing in API or UI messages.
- Minimap unsure/junction marks and accent text now keep contrast in both schemes; the
  family feed refreshes relative time when opened and describes partnership events
  honestly. Childless fused unions and hidden feed anchors no longer create misleading
  marks or navigation.

### Deployment and tooling

- CI and Pages use Node 22, the Pages build strips a trailing API-origin slash, and CI
  scans both Next and Vite output CSS for dead Tailwind utilities. Root typechecking now
  includes `.mts` scripts; obsolete supply-chain release-age exceptions were removed.
- Vercel skips `frontend/`-only commits because Pages owns that bundle, while new or
  unknown top-level paths still build by default. The workspace definition is reduced
  to the actual packages.
- Added project-specific Claude workflows for canvas verification and release
  verification plus a graph/privacy reviewer agent. Drizzle SQL and metadata remain
  tracked deployment inputs; local Claude settings and environment secrets remain
  ignored.
- Caught `CLAUDE.md`, `.env.example`, and `docs/SETUP.md` up to the 0.2.3 production
  architecture before recording this release.

### Verified

- The consolidated static gate passes: Biome formatting/lint, both TypeScript projects,
  the Next 16.3 production build and the Vite 8.2 Pages build. Vite reports only its
  existing dynamic-import and large-chunk advisories.
- Live in both frontends at 1440x900 and 375x812, in light and dark: the demo renders
  151 nodes (117 people plus 34 junctions) and 150 base family edges; all 68 partner
  rails stay flat; paths stay finite; no junction intersects a card; labels resolve;
  the overview keeps all 117 people and 34 junction marks; and there is no horizontal
  overflow. Depth, theme and panel changes preserve the viewport, while deliberate
  feed/search travel moves to the selected card.
- The feed renders all 80 hydrated events through the Vite JSON boundary. Feed-to-detail
  travel returns to the feed on one Escape and closes it on the next. On mobile the
  detail sheet is 55dvh and keeps the selected card visible. Fresh interaction runs
  produced no browser warnings or errors; the only later console failures were the
  deliberate 401/404 negative API probes.
- The demo API returns 200 with 151 nodes and 202 serialized edges (150 family-layout
  edges plus 52 dormant relation edges). Cross-origin unauthenticated writes return
  CORS-bearing JSON 401, unknown actions return JSON 404, and preflight returns 204.
  Real OAuth completion and authenticated writes were deliberately not exercised.

### Deferred

- The custom SPA OAuth flow still has a narrow duplicate/orphan-user race when two
  first sign-ins for a GitHub account with no email run concurrently; fixing it needs a
  dedicated identity-upsert design, not a provisioning patch.
- `Result.id` still doubles as explanatory text for invite actions; changing that
  contract requires a typed result migration across both frontends.
- The static SPA's meta CSP cannot express `frame-ancestors`, and development hosts
  remain a separate policy concern. Focus restoration after closing stacked panels is
  also deferred.
- A public discovery feed remains intentionally unbuilt. It requires explicit per-tree
  opt-in privacy semantics; the existing feed stays scoped to already authorized data.

## 0.2.3 -- 2026-08-08 (hotfix: the SPA canvas died on the feed's timestamps)

### Fixed

- **0.2.2 took down the whole SPA canvas in production.** The family feed calls
  `.getTime()` on person-row timestamps, and over the JSON API those arrive as
  ISO STRINGS -- so `familyFeed()` threw inside a render-path `useMemo` and the
  tree screen never mounted: stuck, no visuals, demo included. The
  server-rendered app was fine, which is exactly why it slipped through: the
  feed was verified on the Next app and never re-run through the SPA's
  serialise/parse path. `serialise.ts` had DOCUMENTED this landmine word for
  word ("would throw only on the API path and work fine locally") and
  deliberately left timestamps unrevived while nothing read them; the test
  pinning that contract went out with the suite in 0.2.0.
- `parseTreeView()` now revives every flattened `Date` -- person `createdAt`,
  `updatedAt` and `verifiedAt` on both `primary` and every source row, contact
  `createdAt`/`updatedAt`, union `createdAt` -- so a parsed view is
  indistinguishable from a served one. The revival lives at the boundary, not
  defensively inside consumers: a consumer that copes with strings beside one
  that does not is the same invisible drift as a serialiser disagreeing with
  its parser.

### Verified

- The exact crash path, live: the SPA against the API renders 151 nodes and 150
  edges, the feed opens with all 80 rows and correct relative times, and the
  console is clean. Both typechecks and the Vite build pass.

## 0.2.2 -- 2026-08-08 (the family feed, and a motion pass)

### Added

- **The family feed**: the record as a stream, newest first, behind a FEED
  toggle beside the legend. Rows read the way every feed does -- avatar, name,
  verb, a right-aligned time -- and are scoped the way nothing on a feed is:
  derived entirely from the nodes the viewer already received
  (`lib/tree/feed.ts`), so it can never show a person the canvas would not.
  Three event kinds fall out of timestamps the schema already carries: added to
  the record (`createdAt`), record updated (`updatedAt`, floored so an insert
  does not announce itself twice), and partnership recorded (a union's
  `createdAt`). No events table, no migration, works in the demo and in both
  frontends. Clicking a row travels to that person and opens their panel; the
  feed waits underneath and returns when the panel closes. Grouped into "this
  week / this month / earlier", capped at 80.
- A DELIBERATE boundary, stated in the panel's own header: only people with
  access see the feed. A PUBLIC discovery feed would be an opt-in per tree and
  is not built -- it is a different privacy posture, not a missing feature.
- **Sample data now has a believable timeline.** Every demo row carried the
  same epoch timestamp, which would render the feed as one giant dump. Rows now
  get deterministic moments hashed from their own ids (the demo rebuilds per
  request, and a feed that reshuffles on reload reads as broken), spread over
  seven months with a quarter of records touched again later.

### Fixed

- **Closing a panel after arriving from search could reopen it by itself.** The
  travel request (`goTo`) was never acknowledged, so it sat in state forever
  and any re-fire of the travel effect -- React Flow re-measuring during a
  hover className rewrite is enough -- replayed the last navigation. Found the
  first time a feed row was clicked, but reachable from search all along. The
  canvas now reports the travel handled and the stage clears it, the same
  contract quick-add already used.

### Motion

- The account menu settles in and out with a quick scale-fade instead of
  popping; the feed panel slides on the detail panel's own spring; feed rows
  cascade with a capped stagger so a long section arrives as a column, not a
  minute of drizzle.
- The sign-in page now enters with the landing page's stagger. The two screens
  are one surface, and only one of them arriving with rhythm made the other
  read as a fallback.
- All of it chrome, none of it canvas: the 117 cards and 150 edges stay CSS,
  because a JS animation re-renders a node and React Flow re-measures on
  render. The in-app motion switch governs everything new.

### Verified

- Live against the dev server: the feed opens with 80 events across three
  sections, rows carry kinship chips and relative times, clicking a row
  travels, selects the card and opens the panel, one Escape closes it and the
  feed returns; search-to-travel still works; consoles clean on fresh loads;
  Biome, both typechecks and both production builds green.

## 0.2.1 -- 2026-08-07 (a screenshot audit of every surface)

A full UI sweep with a live browser -- landing, sign-in, the canvas at three
detail levels, the detail panel, the legend, both themes, 1440px and 375px, and
the SPA -- measuring rather than eyeballing. Three real defects and one
under-sized control came out of it, all fixed and re-measured.

### Fixed

- **Five junction beads sat on people's faces.** The marriage-line placement put
  a couple's bead at their midpoint, which is only clear space when the couple
  is laid out adjacent -- with somebody between them (a remarriage chain, a
  fused graph) the midpoint is the middle of that person's card, and union
  nodes painted above cards. Measured: 5 of 34 beads. Two-part fix: the bead's
  x is clamped to the nearest clear gutter between the partners
  (`nearestClearPoint()` in layout.ts), and person cards now carry a higher
  node z-index than junctions so a couple with NO clear gutter hides its bead
  behind a card instead of wearing it. After: 0 of 34, with the marriage-line
  geometry unchanged (68/68 flat, 82/82 drops from the bead centre, 0 NaN).
- **Every right-edge control died while the detail panel was open.** The
  desktop panel is a 22rem rail pinned to the same edge as the arrangement,
  detail-level and legend controls, and it is deliberately non-modal -- so the
  controls underneath it swallowed every click (proved by a click that timed
  out, not by eye). The cluster now slides 22.75rem left while the panel is
  open and slides back when it closes; on a phone the panel is a bottom sheet
  and nothing moves.
- **The overview map floated 152 bare dashes over the canvas.** No backdrop, so
  in a busy corner it read as rendering garbage. It now sits on the same opaque
  bordered surface as the legend.
- **Icon-only toolbar buttons were 35px wide on a phone** (labels hide below
  `sm`), under the 44px floor every other control on this canvas clears. Now
  `min-w-11`.

### Verified

- Re-measured live after each fix, in the Next app and through the SPA: 0 beads
  on cards, 0 NaN paths, marriage lines and child drops byte-identical to
  before the clamp, the KEY/arrangement/detail controls clickable with the
  panel open, clean consoles, and both production builds green.
- Also checked and found healthy: landing and sign-in at both sizes and themes,
  the mobile bottom sheet (55dvh, subject card visible), search, breadcrumbs,
  fold controls, the fixed-frame minimap projection, and horizontal overflow
  (none anywhere).

## 0.2.0 -- 2026-08-07 (leaner, redrawn, and staying on the ledger-sync shape)

Three things happened in one release: the working surface got smaller (tests and
hardening out), the graph was redrawn to the conventions relatives already know,
and the two-frontend architecture was CONFIRMED as the requirement -- a
single-app consolidation was built, verified, and then reversed the same day
when the owner confirmed the app must live at `sagargupta.online/kinfolk` the
way ledger-sync does. The reversal was surgical: everything the SPA needs
(`frontend/`, the OAuth bridge, the bearer JSON API, `pages.yml`) is back
byte-for-byte from history, and the round trip left two genuine improvements
behind -- `app/icon.svg`, and a Vite dev proxy the SPA had always been missing.

### Removed

- **The unit suite (26 files, 328 tests), vitest, and both live smoke scripts**,
  deliberately, to keep the working surface small while the product is reshaped.
  `scripts/check-migrations.mts` stays because the deploy workflow runs it, and
  graph maths stays React-free and database-free in `lib/tree/` so a suite can
  return later without restructuring.
- **The hardening layers**: the security-header/CSP block in `next.config.mjs`, the
  gitleaks CI job, and the people-per-hour write budget (`lib/tree/rate-limit.ts`).
  Authorization is not hardening and stays: every write still starts in
  `lib/tree/authz.ts`, contact visibility is still filtered server-side, and the
  SPA's whole data path (bearer, CORS allow-list, HMAC OAuth state, redirect
  allow-list) is load-bearing and untouched.
- **`NEXT_PUBLIC_BASE_PATH` mount support in the Next app.** The Vercel deployment
  owns its origin, so the session and demo cookies scope to `/` and no route
  applies a base path by hand. The `/kinfolk` mount belongs to the SPA alone,
  through Vite's own `base` -- which is how it was deployed in practice anyway.

### The graph, redrawn

How partners connect and how children descend were rebuilt to the convention
every hand-drawn pedigree uses, after checking it against published charting
guides: a couple is joined by ONE horizontal marriage line at mid-card height,
and their children descend from a single stem at its midpoint. Before this,
both partners dropped separate lines to a dot floating in the generation gap --
structurally correct and visually nothing a relative has ever seen on a family
chart.

- `placeUnionJunctions()` (layout.ts, replacing `centreUnionDots()`) puts a
  couple's junction ON the line: x at the couple's midpoint, y at their averaged
  mid-card height. A single-parent union stays in the gap, centred under its one
  parent, so the drop is a straight vertical.
- `partnerPath()` (paths.ts) draws the line card-centre to card-centre; the run
  behind each opaque card is hidden, so the visible line spans exactly the
  gutter. A cross-generation couple gets rounded corners at each end instead of
  a line through somebody's row.
- The junction bead wears the line's own colour and the genogram's status
  language: solid for an intact partnership, hollow for widowed, and a double
  slash THROUGH the line for separated or divorced.
- Measured on the live canvas, not eyeballed -- in the Next app at two detail
  levels AND through the SPA's serialise/parse round trip: 68 of 68 partner
  edges are flat marriage lines, 34 of 34 beads sit on their line (worst offset
  0px), 82 of 82 child drops leave the bead's centre, 0 NaN paths, and the
  orbit arrangement is untouched.

Adding a person was reworked around the same research (Gramps' per-card add is
the reference): the role picker now leads with WHERE the person will land
(parents above, partner and siblings beside, children below), says "both
parents recorded" instead of offering a button that ends in a refusal, and
shows counts for everything else. The fast path is role, name, Enter --
surname, birth year, gender and living status sit behind a More-details
disclosure and submit their defaults untouched. Adding a partner now asks how
the couple is recorded (married / partners / not known), because the canvas
draws that fact; the status applies only when the add CREATES the union, never
to one that already exists.

The picker and the partnership status were verified by compile, typecheck and
build; the write path could not be exercised live, because the demo canvas
renders no editor and minting a real session to test with is forbidden.

### Fixed

- **The SPA's sign-in button did nothing in local dev, ever.** `startSignIn()`
  built `new URL("/api/oauth/authorize")` from a relative string with no base,
  which throws before any request is made -- invisible in production, where
  `VITE_API_BASE_URL` makes the string absolute. The URL is now anchored on the
  page's own origin, and the base argument is ignored when the string is
  absolute, so production is unchanged.
- **The Vite dev server had no `/api` proxy**, despite `src/api.ts` documenting
  one ("Empty in dev, where the Vite proxy serves /api from the same origin").
  Every SPA fetch in dev got index.html back with a 200, which renders as
  "Could not reach the server" and reads as an API failure. The proxy now hands
  `/api` to the Next app on port 3007.
- A childless couple is joined by one direct line instead of a union dot pointing
  at nobody (#29, shipped 2026-08-07 and previously missing from this log).

### Added

- `app/icon.svg` -- the favicon the SPA had and the Next app never did. Found as
  the only console error on a clean load.

### Dependencies

Everything current across both workspace packages, on the newest lines: Next
16.3, Motion 13 (major, both packages together -- the shared components require
the pin to match), @vitejs/plugin-react 6, lucide-react 1.29, Biome 2.5.7 (config
migrated), tsx 4.23.9, plus type packages. `next-auth` stays on `5.0.0-beta.32`
deliberately: the v5 beta IS the newest line, and the `latest` npm tag still
points at v4.

### Verified

- Biome, both `tsc` projects, the Next production build and the Vite Pages build
  all pass; the full route table is back (`/api/tree`, `/api/action/[name]`,
  `/api/share`, the three `/api/oauth/*` routes, Auth.js, `/tree`, `/signin`,
  `/demo`).
- Live in a browser: the SPA landing renders at `localhost:5173`, "See the
  sample tree" renders **151 nodes and 150 edges through the JSON API** with a
  clean console, and "Sign in with GitHub" completes the authorize leg --
  GitHub's login page reached with the `redirect_uri` accepted and the same
  state shape observed live on `sagargupta.online/ledger-sync` moments earlier.
  The final keystroke of a sign-in is deliberately not automated.
- The Next app's demo flow re-verified after the dependency bumps: same node and
  edge counts, no console errors.

## 2026-08-07 (security and deployment audit)

### Fixed

- Invite roles are now parsed from an allow list, so a forged form cannot grant
  `owner`. Postgres enforces the same rule on both pending invites and memberships.
- GitHub usernames are normalized case-insensitively before invites are stored or
  claimed.
- Attaching an existing child now refuses an edge that would make somebody their own
  ancestor.
- The live database had schema changes but no trustworthy migration history. Migration
  `0000` was safely baselined, `0001` made Auth.js email nullable, and `0002` added the
  role constraints. A preflight checker now verifies that live history is an exact
  prefix of committed migrations before deploys can write.
- The Pages SPA now has a script CSP with its no-flash theme bootstrap in an external
  file, plus a favicon so a clean page load produces no console errors.

### Deployment

- CI now typechecks and builds both the Next and Vite frontends, and Biome covers the
  Vite source and public scripts.
- Deploys check migration history before and after `drizzle-kit migrate`.
- Deployment docs now describe the actual split: `frontend/` on Pages, with the API,
  OAuth exchange and server-rendered fallback on Vercel. `DATABASE_URL` is a manual
  encrypted variable pointing at the existing Neon project, not a native integration.

### Verified

- 328 unit tests across 26 files, Biome, both TypeScript projects, and both production
  builds pass.
- `pnpm audit --prod` reports no vulnerabilities.
- All 3 committed migrations are applied, and both live Neon smoke suites pass and
  clean up.
- Production probes return the expected 200/307 statuses. The Pages SPA was checked at
  desktop and mobile sizes in light and dark themes with zero console errors.

## 2026-08-06 (production hardening)

### Security

- **5 dependency vulnerabilities closed**, 3 of them HIGH: four in postcss, one in
  sharp. Both nested under `next` rather than imported here, so the fix is a pnpm
  override that stops the old copies existing. postcss runs only at build time and
  sharp is shipped-but-unused, but "we do not call it today" is a fact about this
  week's code, not a property of the dependency.
- **Security headers**, where only HSTS was set. Added `nosniff`, a referrer policy,
  a permissions policy, `X-Frame-Options` and a Content Security Policy with
  `default-src 'self'`, a `connect-src` naming the only two hosts this app may reach,
  `frame-ancestors 'none'`, `object-src 'none'` and `base-uri 'self'`.
- **A write budget**: 500 people per hour per owner, counted in Postgres. The API
  previously accepted unbounded authenticated writes, so one token could create rows
  until Neon stopped it.

### Two CSP attempts that broke the app, both caught in a browser

Worth recording because the header looked correct in both cases.

`'strict-dynamic'` disables host-based allowlisting by design, so `'self'` stopped
applying and every `/_next/static/chunks/*.js` was blocked. The shell rendered, the
theme script ran, and the canvas came up with **zero nodes** -- which reads as a data
bug rather than a policy one. It cannot work here regardless: it bootstraps from a
nonce, and these pages are cached rather than rendered per request.

Then a sha256 hash of the theme script alongside `'unsafe-inline'`. The browser said
it outright: a hash makes `'unsafe-inline'` ignored, so adding the hash **blocked
every other inline script** instead of narrowing anything. Those others are React's
streaming payload, emitted per render and unhashable, and Next's own inline bootstrap
needs the allowance anyway -- so externalising our own script would not have helped.

`script-src` therefore keeps `'unsafe-inline'`, and the comment says so plainly
rather than implying the policy is stricter than it is.

### Verified

Live in production: all six headers present, all five endpoints answering, the canvas
rendering 151 nodes and 150 edges with **zero console errors**. The rate limit was
proven against the real database -- at the limit refused, a different user unaffected,
5-left/want-5 allowed while want-6 refused. Mobile re-checked at the `max-width: 640px`
breakpoint: detail sheet at 55% of viewport height, no horizontal overflow, and no
contact value anywhere in the panel.

### Not fixed, and why

A static export is **impossible** without deleting the auth flow, which was measured
rather than assumed: `output: "export"` fails on `/demo`, and `/api/auth/*` plus the
server-side `signIn()` redirect cannot exist in a static file. Hosting the UI on Pages
would mean rebuilding sign-in as a client-side OAuth dance and putting a bearer token
in `localStorage`, which is less secure than what exists now.

## 2026-08-06 (one environment, and no builds for docs)

### Changed

- **Preview deployments are off.** There is one environment now, production. A pull request
  was producing its own deployment alongside the production one, so the dashboard listed
  three environments for a project that only ever serves from one.
- **A commit touching only documentation no longer builds.** `ignoreCommand` runs
  [scripts/vercel-ignore-build.sh](scripts/vercel-ignore-build.sh), which skips when every
  changed path is under `docs/`, `drizzle/`, `.github/`, `.claude/` or is markdown.
  Measured on PR #11: one changed markdown file produced a full production-grade build and a
  preview deployment, which on a Hobby plan is the single concurrent build slot spent on a
  file the runtime never reads. It also put a "Deployment has completed" check on a pull
  request whose deployment proved nothing.

The filter is a DENY list rather than an allow list, deliberately: a new top-level directory
builds until somebody decides otherwise, because a wrongly skipped deploy is a deployment
that silently never happens. Production always builds, and so does any commit the script
cannot diff. Verified against 13 path combinations plus the real docs-only commit that
wasted a build earlier.

## 2026-08-06 (sign-in configured)

### Added

- **Sign-in is configured and the app is fully live.** `/api/auth/providers` returns 200
  and reports the GitHub provider, so the daily health check now passes all five probes
  where it previously failed that one.
- `DATABASE_URL` comes from **Vercel's native Neon integration** rather than a pasted
  string. The credential is provisioned into the project and rotated by Vercel, so it never
  passes through a terminal, a transcript or a third-party API -- strictly better than any
  copy-paste route. The integration also sets `POSTGRES_*`, `PG*` and
  `DATABASE_URL_UNPOOLED`, which are unused and harmless here.
- `AUTH_GITHUB_ID` is stored as `plain`, not `sensitive`. An OAuth client id is public by
  specification (RFC 6749 section 2.2) and appears in the authorize URL every user's browser
  visits, so encrypting it would imply a secrecy it does not have.

### Verified, not assumed

- The `callbackUrl` Auth.js reports matches the OAuth app's registered callback exactly,
  which is what rules out `redirect_uri_mismatch`.
- Clicking "Continue with GitHub" reaches GitHub's own login with PKCE (`S256`) and
  `scope=read:user user:email`. GitHub **accepted** the redirect URI rather than rejecting
  it, which is the assertion that matters.
- `/api/auth/session` returns `null` rather than an `AdapterError`, proving the Drizzle
  adapter reached Postgres. A broken connection surfaces there first.
- `pnpm db:smoke` passes all 22 live checks, including fusion across two graphs, kinship
  terms, and a private phone number never reaching a linked viewer.

The final keystroke of a sign-in is deliberately not automated: minting a real session for
a real account to test with is forbidden, so provisioning is proven by the smoke script
against the same database.

## 2026-08-06 (later)

### Fixed

- **`AUTH_URL` pointed at the SSO-gated alias**, which would have broken sign-in even once
  the secrets were added: Auth.js builds its callback from that value, so GitHub would have
  rejected the redirect. Now `https://kinfolk-neon.vercel.app`, matching the callback the
  OAuth app must register. Found by listing the project's variables rather than trusting
  what was set an hour earlier.
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) said "the origin Vercel gives you"**, which
  was fine when there was one and misleading now there are three and two are unusable. The
  exact hostname is written out in both the variable table and the OAuth app steps.
- Recorded that `DATABASE_URL` on Vercel wants the **pooler** host while `drizzle-kit push`
  wants the **direct** one. Opposite requirements, easy to conflate, and stated wrongly
  once in conversation.

### Known gap, unchanged

- Sign-in still needs four secrets only their owner may set. The daily health check fails
  on `/api/auth/providers` alone and passes its other four probes, which is the check
  working rather than a regression.

## 2026-08-06

### Deployed

- **The app is LIVE** at <https://kinfolk-neon.vercel.app>. Once the Vercel GitHub App was
  installed by hand, the same `gitSource` deployment call that had been refused four times
  succeeded and built on the first attempt -- so the 400 never named its real cause.
  Verified live: `/demo` 307s to `/tree` and the canvas renders 151 nodes, 150 edges and
  34 union junctions from sample data.
- **The landing page's two app buttons now appear**, pointing at that host. They were
  hidden while `APP_URL` was empty, because a link to a deployment that does not exist is
  worse than no link.
- `PRODUCTION_URL` is set as a repo variable, so the deploy-verify and daily health jobs
  stop skipping.

### Fixed

- **Picked the right alias out of three.** Vercel assigned
  `kinfolk-sagargupta16s-projects.vercel.app`, which sits behind SSO protection and 302s
  every request to a Vercel login -- a public visitor would meet a sign-in for an account
  they do not have, and when probed it looks exactly like a broken deployment.
  `kinfolk.vercel.app` belongs to an unrelated project. Only `kinfolk-neon` answers 200.

### Known gap

- **Sign-in is not live yet.** It needs `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GITHUB_ID`
  and `AUTH_GITHUB_SECRET` set in Vercel by their owner, plus the production callback URL
  added to the GitHub OAuth app. `/api/auth/providers` returns 500 until then, which is
  the expected shape rather than a fault. `AUTH_TRUST_HOST` and `AUTH_URL` are set, both
  being non-secret.

## 2026-08-05

### Deployed

- **The landing page is live at <https://sagargupta.online/kinfolk/>**, served by GitHub
  Pages from `docs/`. Publishing only that directory is what lets a private repository
  have a public front door.
- **A Vercel project exists for the app** (`kinfolk`, `sin1`, the same region as the Neon
  database). It is not linked to the repository yet: Vercel's GitHub App cannot see a
  private repo until it is installed from the dashboard, and that is not an API action.
  Verified rather than assumed, from three refused attempts -- personal scope, team
  scope, and a direct `gitSource` deploy, all rejected as "repository can't be found".

### Fixed

- The app builds and serves at the domain root with no `basePath` set, which is the shape
  the Vercel deployment uses. Confirmed live: `/demo` sets its cookie and forwards to
  `/tree`, which renders 151 nodes and 150 edges.

### Changed

- `shared-workflows`' reusable `node-ci.yml` gained `run-typecheck`, `tests-before-build`
  and a `build-env` secret, so this repo's CI can eventually call it instead of carrying
  its own copy. Every default preserves the old behaviour, so the five repositories
  already calling it are untouched.

## 2026-08-04

### Added

- **CI, deploy, Pages and health workflows.** CI runs a secret scan plus lint, typecheck,
  test and build. A guard greps the built CSS for dead Tailwind arbitrary-value rules,
  because nothing else catches them -- not the build, not Biome, not the browser.
- **A configurable mount path** (`NEXT_PUBLIC_BASE_PATH`), so the app can be served under
  a subpath beside other projects on one domain.

### Fixed

- **The session cookie was scoped to `/` and never `Secure`.** On a shared domain that
  sends a live session token to every other project on the host, over plain HTTP. Now
  scoped to the mount and `Secure` in production.
- **`NextResponse.redirect` is not rewritten by `basePath`.** The demo link 404'd under a
  subpath mount and was fine everywhere else, so the failure only existed in production.
- **A Pages job with its own `permissions` block dropped `contents: read`.** A job-level
  block REPLACES the workflow default rather than adding to it, and on a private repo the
  checkout then fails with "repository not found" -- which reads like a wrong URL and is
  actually a token that cannot see the repo.
- **The deploy verification probed a URL nobody had confirmed.** A guessed hostname
  belonged to an unrelated project and returned three green checks. `PRODUCTION_URL` is
  now required rather than inferred.

## 2026-08-03

### Added

- **Relationship-first quick add.** A `+` on each card opens a role sheet ("father",
  "sibling", a batch of children) with four fields only: name, gender, birth year,
  living status. `lib/tree/kin-plan.ts` turns a role into a plan -- which union to find
  or create, how many people, what the role implies about sex.
- **Person editing**, including your own record, behind a pencil in the detail panel.
- **An orbit arrangement** (`lib/tree/radial.ts`): one person centred, everybody else on
  rings by relationship distance. Answers "who surrounds this person", which a
  generation-banded pedigree cannot.
- **Per-card 3D tilt**, applied to the card and never the pane.
- **Connector geometry as pure strings** (`lib/tree/paths.ts`), so a corner that inverts
  is a failing test rather than something you squint at.

### Fixed

- **`db.transaction()` throws at runtime on the Neon HTTP driver while type-checking
  perfectly.** The first `addRelative` wrapped five writes in one and would have failed
  on every single use. Found by a live smoke script, because nothing offline can find it.
  Multi-write actions are now sequenced so a partial failure is a shape the app renders.
- **`updatePerson` was silently destructive**, writing every column unconditionally and
  nulling three fields the form never rendered -- including a searchable birth surname.
  Now patches by key presence: absent means leave alone, blank means erase.
- **An edit wrote to the wrong row on a merged person.** The fused id is the smallest
  member uuid, so on a person two families describe it is the far family's row about half
  the time, and the server would refuse somebody's edit to their own record.
- **A form prefilled from the wrong row copied the other family's data into yours** on
  save. A corruption with no visible tell.
- **Two single-parent unions instead of one couple** when adding a father and a mother.
  It looked like a rendering fault, which is the worst class of bug here.
- **Union dots sat beside couples rather than between them** -- all 34, worst by 498px.
- **82 of 150 edges turned through hard 90 degree corners**, and one sibling bar ran
  6013px against a 200px median. Now 3, all straight drops with no corner to round.
- **An 18px dead zone where edges met a union dot.** React Flow anchors to handles offset
  outward from the node box; the junction centre is now passed down explicitly. 150 of
  150 endpoints land on their dot.
- **Partner edges emitted paths of literal `NaN`**, so a couple's line vanished entirely.
  Testing `data` for truthiness is not testing the field the branch needs.

## 2026-07-31

### Added

- **Light, dark and system themes** on `[data-theme]`, with a render-blocking inline
  script so there is no flash of the wrong scheme.
- **An in-app motion switch** instead of `prefers-reduced-motion`. These animations carry
  information, so an OS flag set years ago to stop banners jumping would silently delete
  a data channel.
- **A person detail panel** -- side rail on a pointer device, bottom sheet on a phone,
  one component for both.
- **DAG-safe expand and collapse** in both directions, with per-card hidden counts.
- **Eleven keyboard shortcuts** whose bindings and help sheet come from one array, so a
  help sheet that lies is not possible.
- **Loading, error, alone, search-empty and offline states.**

### Fixed

- **Collapse blocked the person instead of their union**, which renders a marriage with
  one participant. Found by a test asserting both halves of the contradiction.
- **A collapse walk seeded from the roots could not fold ancestors at all**, because the
  roots are exactly what an upward fold hides.
- **The living-status colour painted 80% of every surface green** -- 94 of 117 card rails,
  93 of 152 minimap rects, 93 of 117 dots. Every individual green cleared its contrast
  floor; only a screenshot showed that 94 of them shared a canvas.
- **Fold targets measured 35px, not 44**, because everything inside the canvas viewport
  sits in a scaled layer. Then the fixed target grew wider than the card it belonged to,
  so clicking a person opened a fold.
- **The mobile detail sheet covered the very card it described** at 70dvh. Now 55dvh.
- **This project's own documentation compiled a dead CSS rule into production.** Tailwind
  scans markdown and comments as class-name sources, so spelling out a broken utility
  creates it. Found by grepping the built stylesheet.

## 2026-07-30

### Changed

- **Relations are revealed one person at a time rather than drawn at rest.** The 52
  relation edges were 73% of all edge ink at a median span of 2214px, against the family
  skeleton's 69px. The resting canvas went from 202 edges wearing 15 stroke treatments to
  150 wearing one.
- **The accent was reclaimed from the skeleton.** 68 of 150 family edges rendered amber,
  which is not an accent but a theme.

## 2026-07-29

### Added

- Neon Postgres schema live on a real branch: 12 tables, 10 enums, 28 indexes, 24 foreign
  keys, verified by a live smoke script rather than by trusting a migration's exit code.
- GitHub OAuth sign-in end to end, sign-out verified down to the deleted session row.
- Sharing by invite, with 14-day expiry and viewer-by-default.
- The graph editor: person, relation and partnership, gated by `lib/tree/authz.ts`.
- Demo mode: one UI, two data sources, an httpOnly cookie, and no database needed.

### Fixed

- **A neighbour app's session cookie threw `AdapterError` on `/tree`** for a visitor who
  had never signed in. Cookies are scoped by host and never by port, so every Auth.js app
  on localhost was reading and writing one name.
