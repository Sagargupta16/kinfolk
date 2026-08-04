/**
 * The panel's family lists. Two failures worth pinning: the subject appearing in
 * their own sibling list, and a directed relation labelled from the wrong end.
 */
import { describe, expect, it } from "vitest";
import type { FlowEdge, FlowNode, FusedPerson, UnionWithChildren } from "./graph";
import { indexRelatives, relativesOf } from "./relatives";

function person(id: string): FlowNode {
	return { id, type: "person", data: { id, primary: { id } } as unknown as FusedPerson };
}

function union(
	id: string,
	partners: [string | null, string | null],
	childIds: string[],
	status = "married",
): FlowNode {
	return {
		id: `union:${id}`,
		type: "union",
		data: {
			union: {
				id,
				partnerAId: partners[0],
				partnerBId: partners[1],
				childIds,
				status,
			} as unknown as UnionWithChildren,
		},
	};
}

const names = (people: { id: string }[]) => people.map((p) => p.id).sort();

/** gran + grandad -> mum, aunt; mum + dad -> kid, sister. */
function graph(): FlowNode[] {
	return [
		person("gran"),
		person("grandad"),
		union("u1", ["gran", "grandad"], ["mum", "aunt"]),
		person("mum"),
		person("aunt"),
		person("dad"),
		union("u2", ["mum", "dad"], ["kid", "sister"]),
		person("kid"),
		person("sister"),
	];
}

describe("relativesOf", () => {
	it("names parents, siblings, partners and children", () => {
		const index = indexRelatives(graph(), []);
		const mum = relativesOf(index, "mum");

		expect(names(mum.parents)).toEqual(["gran", "grandad"]);
		expect(names(mum.siblings)).toEqual(["aunt"]);
		expect(names(mum.partners.map((p) => p.person))).toEqual(["dad"]);
		expect(names(mum.children)).toEqual(["kid", "sister"]);
	});

	it("excludes the subject from their own sibling list", () => {
		// A naive "every child of my parents' unions" pass returns the subject too, and a
		// panel listing you as your own sister is the tell.
		const index = indexRelatives(graph(), []);
		expect(relativesOf(index, "kid").siblings.map((p) => p.id)).toEqual(["sister"]);
	});

	it("carries the union with each partner, so an ended one can be drawn as ended", () => {
		const index = indexRelatives(
			[person("a"), person("b"), union("u1", ["a", "b"], [], "divorced")],
			[],
		);
		expect(relativesOf(index, "a").partners[0]?.union.status).toBe("divorced");
	});

	it("lists a remarried couple once, not once per union row", () => {
		const nodes = [
			person("a"),
			person("b"),
			union("u1", ["a", "b"], [], "divorced"),
			union("u2", ["a", "b"], [], "married"),
		];
		expect(relativesOf(indexRelatives(nodes, []), "a").partners).toHaveLength(1);
	});

	it("lists a child of two unions once", () => {
		// Birth family plus adoptive family. The child is legitimately reached twice, and a
		// panel showing a son twice looks broken in a way that discredits the rest of it.
		const nodes = [
			person("parent"),
			person("child"),
			union("birth", ["parent", null], ["child"]),
			union("adoptive", ["parent", null], ["child"]),
		];
		expect(relativesOf(indexRelatives(nodes, []), "parent").children).toHaveLength(1);
	});

	it("skips a partner who sits in a tree the viewer cannot see", () => {
		// The union renders one-sided on the canvas, so inventing an "Unknown" row in the
		// panel would contradict the picture.
		const nodes = [person("a"), union("u1", ["a", "missing"], [])];
		expect(relativesOf(indexRelatives(nodes, []), "a").partners).toEqual([]);
	});

	it("returns empty lists for somebody with no family recorded", () => {
		const alone = relativesOf(indexRelatives([person("nobody")], []), "nobody");
		expect(alone).toEqual({
			parents: [],
			partners: [],
			children: [],
			siblings: [],
			relations: [],
		});
	});
});

describe("relations on the panel", () => {
	function mentorship(): { nodes: FlowNode[]; edges: FlowEdge[] } {
		return {
			nodes: [person("teacher"), person("pupil")],
			edges: [
				{
					id: "r:1",
					source: "teacher",
					target: "pupil",
					kind: "relation",
					layout: false,
					relationKind: "mentor",
					label: "mentor",
					directed: true,
					closeness: 2,
				},
			],
		};
	}

	it("labels a directed relation from the SUBJECT's end", () => {
		// The projection wrote `label: "mentor"` reading A -> B. Reused verbatim, the
		// pupil's panel would list their mentor as "mentor" -- naming the subject's own
		// role instead of the other person's, which inverts the fact.
		const { nodes, edges } = mentorship();
		const index = indexRelatives(nodes, edges);

		expect(relativesOf(index, "teacher").relations[0]?.label).toBe("mentee");
		expect(relativesOf(index, "pupil").relations[0]?.label).toBe("mentor");
	});

	it("puts live connections before ended ones", () => {
		const nodes = [person("me"), person("current"), person("former")];
		const edges: FlowEdge[] = [
			{
				id: "r:1",
				source: "me",
				target: "former",
				kind: "relation",
				layout: false,
				relationKind: "colleague",
				closeness: 1,
				ended: true,
			},
			{
				id: "r:2",
				source: "me",
				target: "current",
				kind: "relation",
				layout: false,
				relationKind: "friend",
				closeness: 2,
			},
		];

		const relations = relativesOf(indexRelatives(nodes, edges), "me").relations;
		expect(relations.map((r) => r.person.id)).toEqual(["current", "former"]);
	});

	it("ignores family edges, which have their own lists", () => {
		const nodes = [person("a"), person("b"), union("u1", ["a", "b"], [])];
		const edges: FlowEdge[] = [
			{ id: "p:a:u1", source: "a", target: "union:u1", kind: "partner", layout: true },
		];
		expect(relativesOf(indexRelatives(nodes, edges), "a").relations).toEqual([]);
	});
});
