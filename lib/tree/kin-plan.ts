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
 * The roles the action accepts.
 *
 * Gendered words where the data model can carry the implication, because "add father" is
 * what a person actually means and "add parent, then set sex to male" is the same act
 * spelled as two. The canvas offers only the gendered pairs -- father/mother above a card,
 * husband/wife beside it, son/daughter below it -- so the button pressed IS the sex and no
 * gender field is ever drawn. The neutral roles stay accepted for API callers.
 */
export type KinRole =
	| "father"
	| "mother"
	| "partner"
	| "husband"
	| "wife"
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
	husband: "male",
	wife: "female",
	son: "male",
	daughter: "female",
	child: "unknown",
	brother: "male",
	sister: "female",
	sibling: "unknown",
};

/** How each role attaches, which is what decides the union rule. */
type KinDirection = "parent" | "partner" | "child" | "sibling";

export const ROLE_DIRECTION: Record<KinRole, KinDirection> = {
	father: "parent",
	mother: "parent",
	partner: "partner",
	husband: "partner",
	wife: "partner",
	son: "child",
	daughter: "child",
	child: "child",
	brother: "sibling",
	sister: "sibling",
	sibling: "sibling",
};

/** One union as the planner needs to see it. */
type UnionShape = {
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
type KinPlan = {
	/**
	 * The sex the ONE new person gets.
	 *
	 * One person per gesture, always. Batches ("five children") were removed with the name
	 * becoming required: a batch existed precisely because nobody knew the names yet, and it
	 * filled the canvas with numbered placeholders that each needed renaming later.
	 */
	sex: Sex;
	/**
	 * The union to attach to. `existing` when one already fits; `create` when the family
	 * shape has no home for this role yet.
	 */
	union:
		| { kind: "existing"; unionId: string }
		| { kind: "create"; partnerAId: string | null; partnerBId: string | null }
		| { kind: "none" };
	/** Where the new person goes relative to that union. */
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
export function planKin(family: FamilyShape, role: KinRole, unionId?: string | null): KinPlan {
	const direction = ROLE_DIRECTION[role];
	const sex = ROLE_SEX[role];
	const candidates =
		direction === "child"
			? family.ownUnions
			: direction === "parent"
				? family.parentUnions.filter((union) => !union.partnerAId || !union.partnerBId)
				: direction === "sibling"
					? family.parentUnions
					: [];
	const selected = unionId ? candidates.find((union) => union.id === unionId) : undefined;
	const refusal =
		unionId && !selected
			? "That family is no longer available for this relationship. Refresh and choose again."
			: candidates.length > 1 && !selected
				? "Choose which family this relative belongs to."
				: null;
	if (refusal) {
		return {
			sex,
			union: { kind: "none" },
			attach: direction === "parent" || direction === "partner" ? "partner" : "child",
			attachSubjectAsChild: false,
			refusal,
		};
	}
	const chosenFamily = selected
		? {
				...family,
				...(direction === "child" ? { ownUnions: [selected] } : { parentUnions: [selected] }),
			}
		: family;

	switch (direction) {
		case "parent":
			return planParent(chosenFamily, sex);
		case "partner":
			return {
				sex,
				union: { kind: "create", partnerAId: family.subjectId, partnerBId: null },
				attach: "partner",
				attachSubjectAsChild: false,
			};
		case "child":
			return planChild(chosenFamily, sex);
		case "sibling":
			return planSibling(chosenFamily, sex);
	}
}

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
 * `planKin` requires a choice when more than one parent union has room.
 */
function planParent(family: FamilyShape, sex: Sex): KinPlan {
	const withRoom = family.parentUnions.find((u) => !u.partnerAId || !u.partnerBId);

	if (withRoom) {
		return {
			sex,
			union: { kind: "existing", unionId: withRoom.id },
			attach: "partner",
			attachSubjectAsChild: false,
		};
	}

	if (family.parentUnions.length > 0) {
		return {
			sex,
			union: { kind: "none" },
			attach: "partner",
			attachSubjectAsChild: false,
			// Named rather than silently ignored: a control that appears to work and does
			// nothing is worse than one that explains itself.
			refusal: "Both parents are already recorded. Remove one first, or edit them directly.",
		};
	}

	return {
		sex,
		union: { kind: "create", partnerAId: null, partnerBId: null },
		attach: "partner",
		attachSubjectAsChild: true,
	};
}

/**
 * A child goes into the subject's own union, created if they have none.
 *
 * `planKin` has already required a choice if several partnerships were available.
 *
 * A subject with no union gets a single-parent one. That is legal in the schema -- both
 * partner columns are nullable precisely so a single parent still forms a union -- and it
 * is the honest shape when nobody has recorded the other parent.
 */
function planChild(family: FamilyShape, sex: Sex): KinPlan {
	const existing = family.ownUnions[0];

	if (existing) {
		return {
			sex,
			union: { kind: "existing", unionId: existing.id },
			attach: "child",
			attachSubjectAsChild: false,
		};
	}

	return {
		sex,
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
 * gotchas).
 */
function planSibling(family: FamilyShape, sex: Sex): KinPlan {
	const existing = family.parentUnions[0];

	if (existing) {
		return {
			sex,
			union: { kind: "existing", unionId: existing.id },
			attach: "child",
			attachSubjectAsChild: false,
		};
	}

	return {
		sex,
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
	// Shape alone is not enough: "2024-02-31" matches and Date.parse normalises it
	// into March. Rebuild the date in UTC and require every component to survive
	// unchanged; impossible dates then remain the caller's fuzzy text instead of
	// reaching Postgres as an invalid date.
	const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (iso) {
		const year = Number(iso[1]);
		const month = Number(iso[2]);
		const day = Number(iso[3]);
		const parsed = new Date(0);
		parsed.setUTCHours(0, 0, 0, 0);
		parsed.setUTCFullYear(year, month - 1, day);
		if (
			year >= 1000 &&
			year <= 2200 &&
			parsed.getUTCFullYear() === year &&
			parsed.getUTCMonth() === month - 1 &&
			parsed.getUTCDate() === day
		) {
			return { birthDate: text, birthDateApprox: null };
		}
	}

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
 * One typed name, split into the two columns the schema keeps.
 *
 * The canvas asks for ONE name field, because "Paras Gupta" is how a relative is said and
 * two boxes for one fact is the friction the node editor exists to remove. The split is the
 * common convention: the last word is the family name, everything before it the given
 * name -- "Mary Ann Smith" is Mary Ann of the Smiths, "Rakesh Kumar Gupta" is Rakesh Kumar.
 * A single word is a given name alone, never a surname, so "Mini" stays findable as Mini.
 *
 * The display is unaffected either way: `displayName()` joins the two columns with a space,
 * so the split only decides which half search and sorting treat as the surname. Whitespace
 * is collapsed first, so a doubled space cannot produce an empty word.
 */
export function splitName(input: string): { givenName: string | null; familyName: string | null } {
	const words = input.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return { givenName: null, familyName: null };
	if (words.length === 1) return { givenName: words[0] ?? null, familyName: null };
	return {
		givenName: words.slice(0, -1).join(" "),
		familyName: words.at(-1) ?? null,
	};
}
