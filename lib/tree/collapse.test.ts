/**
 * Collapse is defined by reachability, and these tests exist for the one case that
 * distinguishes it from the naive "hide the subtree" implementation: a person with
 * two parents where only one is collapsed. Subtraction hides them; reachability keeps
 * them, because their other parent still reaches them.
 */
import { describe, expect, it } from "vitest";
import {
	collapseGeneration,
	foldable,
	hiddenCounts,
	NOTHING_COLLAPSED,
	toggleCollapse,
	visibleAfterCollapse,
} from "./collapse";
import type { FlowEdge, FlowNode, FusedPerson, UnionWithChildren } from "./graph";

function person(id: string): FlowNode {
	return { id, type: "person", data: { id, primary: { id } } as unknown as FusedPerson };
}

function union(id: string, partners: string[], childIds: string[]): FlowNode {
	return {
		id: `union:${id}`,
		type: "union",
		data: {
			union: {
				id,
				partnerAId: partners[0] ?? null,
				partnerBId: partners[1] ?? null,
				childIds,
			} as unknown as UnionWithChildren,
		},
	};
}

/** Partner and child edges, exactly as `toFlowGraph` emits them. */
function wire(unionId: string, partners: string[], childIds: string[]): FlowEdge[] {
	return [
		...partners.map((id) => ({
			id: `p:${id}:${unionId}`,
			source: id,
			target: `union:${unionId}`,
			kind: "partner" as const,
			layout: true,
		})),
		...childIds.map((id) => ({
			id: `c:${unionId}:${id}`,
			source: `union:${unionId}`,
			target: id,
			kind: "child" as const,
			layout: true,
		})),
	];
}

/** gran + grandad -> mum; mum + dad -> kid. Two generations, both couples. */
function family(): { nodes: FlowNode[]; edges: FlowEdge[] } {
	return {
		nodes: [
			person("gran"),
			person("grandad"),
			union("u1", ["gran", "grandad"], ["mum"]),
			person("mum"),
			person("dad"),
			union("u2", ["mum", "dad"], ["kid"]),
			person("kid"),
		],
		edges: [...wire("u1", ["gran", "grandad"], ["mum"]), ...wire("u2", ["mum", "dad"], ["kid"])],
	};
}

