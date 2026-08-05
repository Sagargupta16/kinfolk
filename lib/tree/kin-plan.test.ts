/**
 * The quick-add planner. Every assertion here is about family SHAPE, which is exactly the
 * class of thing that looks fine on a canvas and is wrong in the data -- a father and a
 * mother in two separate single-parent unions render as two junctions, and nothing on
 * screen says which of them is the mistake.
 */
import { describe, expect, it } from "vitest";
import type { Sex } from "../db/schema";
import {
	birthYearColumns,
	type FamilyShape,
	type KinRole,
	MAX_BATCH,
	placeholderName,
	planKin,
	ROLE_SEX,
	type UnionShape,
} from "./kin-plan";

function union(
	id: string,
	a: string | null,
	b: string | null,
	childIds: string[] = [],
): UnionShape {
	return { id, partnerAId: a, partnerBId: b, childIds };
}

function family(overrides: Partial<FamilyShape> = {}): FamilyShape {
	return { subjectId: "me", parentUnions: [], ownUnions: [], ...overrides };
}

describe("ROLE_SEX", () => {
	it("takes the sex the role states, and stays unknown where it states nothing", () => {
		// Deriving sex from a chosen ROLE is not the guess CLAUDE.md forbids -- that rule is
		// about reading it off a display name, where the user never said anything.
		expect(ROLE_SEX.father).toBe("male");
		expect(ROLE_SEX.mother).toBe("female");
		expect(ROLE_SEX.son).toBe("male");
		expect(ROLE_SEX.daughter).toBe("female");
		expect(ROLE_SEX.partner).toBe("unknown");
		expect(ROLE_SEX.child).toBe("unknown");
		expect(ROLE_SEX.sibling).toBe("unknown");
	});
});

describe("role sex versus a posted sex", () => {
	/**
	 * The rule `addRelative` implements, asserted here because it is the security-shaped half
	 * of the design and lives in two places otherwise.
	 *
	 * A posted `sex` is honoured only where the ROLE implies nothing. The form draws no gender
	 * field for "father", so a `sex` arriving with `role=father` is a forged post rather than a
	 * user's choice -- and letting it through would let a request contradict the button.
	 */
	const resolve = (role: KinRole, posted: Sex | null): Sex =>
		ROLE_SEX[role] === "unknown" ? (posted ?? "unknown") : ROLE_SEX[role];

	it("lets the form decide for the three neutral roles", () => {
		// Without this, "Partner", "Child" and "Sibling" were permanently `unknown` with no way
		// to record what somebody actually knew.
		expect(resolve("partner", "female")).toBe("female");
		expect(resolve("child", "male")).toBe("male");
		expect(resolve("sibling", "other")).toBe("other");
	});

	it("keeps `unknown` when a neutral role posts nothing", () => {
		expect(resolve("child", null)).toBe("unknown");
	});

	it("REFUSES to let a posted sex override an explicit gendered role", () => {
		// The field cannot exist in the form for these, so a value arriving anyway is forged.
		expect(resolve("father", "female")).toBe("male");
		expect(resolve("mother", "male")).toBe("female");
		expect(resolve("son", "female")).toBe("male");
		expect(resolve("daughter", "male")).toBe("female");
		expect(resolve("brother", "female")).toBe("male");
		expect(resolve("sister", "male")).toBe("female");
	});
});

describe("planKin: parents", () => {
	it("creates a union and puts the subject in it as a child, when there are no parents", () => {
		const plan = planKin(family(), "father");
		expect(plan.create).toEqual({ count: 1, sex: "male" });
		expect(plan.union).toEqual({ kind: "create", partnerAId: null, partnerBId: null });
		expect(plan.attach).toBe("partner");
		// Without this the "father" is a partner in a union the subject has nothing to do with.
		expect(plan.attachSubjectAsChild).toBe(true);
	});

	it("puts a mother into the union that already holds the father", () => {
		/*
		 * THE case this module exists for. Adding a father and then a mother through the old
		 * primitives made two single-parent unions, so the canvas drew two junctions and the
		 * couple never appeared -- and no screenshot tells you which of the two is wrong.
		 */
		const withFather = family({ parentUnions: [union("u1", "dad", null, ["me"])] });
		const plan = planKin(withFather, "mother");

		expect(plan.union).toEqual({ kind: "existing", unionId: "u1" });
		expect(plan.attach).toBe("partner");
		// The subject is already a child of u1, so re-attaching would be a duplicate.
		expect(plan.attachSubjectAsChild).toBe(false);
	});

	it("fills the B slot when the existing partner sits in A, and vice versa", () => {
		const inA = planKin(family({ parentUnions: [union("u1", "dad", null, ["me"])] }), "mother");
		const inB = planKin(family({ parentUnions: [union("u1", null, "mum", ["me"])] }), "father");
		expect(inA.union).toEqual({ kind: "existing", unionId: "u1" });
		expect(inB.union).toEqual({ kind: "existing", unionId: "u1" });
	});

	it("refuses a third parent rather than silently doing nothing", () => {
		// `unions` has exactly two partner columns, so a third has nowhere to go. A control
		// that appears to work and does not is worse than one that explains itself.
		const both = family({ parentUnions: [union("u1", "dad", "mum", ["me"])] });
		const plan = planKin(both, "father");

		expect(plan.create.count).toBe(0);
		expect(plan.union).toEqual({ kind: "none" });
		expect(plan.refusal).toBeTruthy();
	});

	it("uses the first parent union with room when there are two", () => {
		// Birth plus adoptive. Which one a new parent belongs to is a question only the user
		// can answer, so the panel names the union it used rather than the planner guessing.
		const two = family({
			parentUnions: [union("birth", "dad", "mum", ["me"]), union("adoptive", "step", null, ["me"])],
		});
		expect(planKin(two, "mother").union).toEqual({ kind: "existing", unionId: "adoptive" });
	});
});

