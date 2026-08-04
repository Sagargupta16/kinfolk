/**
 * "Add a father" as a PLAN, before anything touches the database.
 *
 * The editor used to ask for the data model: to record somebody's father you created a
 * person, created a union, put the father in it, then attached the child to that union.
 * Three steps and a schema lesson, for the commonest thing anybody wants to do. Worse, it
 * quietly invited the wrong shape -- adding a father and then a mother the same way makes
 * TWO single-parent unions, so the canvas shows two junctions and the couple never appears.
 *
 * So the role is the input and the structure is derived. This module answers "what rows
 * does 'X's father' mean", and it is pure for the usual reason: whether a father lands in
 * the union that already holds the mother is a claim about a family, and a claim is
 * something you assert in a test rather than something you look at.
 *
 * It knows nothing about ids it has not been given, so the caller loads the current family
 * shape, gets a plan back, and executes it. That split is also what lets the action stay a
 * single transaction with no branching logic of its own.
 */
import type { Sex } from "../db/schema";

/**
 * The roles a quick-add offers.
 *
 * Gendered words where the data model can carry the implication, because "add father" is
 * what a person actually means and "add parent, then set sex to male" is the same act
 * spelled as two. `partner` and `sibling` stay neutral: the first because the term is
 * genuinely symmetric, the second because a sibling's sex is not implied by the word the
 * viewer clicked when they want a brother AND the neutral option to exist.
 */
export type KinRole =
	| "father"
	| "mother"
	| "partner"
	| "son"
	| "daughter"
	| "child"
	| "brother"
	| "sister"
	| "sibling";

/**
 * The sex a role implies, or `unknown` where it implies nothing.
 *
 * Deriving sex from an explicitly chosen ROLE is not the guess CLAUDE.md forbids. That rule
 * is about inferring it from a display name -- reading "Maria" and storing `female` -- where
 * the user never said anything. Here they clicked "father", which is a statement about the
 * person they are adding, and storing anything else would contradict them.
 */
export const ROLE_SEX: Record<KinRole, Sex> = {
	father: "male",
	mother: "female",
	partner: "unknown",
	son: "male",
	daughter: "female",
	child: "unknown",
	brother: "male",
	sister: "female",
	sibling: "unknown",
};

/** How each role attaches, which is what decides the union rule. */
export type KinDirection = "parent" | "partner" | "child" | "sibling";

export const ROLE_DIRECTION: Record<KinRole, KinDirection> = {
	father: "parent",
	mother: "parent",
	partner: "partner",
	son: "child",
	daughter: "child",
	child: "child",
	brother: "sibling",
	sister: "sibling",
	sibling: "sibling",
};

/** One union as the planner needs to see it. */
export type UnionShape = {
	id: string;
	partnerAId: string | null;
	partnerBId: string | null;
	childIds: string[];
};

/** The family around the subject, loaded by the caller. */
export type FamilyShape = {
	subjectId: string;
	/** Unions the subject is a CHILD of. Usually one; two for birth plus adoptive. */
	parentUnions: UnionShape[];
	/** Unions the subject is a PARTNER in. Several after a remarriage. */
	ownUnions: UnionShape[];
};

/**
 * What to do, in order. The caller executes these against the database.
 *
 * A plan rather than direct calls so the decision is separable from the writing: every
 * branch below is a rule about families, and none of them needs a connection to be tested.
 */
export type KinPlan = {
	/** How many people to create, and the sex each gets. */
	create: { count: number; sex: Sex };
	/**
	 * The union to attach to. `existing` when one already fits; `create` when the family
	 * shape has no home for this role yet.
	 */
	union:
		| { kind: "existing"; unionId: string }
		| { kind: "create"; partnerAId: string | null; partnerBId: string | null }
		| { kind: "none" };
	/** Where the new people go relative to that union. */
	attach: "partner" | "child";
	/** True when the SUBJECT must also be attached to a newly created union as a child. */
	attachSubjectAsChild: boolean;
	/** Refusal, when the request cannot be honoured. */
	refusal?: string;
};

/**
 * Turn a role into rows.
 *
 * The whole point is the parent case, so it is worth stating plainly: a parent union is
 * found FIRST and only created if absent, which is what makes "add father" then "add
 * mother" produce one couple rather than two single parents. Everything else follows from
 * where a role sits relative to the subject.
 */
export function planKin(family: FamilyShape, role: KinRole, count = 1): KinPlan {
	const direction = ROLE_DIRECTION[role];
	const sex = ROLE_SEX[role];
	const people = Math.max(1, Math.min(count, MAX_BATCH));

	switch (direction) {
		case "parent":
			return planParent(family, sex);
		case "partner":
			return {
				// One partner at a time. A batch of partners is not a thing anybody means, and
				// N unions from one gesture would be impossible to undo by hand.
				create: { count: 1, sex },
				union: { kind: "create", partnerAId: family.subjectId, partnerBId: null },
				attach: "partner",
				attachSubjectAsChild: false,
			};
		case "child":
			return planChild(family, sex, people);
		case "sibling":
			return planSibling(family, sex, people);
	}
}

/**
 * How many people one gesture may create.
 *
 * A batch exists because "I have five children" is one fact, and entering it as five
 * separate add-a-child journeys is five times the work for no extra information. Capped
 * because past a handful the placeholders stop being a shortcut and become a mess somebody
 * has to clean up -- and an accidental 500 in the box would be unrecoverable by hand.
 */
export const MAX_BATCH = 12;

