---
name: kinfolk-canvas-verification
description: Verify Kinfolk canvas or graph-UI changes across the shared Next and Vite frontends. Use after edits to TreeCanvas, graph projection, layout, connector paths, cards, rails, panels, viewport behavior, themes, or responsive canvas CSS, and before claiming a visual regression is fixed.
---

# Kinfolk canvas verification

Verify the rendered graph, not only TypeScript. Kinfolk has one shared canvas but two delivery paths:

- Next renders a `TreeView` directly at port 3007.
- Vite renders the same components, but receives `TreeView` through the JSON API and `parseTreeView()`.

A change is verified only when both paths behave the same. Never use production credentials, print environment files, or complete a real OAuth sign-in. Demo mode is the safe fixture.

## Start both frontends

Use separate terminals:

```bash
pnpm dev --port 3007
pnpm --dir frontend dev
```

Open the sample graph from both the Next app and the Vite app. Vite dev proxies `/api` to Next on port 3007. The current untouched sample baseline is 151 React Flow nodes, 150 family edges, and 34 union junctions; if sample data intentionally changes, require matching counts and behavior between the two frontends instead of preserving stale numbers.

## Required browser matrix

Exercise every combination below, reloading each frontend at least once rather than relying on hot reload:

| Surface | Viewport | Themes |
| --- | --- | --- |
| Next demo/fallback | 1440x900 and 375x812 | light and dark |
| Vite SPA through the JSON API | 1440x900 and 375x812 | light and dark |

On each surface, check the layered tree. Also spot-check orbit mode, every detail level, an open person panel, and a collapsed branch. Keep the browser console open from navigation onward.

## Geometry invariants

Inspect the picture and measured DOM geometry:

1. **Finite paths:** no edge path contains `NaN`, `Infinity`, or `undefined`. In DevTools, this must return `[]`:

   ```js
   [...document.querySelectorAll(".react-flow__edges path[d]")].filter((path) =>
     /NaN|Infinity|undefined/.test(path.getAttribute("d") ?? ""),
   )
   ```

2. **Partner rails:** an ordinary same-row couple has one flat marriage rail at card mid-height. A cross-generation couple may use rounded turns to a shared rail. A childless couple uses one direct edge and no unnecessary junction.
3. **Junction continuity:** a union with children has its bead on the partner rail when a clear gutter exists; child drops start at the bead centre. A single-parent junction remains in the generation gap with a straight drop. There must be no dead gap at React Flow handles.
4. **No junction/card overlap:** junction beads do not paint on person cards. This should report zero intersections on the current sample:

   ```js
   const rects = (selector) => [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect());
   const people = rects(".react-flow__node-person");
   const junctions = rects(".react-flow__node-union");
   junctions.filter((j) => people.some((p) => j.left < p.right && j.right > p.left && j.top < p.bottom && j.bottom > p.top)).length
   ```

5. **Sibling bars:** bars stay below their own junction, overlapping family spans use separate lanes, wide families fall back to curves rather than a canvas-wide rule, and real corners are rounded. Straight vertical drops need no artificial curve.
6. **Cards and labels:** names remain legible, junction labels do not collide with cards, relation labels appear only for the revealed person, and no contact value appears in visible text or an accessible name.

## Interaction and viewport stability

- Initial framing waits for measured nodes; no React Flow error 004 and no empty 0x0 canvas.
- Hovering, pinning, opening a panel, changing theme, or resolving coarse-pointer state must not rerun ELK, jump the fit, or reset pan/zoom.
- The resting canvas contains the family skeleton, not the relation overlay. Hover reveals one person's relations; click pins them; tapping the pane clears them. Labels appear with the revealed lines.
- Desktop controls remain clickable when the right detail rail is open. On mobile, the detail sheet remains about 55dvh and leaves the selected card visible.
- At 375x812 there is no document-level horizontal overflow:

  ```js
  document.documentElement.scrollWidth === document.documentElement.clientWidth
  ```

- Touch panning starts on cards, fold controls do not eclipse a card, and canvas controls retain a 44-screen-pixel target across zoom levels.
- Tree/orbit switching, detail-level switching, collapse/expand, search travel, and panel close do not replay stale navigation or lose the selected person.

## Console and boundary checks

Require a clean console on fresh loads and interactions: no hydration errors, unknown React Flow edge types, API/CORS failures, failed asset paths, Date method errors, or unhandled promise rejections. The Vite pass is mandatory after adding any `TreeView` field because it alone proves serialisation, `Map` reconstruction, and Date revival; a healthy Next render does not cover that boundary.

## Run static gates once at the end

Do not rerun the full gate after every visual adjustment. After browser verification is stable, run it once:

```bash
pnpm typecheck
pnpm --dir frontend typecheck
pnpm lint
pnpm build
pnpm --dir frontend build
```

Report the matrix exercised, node/edge counts, path and overlap results, console state, viewport findings, and any combination not tested. Screenshots supplement measurements; they do not replace them.
