---
paths:
  - "package.json"
  - "frontend/package.json"
  - "lib/tree/layout.ts"
  - "lib/tree/elk-worker.ts"
  - "lib/tree/radial.ts"
---

# Layout libraries

Moved verbatim from `CLAUDE.md` on 2026-10-31. Loads when a file matching `paths:` is read or edited.

## Repo-specific rules

- **The layout stack is elkjs + React Flow, and the alternatives were measured rather than assumed** (2026-07-29, versions live from the npm registry). Do not swap one in without re-running this: `family-chart` (3.5k weekly) and `relatives-tree` (2.1k) both require a binary `gender`/`Gender` on every node, so adopting either means corrupting a record whose `sexEnum` is `["female","male","other","unknown"]` and defaults to `"unknown"` -- and neither models non-family relations, which is half of what Kinfolk is. `d3-flextree` is a strict tree (one parent per node) and last published 2021-11-08; a family tree is a DAG. `d3-dag` 1.2.2 is the one real contender (DAG-native, variable node sizes, 56k weekly) but it is synchronous on the main thread with no edge routing, so it trades ELK's worker and port routing for nothing we lack. `sigma`, `cytoscape`, `g6` and `@cosmograph/cosmos` (still `2.0.0-beta.20`, 2024-12-19) are force-directed network renderers built for thousands of nodes, which is the opposite of a generation-banded pedigree. Already on the latest `elkjs` 0.12.0 and `@xyflow/react` 12.12.0.
- **`react-tree-graph` was evaluated on 2026-07-29 and rejected, on the same grounds as `d3-flextree`.** Registry facts, not memory: 8.0.3, published 2025-01-13, 3.7k weekly, built on `d3-hierarchy` (pinned `^2.0.0`, a full major behind the current 3.1.2 from 2022). `d3-hierarchy` is "layout algorithms for visualizing HIERARCHICAL data" -- a strict tree, one parent per node. A Kinfolk graph is a DAG: a child belongs to two unions (birth and adoptive), parentage hangs off `unions` precisely so remarriages and half-siblings work, and half the product is non-family relations that carry no generation at all. Feeding that to a strict-tree layout means either dropping the second parent or duplicating the node. It also has no edge routing, no port model and no non-family edge concept, so it cannot express the sibling bar, the relation overlay, or `anchorFamilylessNodes()`. The name matches what Kinfolk looked like three commits ago; it does not match what the schema models.