/**
 * A parent goes into the subject's EXISTING parent union whenever there is one with room.
 *
 * This is the rule the old flow could not express, and the reason the feature exists. The
 * order of checks matters:
 *
 *   1. A parent union with a free slot takes the new parent, so the couple forms.
 *   2. A parent union with both slots filled means the subject already has two recorded
 *      parents; adding a third would silently overwrite nobody and render a union with
 *      three partners, which the schema cannot hold anyway (two columns).
 *   3. No parent union at all: create one holding the new parent, and attach the subject to
 *      it as a child.
 *
 * Two parent unions (birth and adoptive) resolve to the FIRST with room. Choosing between
 * them is a question only the user can answer, and the panel names which union it used.
 */
function planParent(family: FamilyShape, sex: Sex): KinPlan {
	const withRoom = family.parentUnions.find((u) => !u.partnerAId || !u.partnerBId);

	if (withRoom) {
		return {
			create: { count: 1, sex },
			union: { kind: "existing", unionId: withRoom.id },
			attach: "partner",
			attachSubjectAsChild: false,
		};
	}

	if (family.parentUnions.length > 0) {
		return {
			create: { count: 0, sex },
			union: { kind: "none" },
			attach: "partner",
			attachSubjectAsChild: false,
			// Named rather than silently ignored: a control that appears to work and does
			// nothing is worse than one that explains itself.
			refusal: "Both parents are already recorded. Remove one first, or edit them directly.",
		};
	}

	return {
		create: { count: 1, sex },
		union: { kind: "create", partnerAId: null, partnerBId: null },
		attach: "partner",
		attachSubjectAsChild: true,
	};
}

/**
 * A child goes into the subject's own union, created if they have none.
 *
 * With several unions the FIRST is used, and that is a deliberate simplification rather
 * than a guess about which marriage a child came from: the panel says which partnership it
 * attached to, and moving a child between unions is a separate, explicit act. Guessing by
 * date would be worse, because it would look authoritative.
 *
 * A subject with no union gets a single-parent one. That is legal in the schema -- both
 * partner columns are nullable precisely so a single parent still forms a union -- and it
 * is the honest shape when nobody has recorded the other parent.
 */
function planChild(family: FamilyShape, sex: Sex, count: number): KinPlan {
	const existing = family.ownUnions[0];

	if (existing) {
		return {
			create: { count, sex },
			union: { kind: "existing", unionId: existing.id },
			attach: "child",
			attachSubjectAsChild: false,
		};
	}

	return {
		create: { count, sex },
		union: { kind: "create", partnerAId: family.subjectId, partnerBId: null },
		attach: "child",
		attachSubjectAsChild: false,
	};
}

/**
 * A sibling is a second child of the subject's parent union.
 *
 * Which is why this is not simply "create a person": a sibling with no shared union is not
 * a sibling at all, just another person on the canvas. If the subject has no recorded
 * parents, one is created with BOTH partners null and both children attached -- a union
 * with no partners is a bare junction, and the canvas already handles it, because a union
 * dot is dropped only once fewer than two of the nodes it joins remain (see the collapse
 * gotchas). Two siblings keep it at two.
 */
function planSibling(family: FamilyShape, sex: Sex, count: number): KinPlan {
	const existing = family.parentUnions[0];

	if (existing) {
		return {
			create: { count, sex },
			union: { kind: "existing", unionId: existing.id },
			attach: "child",
			attachSubjectAsChild: false,
		};
	}

	return {
		create: { count, sex },
		union: { kind: "create", partnerAId: null, partnerBId: null },
		attach: "child",
		// The subject joins the new union too, or the "sibling" shares nothing with them.
		attachSubjectAsChild: true,
	};
}

/**
 * A bare year goes in the APPROX column, never the date column.
 *
 * `birthDate` is a real `date`, so "1952" is not a value it can hold -- and coercing it to
 * 1952-01-01 would invent a birthday, which is exactly the false precision the schema's
 * separate `*Approx` columns exist to avoid. A four-digit year is stored as the text it is.
 *
 * Returns both columns so a caller can spread the result without deciding anything.
 */
export function birthYearColumns(input: string): {
	birthDate: string | null;
	birthDateApprox: string | null;
} {
	const text = input.trim();
	if (!text) return { birthDate: null, birthDateApprox: null };

	// A full ISO date, which the form does not ask for but a paste might supply.
	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { birthDate: text, birthDateApprox: null };

	// A plausible year. Bounded because a typo like "19" or "20255" is not a year, and
	// storing it would put nonsense on a card with no way to tell it from a real value.
	if (/^\d{4}$/.test(text)) {
		const year = Number(text);
		if (year >= 1000 && year <= 2200) return { birthDate: null, birthDateApprox: text };
	}

	// Anything else is somebody's own words ("about 1890", "before the war"), which is a
	// genuine genealogical answer and belongs in the fuzzy column verbatim.
	return { birthDate: null, birthDateApprox: text };
}

/**
 * The name a placeholder gets.
 *
 * A batch of children is created before anybody knows their names, and `addPerson` rightly
 * refuses a person with no name at all -- a nameless row renders as "Unknown" and cannot be
 * told from any other. So a placeholder is NUMBERED against the role that made it, which
 * makes each one addressable ("Child 3") until it is filled in.
 *
 * `offset` is how many the family already has, so a second batch does not restart at 1 and
 * produce two people called "Child 1".
 */
export function placeholderName(role: KinRole, index: number, offset = 0): string {
	const noun =
		role === "son"
			? "Son"
			: role === "daughter"
				? "Daughter"
				: role === "brother"
					? "Brother"
					: role === "sister"
						? "Sister"
						: role === "sibling"
							? "Sibling"
							: "Child";
	return `${noun} ${offset + index + 1}`;
}