describe("visibleAfterCollapse", () => {
	it("returns every node when nothing is folded", () => {
		const { nodes, edges } = family();
		expect(visibleAfterCollapse(nodes, edges, NOTHING_COLLAPSED).size).toBe(nodes.length);
	});

	it("hides the line below a collapsed person but keeps the person", () => {
		const { nodes, edges } = family();
		const visible = visibleAfterCollapse(nodes, edges, {
			descendants: new Set(["mum"]),
			ancestors: new Set(),
		});

		// The card stays: it is where the expand control lives, so folding it away would
		// leave no way to undo the gesture.
		expect(visible.has("mum")).toBe(true);
		expect(visible.has("kid")).toBe(false);
		// The junction STAYS, because it is the marriage rather than a route to the child:
		// both partners are still drawn and still joined. It is dropped only once fewer
		// than two of the nodes it joins survive -- see the single-parent case below.
		expect(visible.has("union:u2")).toBe(true);
	});

	it("drops a junction once it has nothing left to join", () => {
		// A single parent's union has one partner and their children. Fold the children and
		// the dot is joining one node to nothing -- a junction to nowhere, which reads as a
		// rendering bug rather than as a fold.
		const nodes: FlowNode[] = [
			person("parent"),
			union("solo", ["parent"], ["child"]),
			person("child"),
		];
		const edges = wire("solo", ["parent"], ["child"]);

		const visible = visibleAfterCollapse(nodes, edges, {
			descendants: new Set(["parent"]),
			ancestors: new Set(),
		});

		expect(visible.has("parent")).toBe(true);
		expect(visible.has("child")).toBe(false);
		expect(visible.has("union:solo")).toBe(false);
	});

	it("folds a couple's children together, because the union owns them", () => {
		// Parentage hangs off the union, so "mum's children" and "dad's children" are the
		// same set and one fold closes both. The alternative -- blocking mum's own edges --
		// detaches her from the partnership she is half of, and the canvas then shows a
		// marriage with one participant.
		const { nodes, edges } = family();
		const visible = visibleAfterCollapse(nodes, edges, {
			descendants: new Set(["mum"]),
			ancestors: new Set(),
		});

		// Both partners stay, still joined by their dot.
		expect(visible.has("mum")).toBe(true);
		expect(visible.has("dad")).toBe(true);
		expect(visible.has("union:u2")).toBe(true);
		// The child below them is what folded.
		expect(visible.has("kid")).toBe(false);
	});

	it("keeps a child reachable through a union that is NOT folded", () => {
		// The whole reason collapse is reachability and not subtraction. An adopted child
		// belongs to two unions; folding one must not remove them from the other family.
		const nodes: FlowNode[] = [
			person("birthParent"),
			union("birth", ["birthParent"], ["child"]),
			person("adopter"),
			union("adoptive", ["adopter"], ["child"]),
			person("child"),
		];
		const edges = [
			...wire("birth", ["birthParent"], ["child"]),
			...wire("adoptive", ["adopter"], ["child"]),
		];

		const visible = visibleAfterCollapse(nodes, edges, {
			descendants: new Set(["birthParent"]),
			ancestors: new Set(),
		});

		// Reached via adopter -> union:adoptive -> child, a route the fold never touched.
		expect(visible.has("child")).toBe(true);
	});

	it("hides a child only when EVERY route to them is folded", () => {
		const nodes: FlowNode[] = [
			person("birthParent"),
			union("birth", ["birthParent"], ["child"]),
			person("adopter"),
			union("adoptive", ["adopter"], ["child"]),
			person("child"),
		];
		const edges = [
			...wire("birth", ["birthParent"], ["child"]),
			...wire("adoptive", ["adopter"], ["child"]),
		];

		const visible = visibleAfterCollapse(nodes, edges, {
			descendants: new Set(["birthParent", "adopter"]),
			ancestors: new Set(),
		});

		expect(visible.has("child")).toBe(false);
	});

	it("folds ancestors upwards, anchored on the person who asked", () => {
		const { nodes, edges } = family();
		const visible = visibleAfterCollapse(
			nodes,
			edges,
			{ descendants: new Set(), ancestors: new Set(["mum"]) },
			// The anchor is what makes this survivable: with the roots folded away there is
			// no entry point, and a walk from nothing would empty the canvas.
			["mum"],
		);

		expect(visible.has("mum")).toBe(true);
		expect(visible.has("gran")).toBe(false);
		expect(visible.has("grandad")).toBe(false);
		expect(visible.has("union:u1")).toBe(false);
		// Downwards is untouched by an upward fold.
		expect(visible.has("kid")).toBe(true);
	});

	it("never empties the canvas when the viewer folds their own ancestors", () => {
		const { nodes, edges } = family();
		const visible = visibleAfterCollapse(
			nodes,
			edges,
			{ descendants: new Set(), ancestors: new Set(["kid"]) },
			["kid"],
		);

		// Everything above is gone, and the viewer is still there. An empty result from a
		// gesture meaning "show me less" is the failure this asserts against.
		expect([...visible]).toEqual(["kid"]);
	});

	it("does not follow relation edges out of a folded branch", () => {
		// A friendship carries no generation. Traversing one would let a folded person
		// stay visible because somebody outside the fold knows them, which reads as the
		// collapse having failed.
		const { nodes, edges } = family();
		const withFriend: FlowNode[] = [...nodes, person("mate")];
		const withRelation: FlowEdge[] = [
			...edges,
			{
				id: "r:1",
				source: "mate",
				target: "kid",
				kind: "relation",
				layout: false,
				relationKind: "friend",
			},
		];

		const visible = visibleAfterCollapse(withFriend, withRelation, {
			descendants: new Set(["mum", "dad"]),
			ancestors: new Set(),
		});

		expect(visible.has("kid")).toBe(false);
	});
});

