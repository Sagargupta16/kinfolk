import { describe, expect, it } from "vitest";
import type { ContactDetail, Visibility } from "../db/schema";
import { canSee, filterContacts, type ViewerAccess } from "./visibility";

function contact(id: string, personId: string, visibility: Visibility): ContactDetail {
	return {
		id,
		personId,
		kind: "phone",
		value: `+91 0000 ${id}`,
		label: null,
		visibility,
		isPrimary: false,
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-01-01"),
	};
}

describe("canSee", () => {
	const cases: Array<[ViewerAccess, Visibility, boolean]> = [
		["member", "tree", true],
		["member", "linked", true],
		["member", "shared", true],
		// The case that matters: a linked relative must not receive tree-private rows.
		["linked", "tree", false],
		["linked", "linked", true],
		["linked", "shared", true],
		["shared", "tree", false],
		["shared", "linked", false],
		["shared", "shared", true],
	];

	for (const [access, visibility, expected] of cases) {
		it(`${access} viewer ${expected ? "sees" : "cannot see"} a ${visibility} detail`, () => {
			expect(canSee(visibility, access)).toBe(expected);
		});
	}
});

describe("filterContacts", () => {
	it("applies each tree's own access level in a combined view", () => {
		// The viewer owns t1 and is merely linked to t2. One global level would
		// either leak t2's private rows or hide the viewer's own.
		const contacts = {
			mine: [contact("a", "mine", "tree"), contact("b", "mine", "shared")],
			theirs: [contact("c", "theirs", "tree"), contact("d", "theirs", "shared")],
		};

		const visible = filterContacts(
			contacts,
			new Map([
				["mine", "t1"],
				["theirs", "t2"],
			]),
			new Map<string, ViewerAccess>([
				["t1", "member"],
				["t2", "linked"],
			]),
		);

		expect(visible.mine?.map((c) => c.id)).toEqual(["a", "b"]);
		expect(visible.theirs?.map((c) => c.id)).toEqual(["d"]);
	});

	it("fails closed for a person whose tree is unknown", () => {
		const visible = filterContacts(
			{ orphan: [contact("a", "orphan", "shared")] },
			new Map(),
			new Map<string, ViewerAccess>([["t1", "member"]]),
		);

		expect(visible.orphan).toBeUndefined();
	});

	it("fails closed for a tree the viewer has no grant on", () => {
		const visible = filterContacts(
			{ someone: [contact("a", "someone", "shared")] },
			new Map([["someone", "t9"]]),
			new Map<string, ViewerAccess>([["t1", "member"]]),
		);

		expect(visible.someone).toBeUndefined();
	});

	it("omits a person entirely when every detail is filtered out", () => {
		const visible = filterContacts(
			{ p: [contact("a", "p", "tree")] },
			new Map([["p", "t1"]]),
			new Map<string, ViewerAccess>([["t1", "shared"]]),
		);

		expect(visible).toEqual({});
	});
});
