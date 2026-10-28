# A family tree is not a tree

Every family tree app draws a tree. Real families are not one. Building
[Kinfolk](https://sagargupta.online/kinfolk/) meant throwing out three assumptions that most
genealogy tools are built on, and this is what replaced each of them.

## 1. Parents are not two columns on a child

The obvious schema puts `father_id` and `mother_id` on `people`. It breaks on the first real
family: a remarriage, a half-sibling, a single parent, an adoption, a step-parent who raised
you. Each one becomes a special case in the queries and again in the renderer.

Kinfolk hangs parentage off a partnership instead:

```text
people          one tree's claim about a human
unions          a partnership: partner_a_id, partner_b_id (both nullable)
union_children  union_id, child_id, role (biological, adoptive, step, foster, guardian)
```

A remarriage is a second `unions` row. Half-siblings are children of two unions that share
one partner. A single parent is a union with one partner. An adopted child belongs to two
unions, birth and adoptive, with a role on each membership. None of these need code of
their own, because they are ordinary rows.

What you get is a directed acyclic graph, not a tree. It has two kinds of hierarchical
edge (partner to union, union to child), and the same person can have several of each.
Acyclic is enforced, not assumed. Attaching a child runs a recursive descendants query
under a row lock in the same atomic batch as the insert, so a write that would make someone
their own ancestor never lands, even when two edits race
([lib/tree/edit-actions.ts](../lib/tree/edit-actions.ts)).

## 2. The same human lives in several trees

Your grandfather exists in your tree and in your cousin's. You each recorded him from
memory, with slightly different dates. Both descriptions are legitimate, and neither of you
should lose yours because the other one signed up first.

So a `people` row is a **claim**, not a person. When two owners agree that two rows describe
the same human, Kinfolk stores that as a `person_links` row with a consent state
(`pending`, `accepted`, `rejected`, `revoked`). Nothing is merged on disk. The other owner
has to accept, a pending proposal changes nothing anyone sees, and revoking the link
restores two separate views because the two source rows were never touched.

The merge happens at read time. Accepted links are fed to a union-find, because identity is
transitive: if A is B and B is C, all three rows are one human, and a pairwise merge would
miss that.

```ts
class DisjointSet {
	private parent = new Map<string, string>();

	find(id: string): string {
		const seen = this.parent.get(id);
		if (seen === undefined) {
			this.parent.set(id, id);
			return id;
		}
		if (seen === id) return id;
		const root = this.find(seen);
		this.parent.set(id, root); // path compression
		return root;
	}

	union(a: string, b: string): void {
		const rootA = this.find(a);
		const rootB = this.find(b);
		if (rootA === rootB) return;
		// The smaller root wins, so fused ids are deterministic across reloads.
		if (rootA < rootB) this.parent.set(rootB, rootA);
		else this.parent.set(rootA, rootB);
	}
}
```

Every union and relation endpoint is then rewritten onto the fused id, so edges from both
families land on one node. The viewer's own row wins as the display record. When the
sources disagree on a birth or death date, the card says so instead of quietly showing
whichever row won ([lib/tree/graph.ts](../lib/tree/graph.ts)).

The public sample shows this working with real families from Wikidata. Queen Victoria's
descendants and Christian IX of Denmark's were recorded as two trees holding 228 records;
where the families married into each other, 12 accepted links join them, and the canvas
renders 216 people and 40 unions.

Access follows the same idea. You can read a tree you own, one you were invited to, or one
that is a single accepted link away. A pending proposal grants nothing, and seeing a linked
tree never grants editing it.

## 3. Not every relationship has a generation

A family graph is also a contact graph. A family friend, a godparent, a colleague who
became an uncle in all but name: people record them, and they matter. But a friendship has
no generation. If it reached the layout engine, it would drag the friend into a row they
do not belong in and quietly redraw the family.

So non-hierarchical connections live in their own table, `person_relations`, and never
enter the layout graph. They are drawn as an overlay after the family is placed, and a
person whose only connection is a friendship is anchored next to that friend
([lib/tree/layout.ts](../lib/tree/layout.ts)).

## Picking a layout engine

The constraints above ruled out most tree libraries before any rendering happened:

- `family-chart` and `relatives-tree` require a binary gender on every node. Kinfolk's sex
  column defaults to `unknown`, because most genealogy data is missing, and forcing a value
  would write a lie into the record.
- `d3-flextree` and `react-tree-graph` are strict trees, one parent per node.
- None of them model non-family relations.

Kinfolk uses [ELK](https://eclipse.dev/elk/)'s layered algorithm, which treats layer
assignment as a graph problem and so handles cousin marriages and remarriages, rendered
with [React Flow](https://reactflow.dev/). Union nodes are laid out as small junction dots.
After ELK runs, Kinfolk's own passes keep each couple adjacent, group siblings under their
parents' union, and put each couple's union dot on the marriage line between the partners.

ELK is also where the cost is. With [scripts/bench-layout.mts](../scripts/bench-layout.mts)
(`pnpm bench:layout`), a generated 200-person family lays out in under a fifth of a
second and the 216-person sample in about a quarter, but 1,000 people take about five
seconds: the median of 7 runs on an Intel i9-14900HX laptop under Node 26, and earlier runs
on the same machine ranged up to 6.3. The same script times `elk.layout()` on its own, and
Kinfolk's own passes are under 20 ms of that; the rest, 97% or more at every size, is ELK.
So ELK runs in a Web Worker in the browser, where a tree that size takes as long as it takes
without freezing the page, and falls back to the page thread if the worker cannot start.

## Fuzzy data is data

Most genealogy records are incomplete. A great-grandmother born "about 1890" is the norm,
not an edge case. Kinfolk stores `unknown` as a value and keeps approximate dates in their
own fields instead of rounding them to a fake 1 January. Kinship terms are computed from
the graph for whoever is viewing, including the ones people get wrong, like "second cousin
once removed" ([lib/tree/kinship.ts](../lib/tree/kinship.ts)).

## Try it

The [sample tree](https://sagargupta.online/kinfolk/tree?demo=1) needs no account. The code
is MIT licensed at [github.com/Sagargupta16/kinfolk](https://github.com/Sagargupta16/kinfolk),
and [SELF-HOSTING.md](SELF-HOSTING.md) deploys your own copy with a private database.
