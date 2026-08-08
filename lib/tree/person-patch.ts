/**
 * Which columns an edit actually writes, decided from the submitted form.
 *
 * Extracted from `updatePerson` because it is the whole of that action's judgement and it
 * needs no database, no session and no request -- so it can be asserted directly. The action
 * that contained it was destructive in a way nothing announced: it wrote every column
 * unconditionally, and `orNull(form.get("x"))` is null for a field the form never rendered,
 * so saving a compact five-field edit NULLED `birthFamilyName`, `deathPlace` and
 * `sourceNote`. A birth surname is searchable, so that was silent data loss on a field the
 * user could not even see.
 *
 * The rule that makes a partial form safe: ABSENCE and EMPTINESS are different. A key the
 * caller did not submit is left alone; a key submitted blank is a deliberate erasure. Under
 * that rule one action can serve a compact quick-edit and a full form without either being
 * able to damage the other's fields.
 */
import { livingStatusEnum, sexEnum } from "../db/schema";
import { birthYearColumns } from "./kin-plan";

/** Free-text columns a form may edit. Order is documentation, not behaviour. */
const TEXT_FIELDS = [
	"givenName",
	"familyName",
	// The field the destructive version dropped. Search matches on it, so losing it silently
	// made somebody unfindable by the name they were born with.
	"birthFamilyName",
	"nickname",
	"birthDate",
	"birthDateApprox",
	"birthPlace",
	"deathDate",
	"deathDateApprox",
	"deathPlace",
	"currentPlace",
	"occupation",
	"bio",
	"sourceNote",
] as const;

/**
 * Empty string means "not recorded", which is not the same as an empty string in the
 * database: an `is null` check would miss half the unrecorded rows.
 */
function orNull(value: FormDataEntryValue | null): string | null {
	const text = typeof value === "string" ? value.trim() : "";
	return text.length > 0 ? text : null;
}

/** A checked choice, keeping invalid input distinct from a deliberate blank. */
type ParsedChoice<T> = { ok: true; value: T } | { ok: false };

/**
 * Parse a client-supplied enum against its allow-list.
 *
 * Missing and blank values use the caller's honest default. A nonblank value outside
 * the allow-list is different: accepting it as the default would let a forged edit
 * erase a valid fact while reporting success. The lists come from the pgEnum objects,
 * so a new enum member is accepted when the schema learns it.
 */
export function oneOf<T extends string, const F>(
	raw: FormDataEntryValue | null,
	allowed: readonly T[],
	fallback: F,
): ParsedChoice<T | F> {
	if (raw === null) return { ok: true, value: fallback };
	if (typeof raw !== "string") return { ok: false };

	const value = raw.trim();
	if (!value) return { ok: true, value: fallback };
	return (allowed as readonly string[]).includes(value)
		? { ok: true, value: value as T }
		: { ok: false };
}

/**
 * The patch for one person, containing only the keys the form submitted.
 *
 * Deliberately returns a plain record rather than a typed `Partial<Person>`: the point is
 * that the KEY SET is dynamic, and a type asserting every key is optional would not stop
 * anybody adding an unconditional write back in.
 */
export type PersonPatchResult =
	| { ok: true; patch: Record<string, unknown> }
	| { ok: false; error: string };

export function buildPersonPatch(form: FormData): PersonPatchResult {
	const patch: Record<string, unknown> = {};

	for (const key of TEXT_FIELDS) {
		if (form.has(key)) patch[key] = orNull(form.get(key));
	}

	// Enums have a NOT NULL default, so a submitted blank resets to `unknown`. Invalid
	// nonblank input refuses the whole patch instead of silently erasing a valid fact.
	if (form.has("sex")) {
		const sex = oneOf(form.get("sex"), sexEnum.enumValues, "unknown");
		if (!sex.ok) return { ok: false, error: "Choose a valid gender." };
		patch.sex = sex.value;
	}
	if (form.has("living")) {
		const living = oneOf(form.get("living"), livingStatusEnum.enumValues, "unknown");
		if (!living.ok) return { ok: false, error: "Choose a valid living status." };
		patch.living = living.value;
	}

	/*
	 * A bare year is accepted and routed to the right column.
	 *
	 * The form asks for a YEAR because that is what people know. "1952" is not a value
	 * `birthDate` can hold, and coercing it to 1952-01-01 invents a birthday -- so
	 * `birthYearColumns` decides. BOTH columns are written so a value moving from fuzzy to
	 * exact clears the other one, rather than leaving two disagreeing dates on one row.
	 */
	if (form.has("birthYear")) {
		const columns = birthYearColumns(String(orNull(form.get("birthYear")) ?? ""));
		patch.birthDate = columns.birthDate;
		patch.birthDateApprox = columns.birthDateApprox;
	}
	if (form.has("deathYear")) {
		const columns = birthYearColumns(String(orNull(form.get("deathYear")) ?? ""));
		patch.deathDate = columns.birthDate;
		patch.deathDateApprox = columns.birthDateApprox;
	}

	return { ok: true, patch };
}
