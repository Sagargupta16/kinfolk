/**
 * Which row an edit writes to. The failure this guards is the worst kind available here:
 * writing one family's values into another family's record, which no screen would show.
 */
import { describe, expect, it } from "vitest";
import type { Person } from "../db/schema";
import { editInitialValues, editTarget, yearValue } from "./editable";
import type { FusedPerson } from "./graph";

function row(id: string, treeId: string, givenName: string): Person {
	return { id, treeId, givenName, familyName: null } as unknown as Person;
}

function fused(id: string, sources: Person[]): FusedPerson {
	return {
		id,
		primary: sources[0] as Person,
		sources,
		contributingTreeIds: [...new Set(sources.map((s) => s.treeId))],
		contacts: [],
		trust: { level: "unverified", corroborators: sources.length, conflicted: false },
	};
}

describe("editTarget", () => {
	it("picks the source row in the viewer's own tree, not the fused id", () => {
		/*
		 * THE case this module exists for. `fuseTrees` sets the fused id to the smallest member
		 * id, which is a uuid comparison -- so on a merged person it lands on the FAR family's
		 * row roughly half the time, and `treeIdForEditablePerson` would refuse the write. The
		 * user would be told they may not edit their own record.
		 */
		const person = fused("aaa-far", [
			row("aaa-far", "theirs", "Katharina"),
			row("zzz-mine", "mine", "Catherine"),
		]);
		expect(editTarget(person, ["mine"])).toEqual({
			editable: true,
			personId: "zzz-mine",
			treeId: "mine",
		});
	});

	it("honours the caller's tree ORDER rather than uuid order", () => {
		// A viewer can hold write grants on several trees, and a merged person can carry a row
		// in more than one. The caller's primary graph should win, not whichever id sorts first.
		const person = fused("a", [row("a", "second", "A"), row("b", "first", "B")]);
		expect(editTarget(person, ["first", "second"])).toMatchObject({ personId: "b" });
		expect(editTarget(person, ["second", "first"])).toMatchObject({ personId: "a" });
	});

	it("refuses when no source sits in an editable tree", () => {
		// An accepted link means "this is the same human", never "you may edit my records".
		const person = fused("a", [row("a", "theirs", "A")]);
		const result = editTarget(person, ["mine"]);
		expect(result.editable).toBe(false);
	});

	it("explains a merged person differently from a foreign one", () => {
		// A person visible but not editable is normal for a linked family, so the message says
		// whose it is rather than implying something is broken.
		const merged = fused("a", [row("a", "theirs", "A"), row("b", "alsoTheirs", "A")]);
		const foreign = fused("c", [row("c", "theirs", "C")]);

		const mergedResult = editTarget(merged, ["mine"]);
		const foreignResult = editTarget(foreign, ["mine"]);
		expect(mergedResult.editable).toBe(false);
		expect(foreignResult.editable).toBe(false);
		if (!mergedResult.editable && !foreignResult.editable) {
			expect(mergedResult.reason).not.toBe(foreignResult.reason);
			expect(mergedResult.reason).toContain("another family");
		}
	});

	it("refuses a read-only viewer before looking at any row", () => {
		const person = fused("a", [row("a", "mine", "A")]);
		const result = editTarget(person, []);
		expect(result.editable).toBe(false);
		if (!result.editable) expect(result.reason).toContain("read-only");
	});

	it("handles a person with no sources at all", () => {
		// Defensive, but cheap: a fused person with an empty sources array would otherwise
		// resolve to `undefined.id` at the call site.
		expect(editTarget(fused("a", []), ["mine"]).editable).toBe(false);
	});
});

describe("editInitialValues", () => {
	it("reads the TARGET row, never `primary`", () => {
		/*
		 * `primary` is whichever contributing row won the display contest, so on a merged person
		 * it can be the far family's data. A form prefilled from their row copies their values
		 * into yours the moment you press save -- a data corruption with no visible tell.
		 */
		const theirs = row("aaa", "theirs", "Katharina");
		const mine = row("zzz", "mine", "Catherine");
		const person = fused("aaa", [theirs, mine]);

		expect(person.primary.givenName).toBe("Katharina");
		expect(editInitialValues(person, "zzz")?.givenName).toBe("Catherine");
	});

	it("returns undefined for a row that is not a source", () => {
		expect(editInitialValues(fused("a", [row("a", "mine", "A")]), "nope")).toBeUndefined();
	});
});

describe("yearValue", () => {
	it("prefers the exact date, trimmed to a year", () => {
		expect(yearValue("1952-03-04", null)).toBe("1952");
	});

	it("falls back to the fuzzy column", () => {
		expect(yearValue(null, "1890")).toBe("1890");
	});

	it("keeps somebody's own words verbatim", () => {
		// Round-tripping through a year input must not discard the word they chose.
		expect(yearValue(null, "about 1890")).toBe("about 1890");
	});

	it("is blank when neither is recorded", () => {
		expect(yearValue(null, null)).toBe("");
	});
});
