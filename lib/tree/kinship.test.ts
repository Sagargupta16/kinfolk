/**
 * Kinship is the one thing on a card a viewer cannot check by looking at the
 * picture, so it is the one thing that has to be right. "Second cousin once
 * removed" is a phrase most people use loosely and every reader will believe.
 */
import { describe, expect, it } from "vitest";
import type { Person, PersonRelation } from "../db/schema";
import type { FusedGraph, UnionWithChildren } from "./graph";
import { bloodTerm, kinshipMap } from "./kinship";

function person(id: string, sex: Person["sex"] = "unknown"): Person {
	return {
		id,
		treeId: "t1",
		givenName: id,
		familyName: null,
		sex,
		living: "living",
		verification: "unverified",
		updatedAt: new Date(0),
	} as unknown as Person;
}

function union(id: string, a: string | null, b: string | null, children: string[]) {
	return { id, partnerAId: a, partnerBId: b, childIds: children } as unknown as UnionWithChildren;
}

function graph(
	ids: Array<[string, Person["sex"]] | string>,
	unions: UnionWithChildren[],
	relations: PersonRelation[] = [],
): FusedGraph {
	const people = ids.map((entry) => {
		const [id, sex] = Array.isArray(entry) ? entry : [entry, "unknown" as const];
		return {
			id,
			primary: person(id, sex),
			sources: [person(id, sex)],
			contributingTreeIds: ["t1"],
			contacts: [],
			trust: { level: "unverified", corroborators: 1, conflicted: false },
		};
	});

	return {
		people,
		unions,
		relations,
		idMap: new Map(people.map((p) => [p.id, p.id])),
	} as FusedGraph;
}

describe("bloodTerm", () => {
	it("names the direct line up", () => {
		expect(bloodTerm(1, 0, "female")).toBe("mother");
		expect(bloodTerm(2, 0, "male")).toBe("grandfather");
		expect(bloodTerm(3, 0, "female")).toBe("great-grandmother");
		expect(bloodTerm(5, 0, "male")).toBe("great-great-great-grandfather");
	});

	it("numbers the greats past three rather than repeating the word", () => {
		// "great-great-great-great-grandmother" is 35 characters on a 200px card, and
		// past three the COUNT is the information rather than the repetition.
		expect(bloodTerm(6, 0, "female")).toBe("4x great-grandmother");
	});

	it("names the direct line down", () => {
		expect(bloodTerm(0, 1, "male")).toBe("son");
		expect(bloodTerm(0, 2, "female")).toBe("granddaughter");
		expect(bloodTerm(0, 4, "unknown")).toBe("great-great-grandchild");
	});

	it("names the sibling and collateral rungs", () => {
		expect(bloodTerm(1, 1, "female")).toBe("sister");
		expect(bloodTerm(2, 1, "male")).toBe("uncle");
		expect(bloodTerm(3, 1, "female")).toBe("great-aunt");
		expect(bloodTerm(1, 2, "female")).toBe("niece");
		expect(bloodTerm(1, 3, "male")).toBe("great-nephew");
	});

	it("counts cousin degree and remove the way genealogy does", () => {
		// Degree is min(up,down) - 1, remove is the difference. Shared grandparents
		// makes first cousins; shared great-grandparents makes seconds.
		expect(bloodTerm(2, 2, "unknown")).toBe("first cousin");
		expect(bloodTerm(3, 3, "unknown")).toBe("second cousin");
		expect(bloodTerm(3, 2, "unknown")).toBe("first cousin once removed");
		expect(bloodTerm(4, 3, "unknown")).toBe("second cousin once removed");
		expect(bloodTerm(4, 2, "unknown")).toBe("first cousin twice removed");
		expect(bloodTerm(6, 2, "unknown")).toBe("first cousin 4x removed");
	});

	it("falls back to a neutral term when sex is not recorded", () => {
		// Genealogy is mostly incomplete data, and "unknown" is a stored value here.
		// Guessing a gender to get a nicer word would assert something nobody wrote.
		expect(bloodTerm(1, 0, "unknown")).toBe("parent");
		expect(bloodTerm(1, 1, "other")).toBe("sibling");
		expect(bloodTerm(2, 1, "unknown")).toBe("aunt or uncle");
	});
});

