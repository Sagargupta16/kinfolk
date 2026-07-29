import { describe, expect, it } from "vitest";
import type {
	ContactDetail,
	ContactKind,
	Person,
	PersonRelation,
	RelationKind,
} from "../db/schema";
import { fuseTrees, lifespan, type TreeSlice, toFlowGraph, type UnionWithChildren } from "./graph";
import { canonicalPair, relationLabel } from "./relations";

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

function relation(
	id: string,
	treeId: string,
	kind: RelationKind,
	a: string,
	b: string,
): PersonRelation {
	const pair = canonicalPair(kind, a, b);
	return {
		id,
		treeId,
		personAId: pair.personAId,
		personBId: pair.personBId,
		kind,
		label: null,
		startDate: null,
		endDate: null,
		note: null,
		createdAt: new Date("2026-01-01"),
	};
}

function contact(
	id: string,
	personId: string,
	kind: ContactKind,
	value: string,
	overrides: Partial<ContactDetail> = {},
): ContactDetail {
	return {
		id,
		personId,
		kind,
		value,
		label: null,
		visibility: "tree",
		isPrimary: false,
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-01-01"),
		...overrides,
	};
}

function slice(
	treeId: string,
	people: Person[],
	unions: UnionWithChildren[],
	extra: Partial<Pick<TreeSlice, "relations" | "contacts">> = {},
): TreeSlice {
	return { treeId, treeName: treeId, people, unions, ...extra };
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
		const older = person("older", "t1", {
			givenName: "Old",
			updatedAt: new Date("2026-01-01"),
		});
		const newer = person("newer", "t2", {
			givenName: "New",
			updatedAt: new Date("2026-06-01"),
		});

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

	it("keeps half-siblings apart when both mothers are unrecorded", () => {
		// One father, two children by mothers nobody recorded. Coercing the null
		// partner to a comparable key would merge these into one union and turn
		// half-siblings into full siblings.
		const graph = fuseTrees(
			[
				slice(
					"t1",
					[person("dad", "t1"), person("kid1", "t1"), person("kid2", "t1")],
					[union("u1", "t1", "dad", null, ["kid1"]), union("u2", "t1", "dad", null, ["kid2"])],
				),
			],
			[],
		);

		expect(graph.unions).toHaveLength(2);
		expect(graph.unions.map((u) => u.childIds)).toEqual([["kid1"], ["kid2"]]);
	});

	it("keeps two parentless couples apart", () => {
		// Two unrelated families whose parents are both unknown. They share no
		// endpoint and no child, so nothing justifies merging them.
		const graph = fuseTrees(
			[
				slice(
					"t1",
					[person("a1", "t1"), person("a2", "t1"), person("b1", "t1"), person("b2", "t1")],
					[
						union("u1", "t1", null, null, ["a1", "a2"]),
						union("u2", "t1", null, null, ["b1", "b2"]),
					],
				),
			],
			[],
		);

		expect(graph.unions).toHaveLength(2);
	});

	it("still merges one single-parent family recorded by two trees", () => {
		// A shared child is what says "same family": half-siblings never share one.
		const graph = fuseTrees(
			[
				slice(
					"t1",
					[person("mum1", "t1"), person("kid1", "t1")],
					[union("u1", "t1", "mum1", null, ["kid1"])],
				),
				slice(
					"t2",
					[person("mum2", "t2"), person("kid2", "t2"), person("kid3", "t2")],
					[union("u2", "t2", "mum2", null, ["kid2", "kid3"])],
				),
			],
			[
				{ personAId: "mum1", personBId: "mum2" },
				{ personAId: "kid1", personBId: "kid2" },
			],
		);

		expect(graph.unions).toHaveLength(1);
		// The linked child counts once; the second tree's other child is kept.
		expect(graph.unions[0]?.childIds).toHaveLength(2);
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

describe("relation kinds", () => {
	it("sorts the pair for symmetric kinds so a friendship cannot be stored twice", () => {
		expect(canonicalPair("friend", "z", "a")).toEqual({
			personAId: "a",
			personBId: "z",
		});
		expect(canonicalPair("friend", "a", "z")).toEqual({
			personAId: "a",
			personBId: "z",
		});
	});

	it("preserves order for directed kinds, since A holds the role", () => {
		expect(canonicalPair("mentor", "z", "a")).toEqual({
			personAId: "z",
			personBId: "a",
		});
	});

	it("reads a directed relation from either end", () => {
		expect(relationLabel("mentor", "teacher-id", "teacher-id")).toBe("mentor");
		expect(relationLabel("mentor", "teacher-id", "student-id")).toBe("mentee");
	});

	it("prefers a custom label over the generated one", () => {
		expect(relationLabel("cousin", "a", "a", "second cousin, mother's side")).toBe(
			"second cousin, mother's side",
		);
	});
});

describe("relations in the fused graph", () => {
	it("rewrites relation endpoints onto fused ids", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("uncle1", "t1"), person("kid", "t1")], [], {
					relations: [relation("r1", "t1", "mentor", "uncle1", "kid")],
				}),
				slice("t2", [person("uncle2", "t2")], []),
			],
			[{ personAId: "uncle1", personBId: "uncle2" }],
		);

		const fusedUncleId = graph.idMap.get("uncle2");
		expect(graph.relations[0]?.personAId).toBe(fusedUncleId);
	});

	it("collapses the same friendship recorded by two families", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("a1", "t1"), person("b1", "t1")], [], {
					relations: [relation("r1", "t1", "friend", "a1", "b1")],
				}),
				slice("t2", [person("a2", "t2"), person("b2", "t2")], [], {
					// Same two humans, recorded in the opposite order.
					relations: [relation("r2", "t2", "friend", "b2", "a2")],
				}),
			],
			[
				{ personAId: "a1", personBId: "a2" },
				{ personAId: "b1", personBId: "b2" },
			],
		);

		expect(graph.relations).toHaveLength(1);
	});

	it("keeps both directions of a directed relation, since they are different claims", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("a", "t1"), person("b", "t1")], [], {
					relations: [
						relation("r1", "t1", "mentor", "a", "b"),
						relation("r2", "t1", "mentor", "b", "a"),
					],
				}),
			],
			[],
		);

		expect(graph.relations).toHaveLength(2);
	});

	it("drops a relation that fusion turned into a self-loop", () => {
		// Two rows the owner later declared to be the same human, with a stale
		// relation between them.
		const graph = fuseTrees(
			[
				slice("t1", [person("dup1", "t1")], [], {
					relations: [relation("r1", "t1", "friend", "dup1", "dup2")],
				}),
				slice("t2", [person("dup2", "t2")], []),
			],
			[{ personAId: "dup1", personBId: "dup2" }],
		);

		expect(graph.relations).toHaveLength(0);
	});

	it("marks relation edges as non-layout so they cannot shift a generation", () => {
		const graph = fuseTrees(
			[
				slice(
					"t1",
					[person("dad", "t1"), person("kid", "t1"), person("friend", "t1")],
					[union("u1", "t1", "dad", null, ["kid"])],
					{ relations: [relation("r1", "t1", "friend", "kid", "friend")] },
				),
			],
			[],
		);

		const { edges } = toFlowGraph(graph);
		const relationEdges = edges.filter((e) => e.kind === "relation");

		expect(relationEdges).toHaveLength(1);
		expect(relationEdges[0]?.layout).toBe(false);
		// Every family edge must still drive layout.
		expect(edges.filter((e) => e.kind !== "relation").every((e) => e.layout)).toBe(true);
	});

	it("omits relation edges entirely when the overlay is off", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("a", "t1"), person("b", "t1")], [], {
					relations: [relation("r1", "t1", "friend", "a", "b")],
				}),
			],
			[],
		);

		const { edges } = toFlowGraph(graph, { includeRelations: false });
		expect(edges.filter((e) => e.kind === "relation")).toHaveLength(0);
	});

	it("drops a relation whose other end is not visible", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("a", "t1")], [], {
					relations: [relation("r1", "t1", "friend", "a", "someone-in-a-hidden-tree")],
				}),
			],
			[],
		);

		const { edges } = toFlowGraph(graph);
		expect(edges.filter((e) => e.kind === "relation")).toHaveLength(0);
	});

	it("labels a directed relation A -> B and marks it directed", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("guru", "t1"), person("pupil", "t1")], [], {
					relations: [relation("r1", "t1", "teacher", "guru", "pupil")],
				}),
			],
			[],
		);

		const edge = toFlowGraph(graph).edges.find((e) => e.kind === "relation");
		expect(edge?.source).toBe("guru");
		expect(edge?.label).toBe("teacher");
		expect(edge?.directed).toBe(true);
	});
});

