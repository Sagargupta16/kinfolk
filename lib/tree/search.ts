/**
 * Finding one person in a tree of hundreds.
 *
 * The gap this closes: 117 people across a canvas 10760px wide, and the only way
 * to reach a named relative was to pan until you saw them. Zoom, filter and
 * cluster all answer "show me less"; none of them answers "show me Halvor".
 *
 * Deliberately not fuzzy. Family names repeat heavily in a genealogy -- eleven
 * Fortins here -- so an edit-distance match would rank a cousin above the person
 * whose name you typed in full. Substring matching, ranked by WHERE the match
 * landed, is both predictable and enough: nobody searches a family tree for a name
 * they cannot spell, because they are searching for someone they know.
 *
 * Pure, like everything in this directory: no React, no DB, no DOM.
 */
import { displayName, type FusedPerson, lifespan } from "./graph";

type SearchHit = {
	/** The fused node id, so a caller can select or centre it directly. */
	id: string;
	name: string;
	/** "1890 - 1954" or "b. 1983", for telling two same-named relatives apart. */
	dates: string;
	/** Which field matched, so the UI can say why this row is here. */
	matched: "name" | "nickname" | "birthName" | "place";
	/** The viewer themselves, so the list can mark the row rather than only rank it. */
	isSelf: boolean;
};

/**
 * Rank order. Lower sorts first.
 *
 * A prefix beats a mid-word hit because typing "flo" for Florence should not rank
 * her below someone born in Florence, and the current name beats the birth name
 * because that is the name the person is filed under.
 */
const FIELD_RANK: Record<SearchHit["matched"], number> = {
	name: 0,
	nickname: 1,
	birthName: 2,
	place: 3,
};

/**
 * Letters NFD cannot help with.
 *
 * Unicode decomposition strips a diacritic from a base letter, so é becomes e for
 * free. But ø, æ, ð, ł and ß are not decorated letters -- they are letters in
 * their own right, and NFD leaves them exactly as they are. Nordic surnames are
 * the ones in this tree that an English keyboard cannot type, so relying on NFD
 * alone would fail on precisely the names that need help.
 *
 * Expanded to the conventional ASCII spelling rather than the nearest single
 * letter, because that is what somebody types: "Aasboe" and "Aasbo" should both
 * find Aasbø, so ø folds to o and the transliteration is left to the substring.
 */
const LETTERS: Record<string, string> = {
	ø: "o",
	æ: "ae",
	œ: "oe",
	å: "a",
	ð: "d",
	þ: "th",
	đ: "d",
	ł: "l",
	ß: "ss",
	ı: "i",
};

/** Case- and accent-insensitive: "Aasbo" has to find "Aasbø". */
function fold(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[øæœåðþđłßı]/g, (letter) => LETTERS[letter] ?? letter)
			// After the map, not before: å decomposes to a + ring, and stripping the ring
			// first would turn it into a plain "a" that the map never sees. Both routes
			// reach the same answer here, but only because the map agrees with NFD.
			.normalize("NFD")
			.replace(/\p{Diacritic}/gu, "")
			.trim()
	);
}

/**
 * Signals for breaking a tie between people with the same name.
 *
 * Necessary because a family tree is full of namesakes: this sample has two Aaron
 * Fortins and two Abigail Fortins, and alphabetical order buries the one you know
 * behind the one you have never heard of. Both signals are already computed for
 * the canvas, so this adds no new state.
 */
type SearchContext = {
	/**
	 * The viewer's own PERSON-ROW id, which always sorts first among equal matches.
	 *
	 * Matched against `sources`, not against the fused id. A fused id is the
	 * union-find root -- the smallest member id -- so for a viewer whose row is not
	 * the smallest of a merged set the two differ, and comparing ids directly would
	 * silently stop marking exactly the people the combined view merged.
	 */
	selfId?: string;
	/** How connected each person is, keyed by fused id. */
	degree?: Map<string, { rank: number }>;
};

/** One person's searchable fields, folded, in rank order. */
type Folded = { name: string; fields: [SearchHit["matched"], string][] };

