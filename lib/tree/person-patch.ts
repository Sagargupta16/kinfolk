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
import { birthYearColumns, splitName } from "./kin-plan";

/** Free-text columns a form may edit. Order is documentation, not behaviour. */
export const TEXT_FIELDS = [
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

/** Columns that hold a name rather than a note, and get the shorter ceiling. */
const NAME_FIELDS = new Set(["name", "givenName", "familyName", "birthFamilyName", "nickname"]);

/** Columns of Postgres type `date`: they take an exact calendar date or nothing. */
const DATE_FIELDS = new Set(["birthDate", "deathDate"]);

/**
 * The longest free text any column accepts, and the longest name.
 *
 * Generous for a source note or a life story, and far too short to fill a database: the
 * columns are plain `text`, so without a ceiling one request could store megabytes in a
 * birthplace and repeat that for as long as it liked.
 */
const MAX_TEXT = 2000;
const MAX_NAME = 200;

/**
 * Empty string means "not recorded", which is not the same as an empty string in the
 * database: an `is null` check would miss half the unrecorded rows.
 */
export function orNull(value: FormDataEntryValue | null): string | null {
	const text = typeof value === "string" ? value.trim() : "";
	return text.length > 0 ? text : null;
}

/** The first posted field longer than its ceiling, phrased for the person who typed it. */
export function tooLong(form: FormData, keys: Iterable<string>): string | null {
	for (const key of keys) {
		const value = orNull(form.get(key));
		if (!value) continue;
		if (NAME_FIELDS.has(key) && value.length > MAX_NAME) {
			return `Keep names under ${MAX_NAME} characters.`;
		}
		if (value.length > MAX_TEXT) return "Keep each detail under 2,000 characters.";
	}
	return null;
}

/**
 * A calendar date in the one shape a `date` column accepts, or null.
 *
 * Checked here because Postgres refuses "1952", "about 1890" and "2024-02-31" with an
 * error rather than a value, and a refusal from the database arrives as a 500. A bare
 * year or a fuzzy date belongs in the `*Approx` column instead, where it is stored as said.
 */
function isoDate(text: string): string | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (!match) return null;
	const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
		? text
		: null;
}

/** Every posted exact-date field is a real calendar date, or the refusal to show. */
export function invalidDate(form: FormData, keys: Iterable<string>): string | null {
	for (const key of keys) {
		const value = orNull(form.get(key));
		if (value && !isoDate(value)) {
			return "Write an exact date as YYYY-MM-DD, or record it as approximate.";
		}
	}
	return null;
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
type PersonPatchResult =
	| { ok: true; patch: Record<string, unknown> }
	| { ok: false; error: string };

export function buildPersonPatch(form: FormData): PersonPatchResult {
	const patch: Record<string, unknown> = {};

	const length = tooLong(form, [...TEXT_FIELDS, "name"]);
	if (length) return { ok: false, error: length };
	const date = invalidDate(
		form,
		[...TEXT_FIELDS].filter((key) => DATE_FIELDS.has(key)),
	);
	if (date) return { ok: false, error: date };

	for (const key of TEXT_FIELDS) {
		if (form.has(key)) patch[key] = orNull(form.get(key));
	}

	// The older two-column shape can erase a name too. Both columns posted blank would
	// leave a row the canvas can only call "Unknown", which the single field refuses below.
	if (form.has("givenName") && form.has("familyName") && !patch.givenName && !patch.familyName) {
		return { ok: false, error: "A person needs a name." };
	}

	/*
	 * The canvas's single name field, split into the two columns.
	 *
	 * Posted only when the person actually retyped it, so an untouched name keeps whatever
	 * split it was stored with ("Jan" / "van der Berg" would not survive a round trip through
	 * the last-word rule). Unlike the free-text columns a blank here is refused rather than
	 * written: erasing a name would leave a row the canvas can only call "Unknown".
	 */
	if (form.has("name")) {
		const { givenName, familyName } = splitName(String(form.get("name") ?? ""));
		if (!givenName && !familyName) return { ok: false, error: "A person needs a name." };
		patch.givenName = givenName;
		patch.familyName = familyName;
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
	 * The form accepts dates, years and approximate text. "1952" is not a value
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