describe("contact details", () => {
	it("gathers contacts from every contributing row", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("a1", "t1")], [], {
					contacts: { a1: [contact("c1", "a1", "phone", "+91 111")] },
				}),
				slice("t2", [person("a2", "t2")], [], {
					contacts: { a2: [contact("c2", "a2", "email", "x@example.com")] },
				}),
			],
			[{ personAId: "a1", personBId: "a2" }],
		);

		expect(graph.people[0]?.contacts).toHaveLength(2);
	});

	it("dedupes the same number recorded by two families", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("a1", "t1")], [], {
					contacts: { a1: [contact("c1", "a1", "phone", "+91 98765 43210")] },
				}),
				slice("t2", [person("a2", "t2")], [], {
					// Same value, different casing/whitespace is still the same number.
					contacts: { a2: [contact("c2", "a2", "phone", " +91 98765 43210 ")] },
				}),
			],
			[{ personAId: "a1", personBId: "a2" }],
		);

		expect(graph.people[0]?.contacts).toHaveLength(1);
	});

	it("keeps a primary flag set by either family when deduping", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("a1", "t1")], [], {
					contacts: { a1: [contact("c1", "a1", "phone", "+91 111")] },
				}),
				slice("t2", [person("a2", "t2")], [], {
					contacts: {
						a2: [contact("c2", "a2", "phone", "+91 111", { isPrimary: true })],
					},
				}),
			],
			[{ personAId: "a1", personBId: "a2" }],
		);

		expect(graph.people[0]?.contacts[0]?.isPrimary).toBe(true);
	});

	it("keeps two different numbers for the same person", () => {
		const graph = fuseTrees(
			[
				slice("t1", [person("a", "t1")], [], {
					contacts: {
						a: [contact("c1", "a", "phone", "+91 111"), contact("c2", "a", "phone", "+91 222")],
					},
				}),
			],
			[],
		);

		expect(graph.people[0]?.contacts).toHaveLength(2);
	});

	it("leaves contacts empty when none were passed", () => {
		const graph = fuseTrees([slice("t1", [person("a", "t1")], [])], []);
		expect(graph.people[0]?.contacts).toEqual([]);
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