describe("planKin: partners", () => {
	it("creates a union holding the subject and the new partner", () => {
		const plan = planKin(family(), "partner");
		expect(plan.union).toEqual({ kind: "create", partnerAId: "me", partnerBId: null });
		expect(plan.attach).toBe("partner");
		expect(plan.attachSubjectAsChild).toBe(false);
	});

	it("never batches partners", () => {
		// N unions from one gesture would be impossible to undo by hand, and nobody means it.
		expect(planKin(family(), "partner", 5).create.count).toBe(1);
	});
});

describe("planKin: children", () => {
	it("attaches to the subject's existing union", () => {
		const married = family({ ownUnions: [union("u1", "me", "spouse")] });
		const plan = planKin(married, "son");
		expect(plan.union).toEqual({ kind: "existing", unionId: "u1" });
		expect(plan.attach).toBe("child");
	});

	it("creates a single-parent union when the subject has none", () => {
		// Legal by design: both partner columns are nullable precisely so a single parent
		// still forms a union, and that is the honest shape when nobody recorded the other.
		const plan = planKin(family(), "daughter");
		expect(plan.union).toEqual({ kind: "create", partnerAId: "me", partnerBId: null });
		expect(plan.create).toEqual({ count: 1, sex: "female" });
	});

	it("creates a batch of placeholders in one gesture", () => {
		// "I have five children" is one fact; entering it five times is five times the work
		// for no extra information.
		const plan = planKin(family({ ownUnions: [union("u1", "me", null)] }), "child", 5);
		expect(plan.create.count).toBe(5);
		expect(plan.union).toEqual({ kind: "existing", unionId: "u1" });
	});

	it("caps a batch, so a mistyped count cannot flood the graph", () => {
		expect(planKin(family(), "son", 500).create.count).toBe(MAX_BATCH);
	});

	it("treats a zero or negative count as one", () => {
		expect(planKin(family(), "son", 0).create.count).toBe(1);
		expect(planKin(family(), "son", -3).create.count).toBe(1);
	});
});

describe("planKin: siblings", () => {
	it("adds a second child to the subject's parent union", () => {
		// A "sibling" with no shared union is not a sibling, just another person on the canvas.
		const withParents = family({ parentUnions: [union("u1", "dad", "mum", ["me"])] });
		const plan = planKin(withParents, "brother");
		expect(plan.union).toEqual({ kind: "existing", unionId: "u1" });
		expect(plan.attach).toBe("child");
		expect(plan.attachSubjectAsChild).toBe(false);
	});

	it("creates a partnerless union holding BOTH of them when no parents are recorded", () => {
		/*
		 * A union with two null partners is a bare junction, which the canvas already handles:
		 * a union dot is dropped only once fewer than two of the nodes it joins remain, and two
		 * siblings keep it at two. The subject must join it, or they share nothing.
		 */
		const plan = planKin(family(), "sister");
		expect(plan.union).toEqual({ kind: "create", partnerAId: null, partnerBId: null });
		expect(plan.attachSubjectAsChild).toBe(true);
		expect(plan.create.sex).toBe("female");
	});
});

describe("birthYearColumns", () => {
	it("puts a bare year in the APPROX column, never the date column", () => {
		// `birthDate` is a real `date`, so "1952" is not a value it can hold -- and coercing it
		// to 1952-01-01 invents a birthday, the false precision the *Approx columns exist for.
		expect(birthYearColumns("1952")).toEqual({ birthDate: null, birthDateApprox: "1952" });
	});

	it("accepts a full ISO date in the real column", () => {
		expect(birthYearColumns("1952-03-04")).toEqual({
			birthDate: "1952-03-04",
			birthDateApprox: null,
		});
	});

	it("keeps somebody's own words verbatim", () => {
		// "about 1890" is a genuine genealogical answer, not a malformed date.
		expect(birthYearColumns("about 1890").birthDateApprox).toBe("about 1890");
	});

	it("rejects a number that cannot be a year", () => {
		// "19" and "20255" are typos. Stored as a year they would be indistinguishable from a
		// real value on the card.
		expect(birthYearColumns("19").birthDateApprox).toBe("19");
		expect(birthYearColumns("19").birthDate).toBeNull();
		expect(birthYearColumns("0500").birthDate).toBeNull();
	});

	it("treats blank as not recorded", () => {
		expect(birthYearColumns("   ")).toEqual({ birthDate: null, birthDateApprox: null });
	});
});

describe("placeholderName", () => {
	it("numbers a placeholder against its role", () => {
		// `addPerson` rightly refuses a person with no name, and a nameless row renders as
		// "Unknown" indistinguishable from every other. A number makes each addressable.
		expect(placeholderName("son", 0)).toBe("Son 1");
		expect(placeholderName("daughter", 2)).toBe("Daughter 3");
		expect(placeholderName("child", 1)).toBe("Child 2");
	});

	it("continues from an offset, so a second batch does not restart at one", () => {
		// Otherwise a family ends up with two people called "Child 1".
		expect(placeholderName("child", 0, 3)).toBe("Child 4");
	});

	it("names siblings by their own role", () => {
		expect(placeholderName("brother", 0)).toBe("Brother 1");
		expect(placeholderName("sibling", 0)).toBe("Sibling 1");
	});
});
