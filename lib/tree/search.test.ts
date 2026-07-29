/**
 * Search tests. The property that matters is ORDER: a substring match is trivial,
 * but a tree with eleven Fortins is unusable if the ranking is wrong.
 */
import { describe, expect, it } from "vitest";
import type { Person } from "../db/schema";
import type { Degree } from "./density";
import type { FusedPerson } from "./graph";
import { searchPeople } from "./search";

function person(id: string, fields: Partial<Person>): FusedPerson {
	const primary = { id, givenName: null, familyName: null, ...fields } as Person;
	return {
		id,
		primary,
		sources: [primary],
		contributingTreeIds: [],
		contacts: [],
	} as unknown as FusedPerson;
}

describe("searchPeople", () => {
	const people = [
		person("a", { givenName: "Florence", familyName: "Fortin", birthDate: "1985-03-02" }),
		person("b", { givenName: "Nelson", familyName: "Fortin", birthPlace: "Florence, Italy" }),
		person("c", { givenName: "Rita", familyName: "Fortin", birthFamilyName: "Florens" }),
		person("d", { givenName: "Halvor", familyName: "Aasbø" }),
	];

	it("ignores a query too short to narrow anything", () => {
		// One character against 117 people returns most of the tree, which is noise
		// dressed as a result.
		expect(searchPeople(people, "f")).toEqual([]);
		expect(searchPeople(people, "")).toEqual([]);
	});

	it("matches a name case-insensitively", () => {
		const hits = searchPeople(people, "FLORENCE FORTIN");
		expect(hits.map((h) => h.id)).toEqual(["a"]);
	});

	it("ranks a name before a birth name before a birthplace", () => {
		// All three contain "floren". The person actually called Florence has to come
		// first, or typing a name finds everyone except them.
		const hits = searchPeople(people, "floren");
		expect(hits.map((h) => h.id)).toEqual(["a", "c", "b"]);
		expect(hits.map((h) => h.matched)).toEqual(["name", "birthName", "place"]);
	});

	it("ranks a prefix match above a mid-word one in the same field", () => {
		const hits = searchPeople(
			[person("x", { givenName: "Ann", familyName: "Ortiz" }), person("y", { givenName: "Ortiz" })],
			"ort",
		);
		expect(hits[0]?.id).toBe("y");
	});

	it("folds accents so an ASCII keyboard can find a name", () => {
		// Nobody types the slashed o. If they have to, the search does not work for
		// exactly the half of a family tree that is foreign to the person searching.
		expect(searchPeople(people, "aasbo").map((h) => h.id)).toEqual(["d"]);
	});

	it("returns one hit per person, not one per matching field", () => {
		const both = [person("z", { givenName: "Florence", birthPlace: "Florence" })];
		expect(searchPeople(both, "floren")).toHaveLength(1);
	});

	it("carries dates, so two relatives with one name can be told apart", () => {
		expect(searchPeople(people, "florence fortin")[0]?.dates).toBe("b. 1985");
	});

	it("caps the result count", () => {
		const many = Array.from({ length: 30 }, (_, i) =>
			person(`p${i}`, { givenName: "Fortin", familyName: `${i}` }),
		);
		expect(searchPeople(many, "fortin", 5)).toHaveLength(5);
	});

	it("finds nobody rather than guessing at a misspelling", () => {
		// Deliberate: fuzzy matching in a tree where a surname repeats eleven times
		// ranks a cousin above the person whose name was typed in full.
		expect(searchPeople(people, "florance")).toEqual([]);
	});
});

describe("searchPeople ranking between namesakes", () => {
	// Same name, same field, same match position: nothing but the context separates
	// them. This is the real case -- the sample tree has two Aaron Fortins.
	const namesakes = [
		person("n1", { givenName: "Aaron", familyName: "Fortin" }),
		person("n2", { givenName: "Aaron", familyName: "Fortin" }),
		person("n3", { givenName: "Aaron", familyName: "Fortin" }),
	];

	it("puts the viewer first, and marks which row they are", () => {
		const hits = searchPeople(namesakes, "aaron", 8, { selfId: "n3" });
		expect(hits[0]?.id).toBe("n3");
		expect(hits.map((h) => h.isSelf)).toEqual([true, false, false]);
	});

	it("ranks the better-connected namesake above the stub", () => {
		// A person with a partner, children and friends recorded is the one being
		// looked for; a name hanging off one edge is an unfinished record.
		const degree = new Map([
			["n1", { rank: 0.1 } as Degree],
			["n2", { rank: 0.9 } as Degree],
			["n3", { rank: 0.4 } as Degree],
		]);
		expect(searchPeople(namesakes, "aaron", 8, { degree }).map((h) => h.id)).toEqual([
			"n2",
			"n3",
			"n1",
		]);
	});

	it("still ranks the field above either tie-break", () => {
		// Connectedness breaks a tie; it must never promote a birthplace hit over
		// somebody's actual name, or a well-connected stranger outranks the person you
		// typed.
		const hits = searchPeople(
			[
				person("place", { givenName: "Ida", birthPlace: "Aaron Springs" }),
				person("name", { givenName: "Aaron", familyName: "Fortin" }),
			],
			"aaron",
			8,
			{ degree: new Map([["place", { rank: 1 } as Degree]]), selfId: "place" },
		);
		expect(hits.map((h) => h.id)).toEqual(["name", "place"]);
	});

	it("recognises the viewer through a fusion, where the ids differ", () => {
		// The one that would fail silently. A fused id is the union-find root -- the
		// SMALLEST member id -- so a viewer whose own row is not the smallest of a
		// merged set has a fused id that is somebody else's row id. Comparing ids
		// directly would stop marking exactly the people the combined view merged.
		const merged = person("a1", { givenName: "Ida", familyName: "Rekdal" });
		merged.sources = [
			{ id: "a1", givenName: "Ida", familyName: "Rekdal" } as Person,
			{ id: "z9", givenName: "Ida", familyName: "Rekdal" } as Person,
		];

		expect(searchPeople([merged], "ida", 8, { selfId: "z9" })[0]?.isSelf).toBe(true);
		expect(searchPeople([merged], "ida", 8, { selfId: "nobody" })[0]?.isSelf).toBe(false);
	});
});
