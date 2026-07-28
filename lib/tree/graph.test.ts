import { describe, expect, it } from "vitest";
import type { Person } from "../db/schema";
import { fuseTrees, lifespan, type TreeSlice, toFlowGraph, type UnionWithChildren } from "./graph";

function person(id: string, treeId: string, overrides: Partial<Person> = {}): Person {
	return {
		id,
		treeId,
		givenName: id,
		familyName: null,
		birthFamilyName: null,
		nickname: null,
		sex: "unknown",
		birthDate: null,
		birthDateApprox: null,
		birthPlace: null,
		deathDate: null,
		deathDateApprox: null,
		deathPlace: null,
		bio: null,
		photoKey: null,
		claimedByUserId: null,
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-01-01"),
		...overrides,
	};
}

function union(
	id: string,
	treeId: string,
	a: string | null,
	b: string | null,
	childIds: string[],
): UnionWithChildren {
	return {
		id,
		treeId,
		partnerAId: a,
		partnerBId: b,
		status: "married",
		startDate: null,
		endDate: null,
		place: null,
		createdAt: new Date("2026-01-01"),
		childIds,
	};
}

function slice(treeId: string, people: Person[], unions: UnionWithChildren[]): TreeSlice {
	return { treeId, treeName: treeId, people, unions };
}

describe("fuseTrees", () => {
	it("leaves a single tree untouched", () => {
		const graph = fuseTrees([slice("t1", [person("a", "t1"), person("b", "t1")], [])], []);
		expect(graph.people).toHaveLength(2);
		expect(graph.people.every((p) => p.sources.length === 1)).toBe(true);
	});

	it("collapses two rows that an accepted link says are one human", () => {
		const graph = fuseTrees(
			[slice("t1", [person("grandpa1", "t1")], []), slice("t2", [person("grandpa2", "t2")], [])],
			[{ personAId: "grandpa1", personBId: "grandpa2" }],
		);

		expect(graph.people).toHaveLength(1);
		expect(graph.people[0]?.sources).toHaveLength(2);
		expect(graph.people[0]?.contributingTreeIds.sort()).toEqual(["t1", "t2"]);
	});

	it("merges transitively across three trees", () => {
		// A links B, B links C. All three are one person even though A and C
		// were never linked directly.
		const graph = fuseTrees(
			[
				slice("t1", [person("a", "t1")], []),
				slice("t2", [person("b", "t2")], []),
				slice("t3", [person("c", "t3")], []),
			],
			[
				{ personAId: "a", personBId: "b" },
				{ personAId: "b", personBId: "c" },
			],
		);

		expect(graph.people).toHaveLength(1);
		expect(graph.people[0]?.sources).toHaveLength(3);
	});

	it("prefers the viewer's own row as the display record", () => {
		const mine = person("mine", "t1", { givenName: "Ramesh" });
		const theirs = person("theirs", "t2", {
			givenName: "Ramesh Kumar",
			updatedAt: new Date("2026-06-01"),
		});

		const graph = fuseTrees(
			[slice("t1", [mine], []), slice("t2", [theirs], [])],
			[{ personAId: "mine", personBId: "theirs" }],
			"t1",
		);

		// Theirs is newer, but mine is the viewer's tree, so mine wins.
		expect(graph.people[0]?.primary.givenName).toBe("Ramesh");
	});

	it("falls back to the most recently updated row when neither tree is primary", () => {
		const older = person("older", "t1", { givenName: "Old", updatedAt: new Date("2026-01-01") });
		const newer = person("newer", "t2", { givenName: "New", updatedAt: new Date("2026-06-01") });

		const graph = fuseTrees(
			[slice("t1", [older], []), slice("t2", [newer], [])],
			[{ personAId: "older", personBId: "newer" }],
		);

		expect(graph.people[0]?.primary.givenName).toBe("New");
	});

	it("rewrites union endpoints onto fused ids", () => {
		const graph = fuseTrees(
			[
				slice(
					"t1",
					[person("dad1", "t1"), person("kid", "t1")],
					[union("u1", "t1", "dad1", null, ["kid"])],
				),
				slice("t2", [person("dad2", "t2")], []),
			],
			[{ personAId: "dad1", personBId: "dad2" }],
		);

		const fusedDadId = graph.idMap.get("dad2");
		expect(graph.unions[0]?.partnerAId).toBe(fusedDadId);
	});

	it("collapses duplicate unions and keeps children from both families", () => {
		// Both trees recorded the same marriage, each knowing a different child.
		const graph = fuseTrees(
			[
				slice(
					"t1",
					[person("h1", "t1"), person("w1", "t1"), person("c1", "t1")],
					[union("u1", "t1", "h1", "w1", ["c1"])],
				),
				slice(
					"t2",
					[person("h2", "t2"), person("w2", "t2"), person("c2", "t2")],
					[union("u2", "t2", "h2", "w2", ["c2"])],
				),
			],
			[
				{ personAId: "h1", personBId: "h2" },
				{ personAId: "w1", personBId: "w2" },
				// c1 and c2 are different children, deliberately unlinked.
			],
		);

		expect(graph.unions).toHaveLength(1);
		expect(graph.unions[0]?.childIds).toHaveLength(2);
	});

	it("treats partner order as insignificant when deduping", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("h1", "t1"), person("w1", "t1")], [union("u1", "t1", "h1", "w1", [])]),
				// Same couple, partners recorded in the opposite columns.
				slice("t2", [person("h2", "t2"), person("w2", "t2")], [union("u2", "t2", "w2", "h2", [])]),
			],
			[
				{ personAId: "h1", personBId: "h2" },
				{ personAId: "w1", personBId: "w2" },
			],
		);

		expect(graph.unions).toHaveLength(1);
	});

	it("produces the same fused ids regardless of input order", () => {
		const links = [{ personAId: "a", personBId: "b" }];
		const forward = fuseTrees(
			[slice("t1", [person("a", "t1")], []), slice("t2", [person("b", "t2")], [])],
			links,
		);
		const reversed = fuseTrees(
			[slice("t2", [person("b", "t2")], []), slice("t1", [person("a", "t1")], [])],
			links,
		);

		expect(forward.people[0]?.id).toBe(reversed.people[0]?.id);
	});
});