describe("kinshipMap", () => {
	/**
	 * gran + grandpa
	 *   |-- mum + dad          (mum is gran's daughter)
	 *   |     |-- me, sis
	 *   |-- aunt + uncleByMarriage
	 *         |-- cousin
	 */
	const family = graph(
		[
			["gran", "female"],
			["grandpa", "male"],
			["mum", "female"],
			["dad", "male"],
			["me", "male"],
			["sis", "female"],
			["aunt", "female"],
			["uncleByMarriage", "male"],
			["cousin", "female"],
		],
		[
			union("u1", "gran", "grandpa", ["mum", "aunt"]),
			union("u2", "mum", "dad", ["me", "sis"]),
			union("u3", "aunt", "uncleByMarriage", ["cousin"]),
		],
	);

	it("labels the whole household from one viewer", () => {
		const labels = kinshipMap(family, "me");
		const at = (id: string) => labels.get(id)?.label;

		expect(at("me")).toBe("you");
		expect(at("mum")).toBe("mother");
		expect(at("dad")).toBe("father");
		expect(at("sis")).toBe("sister");
		expect(at("gran")).toBe("grandmother");
		expect(at("grandpa")).toBe("grandfather");
		expect(at("aunt")).toBe("aunt");
		expect(at("cousin")).toBe("first cousin");
	});

	it("prefers the closest path when two exist", () => {
		// `dad` is reachable as a parent (1,0) and nothing else, but `mum` is also an
		// ancestor of `cousin`'s branch. Total distance decides, so a parent is never
		// downgraded to a cousin by a shared grandparent further up.
		expect(kinshipMap(family, "me").get("mum")?.via).toBe("blood");
		expect(kinshipMap(family, "me").get("mum")?.label).toBe("mother");
	});

	it("reads a partner of a blood relative from that relative's rung", () => {
		// The aunt's husband is no blood relation and no ancestor walk finds him. The
		// rung comes from HER (2,1), which is what makes him an uncle rather than a
		// bare "in-law" -- a word that landed on 29 of 117 cards in the sample tree
		// and bucketed a quarter of the canvas into one term.
		const kin = kinshipMap(family, "me").get("uncleByMarriage");
		expect(kin?.via).toBe("in_law");
		expect(kin?.label).toBe("uncle by marriage");
	});

	it("describes an in-law rung English has no word for, rather than flattening it", () => {
		expect(bloodTerm(2, 1, "male")).toBe("uncle");
		// Same rungs, one step out through a marriage.
		const labels = kinshipMap(family, "me");
		expect(labels.get("uncleByMarriage")?.label).toBe("uncle by marriage");
	});

	it("names the three in-law rungs English has words for", () => {
		//   herMum + herDad
		//        |-- spouse + me
		const married = graph(
			[
				["me", "male"],
				["spouse", "female"],
				["herMum", "female"],
				["herSis", "female"],
			],
			[union("u1", "herMum", null, ["spouse", "herSis"]), union("u2", "me", "spouse", [])],
		);

		const labels = kinshipMap(married, "me");
		expect(labels.get("spouse")?.label).toBe("wife");
		expect(labels.get("spouse")?.via).toBe("partner");
		expect(labels.get("herMum")?.label).toBe("mother-in-law");
		expect(labels.get("herSis")?.label).toBe("sister-in-law");
	});

	it("falls back to a recorded relation for people the family graph cannot reach", () => {
		// The case that makes this a contact graph rather than a pedigree: a friend
		// shares no ancestor with anybody, so blood, partner and in-law all miss.
		const social = graph(
			["me", "pal"],
			[],
			[
				{
					id: "r1",
					personAId: "me",
					personBId: "pal",
					kind: "close_friend",
					label: null,
				} as unknown as PersonRelation,
			],
		);

		const kin = kinshipMap(social, "me").get("pal");
		expect(kin?.label).toBe("close friend");
		expect(kin?.via).toBe("relation");
	});

	it("reads a directed relation from the other end", () => {
		// "mentee" is not a stored value; it is the mentor row read from B's side.
		const mentored = graph(
			["me", "boss"],
			[],
			[
				{
					id: "r1",
					personAId: "boss",
					personBId: "me",
					kind: "mentor",
					label: null,
				} as unknown as PersonRelation,
			],
		);

		expect(kinshipMap(mentored, "me").get("boss")?.label).toBe("mentor");
	});

	it("lets blood beat a recorded relation for the same person", () => {
		// A man who is both your uncle and your colleague is your uncle. This is why
		// the passes are ordered rather than merged.
		const both = graph(
			[
				["me", "male"],
				["gran", "female"],
				["mum", "female"],
				["uncle", "male"],
			],
			[union("u1", "gran", null, ["mum", "uncle"]), union("u2", "mum", null, ["me"])],
			[
				{
					id: "r1",
					personAId: "me",
					personBId: "uncle",
					kind: "colleague",
					label: null,
				} as unknown as PersonRelation,
			],
		);

		expect(kinshipMap(both, "me").get("uncle")?.label).toBe("uncle");
	});

	it("returns nothing without a viewer, and nothing for a stranger", () => {
		// The demo's mine-only mode and a signed-out visitor both hit this.
		expect(kinshipMap(family).size).toBe(0);
		expect(kinshipMap(family, "nobody").size).toBe(0);
	});

	it("survives a cousin marriage rather than looping", () => {
		// Two branches rejoining is why ancestor walks here are breadth-first with a
		// visited set. Without one this is an infinite descent.
		const rejoined = graph(
			[["me", "male"], ["mum", "female"], ["dad", "male"], "shared"],
			[union("u1", "shared", null, ["mum", "dad"]), union("u2", "mum", "dad", ["me"])],
		);

		const labels = kinshipMap(rejoined, "me");
		expect(labels.get("mum")?.label).toBe("mother");
		expect(labels.get("shared")?.label).toBe("grandparent");
	});
});