/**
 * Folded fields per person, computed once rather than on every keystroke.
 *
 * Folding is NFD normalisation plus two regex passes, and a query re-ran it over four fields
 * of every person for each character typed. Keyed on the person OBJECT, so a reloaded view
 * (new objects) folds afresh and a dropped one is collected with its cache entry.
 */
const foldedCache = new WeakMap<FusedPerson, Folded>();

function foldedFields(person: FusedPerson): Folded {
	const cached = foldedCache.get(person);
	if (cached) return cached;
	const primary = person.primary;
	const name = displayName(primary);
	const fields: [SearchHit["matched"], string][] = [];
	for (const [matched, value] of [
		["name", name],
		["nickname", primary.nickname],
		["birthName", primary.birthFamilyName],
		["place", primary.birthPlace],
	] as const) {
		if (value) fields.push([matched, fold(value)]);
	}
	const folded = { name, fields };
	foldedCache.set(person, folded);
	return folded;
}

/**
 * Whether `needle` starts a word anywhere in `haystack`: at the very start, or straight after
 * a space or a hyphen.
 *
 * Only index 0 used to count, so "haw" ranked Aaron Shaw level with Bea Hawkins and the
 * alphabet put Shaw first -- a surname typed from its start losing to a match inside another
 * surname. Every occurrence is checked, because the first can sit mid-word ("Shawn
 * Hawthorne") while a later one starts the surname.
 */
function startsWord(haystack: string, needle: string): boolean {
	for (
		let index = haystack.indexOf(needle);
		index !== -1;
		index = haystack.indexOf(needle, index + 1)
	) {
		if (index === 0 || /[\s-]/.test(haystack[index - 1] ?? "")) return true;
	}
	return false;
}

/**
 * Search every person the viewer can see.
 *
 * Takes the already-fused people rather than raw rows, so a grandfather recorded
 * by two families is one result. Searching the rows would return him twice, and
 * the two hits would scroll to the same card.
 */
export function searchPeople(
	people: FusedPerson[],
	query: string,
	limit = 8,
	context: SearchContext = {},
): SearchHit[] {
	const needle = fold(query);
	if (needle.length < 2) return [];

	// Ranking inputs ride along on each hit and are stripped on the way out, so the
	// comparator reads them without a second lookup per comparison.
	const hits: (SearchHit & { rank: number; connectedness: number })[] = [];

	for (const person of people) {
		const { name, fields } = foldedFields(person);

		// Fields in rank order, and the FIRST match wins. A person matching on both
		// their name and their birthplace is one result ranked by the better of the
		// two, not two rows competing with each other.
		for (const [matched, value] of fields) {
			if (!value.includes(needle)) continue;

			hits.push({
				id: person.id,
				name,
				dates: lifespan(person.primary),
				matched,
				isSelf: Boolean(
					context.selfId &&
						(person.id === context.selfId ||
							person.sources.some((source) => source.id === context.selfId)),
				),
				// A word-start hit outranks a mid-word one within the same field, which is
				// what makes a short query behave like a typeahead rather than a grep.
				rank: FIELD_RANK[matched] * 2 + (startsWord(value, needle) ? 0 : 1),
				connectedness: context.degree?.get(person.id)?.rank ?? 0,
			});
			break;
		}
	}

	return (
		hits
			.sort(
				(a, b) =>
					// Where the match landed still dominates: connectedness breaks a tie, it
					// never promotes a birthplace hit over somebody's actual name.
					a.rank - b.rank ||
					// You first. Searching your own surname should not make you scroll past
					// four namesakes to find yourself.
					Number(b.isSelf) - Number(a.isSelf) ||
					// Then the better-connected namesake, because a person with a partner,
					// children and friends recorded is the one somebody is looking for; a
					// name attached to a single edge is a stub.
					b.connectedness - a.connectedness ||
					// Alphabetical last, so the order is stable rather than input-dependent.
					a.name.localeCompare(b.name),
			)
			.slice(0, limit)
			// Ranking inputs are internal; the caller gets the hit.
			.map(({ rank: _rank, connectedness: _connectedness, ...hit }) => hit)
	);
}