describe("toFlowGraph", () => {
	it("emits a union node so siblings share one origin", () => {
		const graph = fuseTrees(
			[
				slice(
					"t1",
					[person("dad", "t1"), person("mum", "t1"), person("kid1", "t1"), person("kid2", "t1")],
					[union("u1", "t1", "dad", "mum", ["kid1", "kid2"])],
				),
			],
			[],
		);

		const { nodes, edges } = toFlowGraph(graph);

		expect(nodes.filter((n) => n.type === "union")).toHaveLength(1);
		// 2 partner edges + 2 child edges, not 4 crossing parent-to-child edges.
		expect(edges.filter((e) => e.kind === "partner")).toHaveLength(2);
		expect(edges.filter((e) => e.kind === "child")).toHaveLength(2);
	});

	it("renders a union one-sided when a partner is not visible", () => {
		// partnerB lives in a tree the viewer cannot see.
		const graph = fuseTrees(
			[slice("t1", [person("dad", "t1")], [union("u1", "t1", "dad", "hidden", [])])],
			[],
		);

		const { edges } = toFlowGraph(graph);
		expect(edges.filter((e) => e.kind === "partner")).toHaveLength(1);
	});

	it("drops child edges pointing at people outside the visible set", () => {
		const graph = fuseTrees(
			[slice("t1", [person("dad", "t1")], [union("u1", "t1", "dad", null, ["ghost"])])],
			[],
		);

		const { edges } = toFlowGraph(graph);
		expect(edges.filter((e) => e.kind === "child")).toHaveLength(0);
	});
});

describe("lifespan", () => {
	it("renders a full range", () => {
		expect(lifespan(person("x", "t1", { birthDate: "1890-04-02", deathDate: "1954-11-30" }))).toBe(
			"1890 - 1954",
		);
	});

	it("uses approximate values when exact dates are missing", () => {
		expect(lifespan(person("x", "t1", { birthDateApprox: "about 1890" }))).toBe("b. about 1890");
	});

	it("returns empty when nothing is known", () => {
		expect(lifespan(person("x", "t1"))).toBe("");
	});
});