describe("hiddenCounts", () => {
	it("reports how many people each fold is hiding", () => {
		const { nodes, edges } = family();
		const counts = hiddenCounts(nodes, edges, {
			descendants: new Set(["mum"]),
			ancestors: new Set(),
		});

		// One person, `kid`. The union dot between them is not counted -- see below.
		expect(counts.get("mum")).toBe(1);
	});

	it("counts nobody when the fold hides nobody", () => {
		// An adopted child stays reachable through their other family, so there is nothing
		// to announce -- and a "+1" on a card whose fold changed nothing would be a lie.
		const nodes: FlowNode[] = [
			person("birthParent"),
			union("birth", ["birthParent"], ["child"]),
			person("adopter"),
			union("adoptive", ["adopter"], ["child"]),
			person("child"),
		];
		const edges = [
			...wire("birth", ["birthParent"], ["child"]),
			...wire("adoptive", ["adopter"], ["child"]),
		];

		expect(
			hiddenCounts(nodes, edges, {
				descendants: new Set(["birthParent"]),
				ancestors: new Set(),
			}).get("birthParent"),
		).toBeUndefined();
	});

	it("excludes union dots from the count", () => {
		// A junction is not a person, so counting it would inflate every number by one per
		// generation folded.
		const { nodes, edges } = family();
		const counts = hiddenCounts(nodes, edges, {
			descendants: new Set(),
			ancestors: new Set(["mum"]),
		});

		// gran and grandad, not the union between them.
		expect(counts.get("mum")).toBe(2);
	});
});

describe("foldable", () => {
	it("marks direction by what the person actually has", () => {
		const { edges } = family();
		const folds = foldable(edges);

		// A root has descendants and no ancestors...
		expect(folds.get("gran")).toEqual({ down: true, up: false });
		// ...and a leaf the reverse. Offering a control that cannot do anything reads as
		// a broken feature rather than an inapplicable one.
		expect(folds.get("kid")).toEqual({ down: false, up: true });
		expect(folds.get("mum")).toEqual({ down: true, up: true });
	});
});

describe("toggleCollapse", () => {
	it("adds then removes, leaving the other direction alone", () => {
		const once = toggleCollapse(NOTHING_COLLAPSED, "mum", "descendants");
		expect([...once.descendants]).toEqual(["mum"]);
		expect(once.ancestors.size).toBe(0);

		const twice = toggleCollapse(once, "mum", "descendants");
		expect(twice.descendants.size).toBe(0);
	});

	it("lets one person be folded in both directions at once", () => {
		const down = toggleCollapse(NOTHING_COLLAPSED, "mum", "descendants");
		const both = toggleCollapse(down, "mum", "ancestors");

		expect([...both.descendants]).toEqual(["mum"]);
		expect([...both.ancestors]).toEqual(["mum"]);
	});
});

describe("collapseGeneration", () => {
	it("folds a whole row, then unfolds it", () => {
		const folded = collapseGeneration(NOTHING_COLLAPSED, ["mum", "dad"]);
		expect([...folded.descendants].sort()).toEqual(["dad", "mum"]);

		expect(collapseGeneration(folded, ["mum", "dad"]).descendants.size).toBe(0);
	});

	it("closes a half-folded row rather than inverting it", () => {
		// The failure this guards: a per-person toggle over a mixed row swaps which half
		// is folded, so the gesture appears to do nothing while changing everything.
		const half = collapseGeneration(NOTHING_COLLAPSED, ["mum"]);
		const full = collapseGeneration(half, ["mum", "dad"]);

		expect([...full.descendants].sort()).toEqual(["dad", "mum"]);
	});
});
