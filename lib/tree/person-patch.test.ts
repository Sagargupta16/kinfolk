/**
 * The patch rule. This exists because the action it was extracted from was destructive:
 * it wrote every column unconditionally, so a compact edit form nulled three fields it
 * never rendered -- including a searchable birth surname. Nothing on screen showed it.
 */
import { describe, expect, it } from "vitest";
import { buildPersonPatch } from "./person-patch";

function form(entries: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(entries)) data.set(key, value);
	return data;
}

describe("buildPersonPatch", () => {
	it("omits keys the form did not submit", () => {
		// THE rule. A compact form posting four fields must not touch the other ten.
		const patch = buildPersonPatch(form({ givenName: "Ada" }));
		expect(patch).toEqual({ givenName: "Ada" });
		expect("birthFamilyName" in patch).toBe(false);
		expect("sourceNote" in patch).toBe(false);
		expect("occupation" in patch).toBe(false);
	});

	it("treats a submitted BLANK as a deliberate erasure", () => {
		// Absence and emptiness are different: the field was on screen and cleared on purpose.
		expect(buildPersonPatch(form({ nickname: "" }))).toEqual({ nickname: null });
	});

	it("trims, so whitespace is not a value", () => {
		expect(buildPersonPatch(form({ givenName: "  Ada  " }))).toEqual({ givenName: "Ada" });
		expect(buildPersonPatch(form({ givenName: "   " }))).toEqual({ givenName: null });
	});

	it("keeps the birth surname when it is submitted", () => {
		// Search matches on it (see lib/tree/search.ts), so losing it makes somebody
		// unfindable by the name they were born with.
		expect(buildPersonPatch(form({ birthFamilyName: "Aasbo" }))).toEqual({
			birthFamilyName: "Aasbo",
		});
	});

	it("falls back to the schema's own honest value for an enum, never null", () => {
		// `sex` and `living` are NOT NULL with a default of "unknown", which is a real stored
		// value in this schema rather than a missing one.
		expect(buildPersonPatch(form({ sex: "" }))).toEqual({ sex: "unknown" });
		expect(buildPersonPatch(form({ living: "" }))).toEqual({ living: "unknown" });
	});

	it("passes a chosen enum through", () => {
		expect(buildPersonPatch(form({ sex: "female", living: "deceased" }))).toEqual({
			sex: "female",
			living: "deceased",
		});
	});

	it("routes a bare birth year to the fuzzy column and clears the exact one", () => {
		/*
		 * `birthDate` is a real `date`, so "1952" is not a value it can hold -- and coercing it
		 * to 1952-01-01 invents a birthday nobody recorded. BOTH columns are written so a value
		 * moving between them cannot leave two disagreeing dates on one row.
		 */
		expect(buildPersonPatch(form({ birthYear: "1952" }))).toEqual({
			birthDate: null,
			birthDateApprox: "1952",
		});
	});

	it("routes a full ISO date to the exact column and clears the fuzzy one", () => {
		expect(buildPersonPatch(form({ birthYear: "1952-03-04" }))).toEqual({
			birthDate: "1952-03-04",
			birthDateApprox: null,
		});
	});

	it("keeps somebody's own words for a death year", () => {
		expect(buildPersonPatch(form({ deathYear: "about 1890" }))).toEqual({
			deathDate: null,
			deathDateApprox: "about 1890",
		});
	});

	it("clears both date columns when the year is submitted blank", () => {
		expect(buildPersonPatch(form({ birthYear: "" }))).toEqual({
			birthDate: null,
			birthDateApprox: null,
		});
	});

	it("returns an empty patch for an empty form, so the action can skip the write", () => {
		expect(buildPersonPatch(new FormData())).toEqual({});
	});

	it("ignores keys that are not editable columns", () => {
		// `treeId`, `verification` and `claimedByUserId` are not user-editable: a tree id would
		// move somebody between graphs, and provenance is a claim the card renders as a tick.
		const patch = buildPersonPatch(
			form({ treeId: "other", verification: "documented", claimedByUserId: "someone" }),
		);
		expect(patch).toEqual({});
	});
});
