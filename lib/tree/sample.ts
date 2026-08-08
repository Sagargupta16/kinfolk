/**
 * Sample data for the /demo route.
 *
 * Three trees that overlap on two couples, generated rather than hand-written.
 * It exists so the combined-view merge, the density encoding and the level-of-
 * detail switch are all visible before any database is wired up. Not seed data,
 * and not fixtures for tests -- graph.test.ts builds its own.
 *
 * Generated because the interesting failures only appear at scale. A dozen
 * hand-written people never produce an edge crossing, never push a card below the
 * legibility floor, and never make ELK choose between two bad routes, so a small
 * demo silently passes the cases the real thing fails. Around 130 people is the
 * point where the layout has to earn it.
 *
 * Deterministic, via a seeded PRNG: the same tree renders every run, so a visual
 * regression is a real change rather than yesterday's dice. `Math.random` is
 * deliberately never called here.
 */
import type {
	ContactDetail,
	ContactKind,
	Person,
	PersonRelation,
	RelationKind,
	Verification,
} from "../db/schema";
import type { AcceptedLink, TreeSlice, UnionWithChildren } from "./graph";
import { type Culture, NAMES } from "./names";
import { canonicalPair } from "./relations";

const EPOCH = new Date("2026-01-01T00:00:00Z");

/**
 * When the feed pretends "now" is, for the sample data's own timestamps.
 *
 * Row timestamps drive the family feed, and 117 rows all created at EPOCH would
 * render as one giant "7 months ago" dump -- a feed with no rhythm shows nothing
 * about what a feed is for. So each row gets a DETERMINISTIC moment in the ~7
 * months before this reference, hashed from its own id: stable across reloads
 * (the demo rebuilds per request, and a feed that reshuffles on refresh reads
 * as broken), and varied enough that days, weeks and months all appear.
 */
const FEED_REFERENCE = new Date("2026-08-01T12:00:00Z");
const DAY_MS = 86_400_000;

/** Deterministic created/updated stamps for one row id. */
function stamp(id: string): { createdAt: Date; updatedAt: Date } {
	let hash = 0;
	for (let index = 0; index < id.length; index += 1) {
		hash = (Math.imul(hash, 31) + id.charCodeAt(index)) >>> 0;
	}
	const roll = rng(hash);
	const created = new Date(
		FEED_REFERENCE.getTime() - Math.floor(roll() * 210) * DAY_MS - Math.floor(roll() * DAY_MS),
	);
	// A quarter of the records were touched again later, because a real family
	// archive is corrections as much as arrivals.
	const updatedAt =
		roll() < 0.25
			? new Date(
					Math.min(
						created.getTime() + (1 + Math.floor(roll() * 45)) * DAY_MS,
						FEED_REFERENCE.getTime(),
					),
				)
			: created;
	return { createdAt: created, updatedAt };
}

/**
 * Mulberry32. Chosen because it is eight lines, has no dependencies, and its
 * sequence is stable across Node versions -- `Math.random` is seedless and would
 * make the demo different on every reload.
 */
function rng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A tiny generator API, so the household builder below reads as intent. */
type Dice = {
	/** Integer in [min, max]. */
	int(min: number, max: number): number;
	/** True with probability p. */
	chance(p: number): boolean;
	pick<T>(items: readonly T[]): T;
};

function dice(seed: number): Dice {
	const next = rng(seed);
	return {
		int: (min, max) => min + Math.floor(next() * (max - min + 1)),
		chance: (p) => next() < p,
		pick: (items) => {
			// Non-empty by construction: every pool in names.ts has entries, and an
			// empty pick would be a data bug worth failing loudly on.
			const item = items[Math.floor(next() * items.length)];
			if (item === undefined) throw new Error("pick from empty list");
			return item;
		},
	};
}

function p(
	id: string,
	treeId: string,
	givenName: string,
	familyName: string,
	extra: Partial<Person> = {},
): Person {
	return {
		id,
		treeId,
		givenName,
		familyName,
		birthFamilyName: null,
		nickname: null,
		sex: "unknown",
		birthDate: null,
		birthDateApprox: null,
		birthPlace: null,
		deathDate: null,
		deathDateApprox: null,
		deathPlace: null,
		living: "unknown",
		bio: null,
		photoKey: null,
		currentPlace: null,
		occupation: null,
		verification: "unverified",
		sourceNote: null,
		verifiedAt: null,
		verifiedById: null,
		claimedByUserId: null,
		...stamp(id),
		...extra,
	};
}

function u(
	id: string,
	treeId: string,
	partnerAId: string | null,
	partnerBId: string | null,
	childIds: string[],
	extra: Partial<UnionWithChildren> = {},
): UnionWithChildren {
	return {
		id,
		treeId,
		partnerAId,
		partnerBId,
		status: "married",
		startDate: null,
		endDate: null,
		place: null,
		createdAt: stamp(id).createdAt,
		childIds,
		...extra,
	};
}

function rel(
	id: string,
	treeId: string,
	kind: RelationKind,
	aId: string,
	bId: string,
	extra: Partial<PersonRelation> = {},
): PersonRelation {
	// Goes through the same canonicaliser the real insert path uses, so the demo
	// cannot accidentally show a shape the database would reject.
	const pair = canonicalPair(kind, aId, bId);
	return {
		id,
		treeId,
		personAId: pair.personAId,
		personBId: pair.personBId,
		kind,
		label: null,
		closeness: null,
		startDate: null,
		endDate: null,
		note: null,
		createdAt: EPOCH,
		...extra,
	};
}

function contact(
	id: string,
	personId: string,
	kind: ContactKind,
	value: string,
	extra: Partial<ContactDetail> = {},
): ContactDetail {
	return {
		id,
		personId,
		kind,
		value,
		label: null,
		visibility: "tree",
		isPrimary: false,
		createdAt: EPOCH,
		updatedAt: EPOCH,
		...extra,
	};
}

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

const PLACES: Record<Culture, string[]> = {
	anglo: ["Leeds", "Bristol", "Toronto", "Melbourne", "Dublin", "Chicago"],
	west_europe: ["Lyon", "Utrecht", "Bruges", "Freiburg", "Nantes", "Basel"],
	nordic: ["Bergen", "Turku", "Aarhus", "Uppsala", "Tromsø", "Odense"],
	latin: ["Valencia", "Porto", "Córdoba", "Recife", "Rosario", "Cádiz"],
	east_europe: ["Kraków", "Brno", "Lviv", "Novi Sad", "Cluj", "Timișoara"],
	south_asia: ["Pune", "Kochi", "Mysore", "Nagpur", "Coimbatore", "Indore"],
	west_asia: ["İzmir", "Bursa", "Antalya", "Beirut", "Amman", "Eskişehir"],
};

const OCCUPATIONS = [
	"carpenter",
	"schoolteacher",
	"nurse",
	"railway clerk",
	"mill foreman",
	"seamstress",
	"pharmacist",
	"stonemason",
	"bookkeeper",
	"farmer",
	"midwife",
	"typesetter",
	"electrician",
	"radiographer",
	"surveyor",
	"baker",
];

/**
 * Verification levels, weighted the way a real tree ages: the further back a
 * generation sits, the more of it rests on somebody's memory rather than a
 * document, and the living generation can confirm itself.
 */
const VERIFICATION_BY_DEPTH: Verification[][] = [
	["documented", "documented", "family_recalled", "unverified"],
	["documented", "family_recalled", "family_recalled", "unverified"],
	["documented", "documented", "self_confirmed", "family_recalled"],
	["self_confirmed", "self_confirmed", "documented", "family_recalled"],
];

/** Social and professional ties, weighted towards the ordinary ones. */
const SOCIAL_KINDS: RelationKind[] = [
	"friend",
	"friend",
	"close_friend",
	"family_friend",
	"neighbour",
	"classmate",
	"roommate",
	"colleague",
	"colleague",
	"business_partner",
	"mentor",
	"teacher",
	"caregiver",
	"cousin",
	"in_law",
];

type Built = {
	people: Person[];
	unions: UnionWithChildren[];
	relations: PersonRelation[];
	contacts: Record<string, ContactDetail[]>;
	/** Ids by generation depth, so relations can prefer same-generation ties. */
	byDepth: string[][];
};

/**
 * Grow a family downwards from one founding couple.
 *
 * Recursive rather than iterative because the shape is genuinely a tree at this
 * stage: each couple's children are independent subproblems, and the recursion
 * carries exactly the two things a child needs -- its depth and its surname.
 */
function buildFamily(opts: {
	treeId: string;
	prefix: string;
	culture: Culture;
	seed: number;
	depth: number;
	/** Children per union at each depth, tapering so the tree does not explode. */
	fanout: number[];
}): Built {
	const d = dice(opts.seed);
	const pool = NAMES[opts.culture];
	const places = PLACES[opts.culture];

	const people: Person[] = [];
	const unions: UnionWithChildren[] = [];
	const relations: PersonRelation[] = [];
	const contacts: Record<string, ContactDetail[]> = {};
	const byDepth: string[][] = Array.from({ length: opts.depth }, () => []);

	let n = 0;
	const id = () => `${opts.prefix}${++n}`;

	/** Roughly 28 years per generation, which is what parish registers show. */
	const birthYear = (depth: number) => 1900 + depth * 28 + d.int(-4, 5);

	function makePerson(depth: number, familyName: string, female: boolean): Person {
		const year = birthYear(depth);
		const given = d.pick(female ? pool.female : pool.male);
		const verification = d.pick<Verification>(VERIFICATION_BY_DEPTH[depth] ?? ["unverified"]);

		// Anyone born before roughly 1950 has died; after that most have not. Keyed
		// on the birth YEAR rather than the depth, because the trees differ in depth
		// and a depth rule would kill a great-grandparent in one and spare the same
		// generation in another. A few later ones die young, which is what makes the
		// deceased rail appear in the middle of the tree instead of only along the top.
		const deceased = year < 1952 || d.chance(0.06);
		const deathYear = deceased ? Math.min(year + d.int(52, 88), 2025) : null;

		// Fuzzy dates on the oldest generations only, which is where records actually
		// run out. "about 1904" has to render somewhere or the approx columns are
		// untested by the demo.
		const fuzzy = depth === 0 && d.chance(0.35);

		const person = p(id(), opts.treeId, given, familyName, {
			sex: female ? "female" : "male",
			...(fuzzy ? { birthDateApprox: `about ${year}` } : { birthDate: iso(year, d) }),
			birthPlace: d.pick(places),
			...(deathYear ? { deathDate: iso(deathYear, d), living: "deceased" as const } : {}),
			...(deceased ? {} : { living: "living" as const }),
			...(d.chance(0.55) ? { occupation: d.pick(OCCUPATIONS) } : {}),
			...(deceased ? {} : d.chance(0.4) ? { currentPlace: d.pick(places) } : {}),
			verification,
			...(verification === "documented"
				? { sourceNote: d.pick(["parish register", "birth certificate", "census return"]) }
				: verification === "family_recalled"
					? { sourceNote: "recalled by a relative" }
					: {}),
		});

		people.push(person);
		byDepth[depth]?.push(person.id);
		return person;
	}

	/**
	 * A partner who married into the family.
	 *
	 * A minority take the house name and keep their own as `birthFamilyName`; most
	 * keep their own outright. Both appear in real registers, and the ratio matters
	 * more than it looks: an in-marrying partner who adopts adds another card
	 * reading the same surname, and adopting by default was what put one name on
	 * half the canvas. A word repeated across most nodes is noise -- it costs the
	 * width a distinguishing name needs and separates nobody.
	 */
	function makeSpouse(depth: number, houseName: string, female: boolean): Person {
		const own = d.pick(pool.family);
		const adopts = d.chance(0.3);
		const spouse = makePerson(depth, adopts ? houseName : own, female);
		if (adopts) spouse.birthFamilyName = own;
		return spouse;
	}

	function descend(parentA: Person, parentB: Person, depth: number): void {
		const children = opts.fanout[depth] ?? 0;
		if (children === 0 || depth >= opts.depth - 1) return;

		// Which parent's surname the children carry. Mostly the bloodline parent's,
		// but not always: passing the mother's name is common enough in real records
		// and universal in some of them. It also stops one founder's surname
		// blanketing the canvas -- a word repeated on most cards is pure noise, since
		// it takes the width a distinguishing name needs and separates nobody.
		const houseName = (d.chance(0.25) ? parentB.familyName : parentA.familyName) ?? "";

		const kids: Person[] = [];
		for (let i = 0; i < children; i++) {
			kids.push(makePerson(depth + 1, houseName, d.chance(0.5)));
		}

		const union = u(
			`${opts.prefix}u${unions.length + 1}`,
			opts.treeId,
			parentA.id,
			parentB.id,
			kids.map((k) => k.id),
			{
				startDate: iso(birthYear(depth) + d.int(22, 30), d),
				// A minority of unions ended. Without any, the dissolved-union dot and
				// the dashed partner edge never render.
				...(d.chance(0.14) ? { status: "divorced" as const } : {}),
			},
		);
		unions.push(union);

		// Not every child forms a household: some had no children, some were not
		// recorded as partnered. A tree where every leaf reproduces looks generated.
		//
		// But at least ONE must, or the line simply stops. Left to independent dice
		// that happens often -- two children each with a 28% chance of not
		// continuing ends the branch 8% of the time -- and a demo tree that
		// randomly comes out four people deep in one run and forty in the next is
		// not a fixture. The first child always continues; the rest roll.
		if (depth + 1 >= opts.depth - 1) return;

		for (const [index, kid] of kids.entries()) {
			if (index > 0 && !d.chance(0.7)) continue;
			const spouse = makeSpouse(depth + 1, kid.familyName ?? "", kid.sex !== "female");
			descend(kid, spouse, depth + 1);
		}
	}

	const founderA = makePerson(0, d.pick(pool.family), false);
	const founderB = makeSpouse(0, founderA.familyName ?? "", true);
	descend(founderA, founderB, 0);

	/* Social ties. Drawn AFTER the skeleton exists, because a relation needs two
	   people who are already placed, and because these edges must never affect
	   where anybody sits -- which is exactly the invariant they are here to test. */
	const living = people.filter((person) => person.living === "living");
	const relationCount = Math.round(living.length * 0.55);
	const seen = new Set<string>();

	for (let i = 0; i < relationCount; i++) {
		const kind = d.pick(SOCIAL_KINDS);
		const a = d.pick(living);
		const b = d.pick(living);
		if (a.id === b.id) continue;

		const pair = canonicalPair(kind, a.id, b.id);
		const key = `${kind}:${pair.personAId}:${pair.personBId}`;
		if (seen.has(key)) continue;
		seen.add(key);

		relations.push(
			rel(`${opts.prefix}r${relations.length + 1}`, opts.treeId, kind, a.id, b.id, {
				// A stored closeness on a minority of rows, so the override path is
				// exercised rather than every edge falling back to its kind default.
				...(d.chance(0.25) ? { closeness: d.int(1, 3) } : {}),
				// Some ties are over. They draw fainter, which is the point.
				...(d.chance(0.18) ? { endDate: iso(2000 + d.int(0, 20), d) } : {}),
			}),
		);
	}

	/* Contacts, on the living only -- a phone number for somebody born in 1904 is
	   not a thing anyone has. Values are obviously fake: the demo must never look
	   like it leaked a real number. */
	for (const person of living) {
		if (!d.chance(0.5)) continue;
		const details: ContactDetail[] = [];
		const handle = `${(person.givenName ?? "x").toLowerCase().replace(/[^a-z]/g, "")}`;

		if (d.chance(0.75)) {
			details.push(
				contact(`${person.id}c1`, person.id, "phone", fakePhone(d), {
					isPrimary: true,
					label: "mobile",
				}),
			);
		}
		if (d.chance(0.6)) {
			details.push(
				contact(`${person.id}c2`, person.id, "email", `${handle}@example.com`, {
					visibility: "linked",
				}),
			);
		}
		if (d.chance(0.3)) {
			details.push(
				contact(
					`${person.id}c3`,
					person.id,
					d.pick(["instagram", "linkedin", "website"] as const),
					`@${handle}`,
					{ visibility: "shared" },
				),
			);
		}
		if (details.length > 0) contacts[person.id] = details;
	}

	return { people, unions, relations, contacts, byDepth };
}

/** A date inside the given year. Day-level precision the demo never depends on. */
function iso(year: number, d: Dice): string {
	const month = String(d.int(1, 12)).padStart(2, "0");
	// 28 to dodge month-length maths: no assertion here cares which day it is.
	const day = String(d.int(1, 28)).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** Deliberately in the UK-reserved-for-drama range, so it cannot be a real line. */
function fakePhone(d: Dice): string {
	return `+44 7700 ${String(d.int(900000, 900999)).slice(0, 6)}`;
}

/* -------------------------------------------------------------------------- */
/* The three trees                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The viewer's own tree: four generations, the largest of the three.
 *
 * Seeds are arbitrary but FIXED. Changing one reshuffles the whole demo, which is
 * a bigger visual change than it looks -- treat them as part of the fixture.
 */
const mine = buildFamily({
	treeId: "tree-mine",
	prefix: "m",
	culture: "anglo",
	seed: 20260129,
	depth: 5,
	fanout: [3, 3, 3, 2, 0],
});

/** A cousin's tree in the same tradition; overlaps `mine` on the founders. */
const cousins = buildFamily({
	treeId: "tree-cousin",
	prefix: "c",
	culture: "anglo",
	seed: 71042,
	depth: 4,
	fanout: [3, 3, 2, 0],
});

/**
 * A tree that married in from a different naming tradition.
 *
 * Its own founders are unrelated to the other two; the join happens one
 * generation down. That is the realistic case for Kinfolk: families connect at a
 * marriage, not at the root.
 */
const inLaws = buildFamily({
	treeId: "tree-inlaw",
	prefix: "n",
	culture: "nordic",
	seed: 3319,
	depth: 4,
	fanout: [3, 2, 2, 0],
});

function toSlice(name: string, built: Built, treeId: string): TreeSlice {
	return {
		treeId,
		treeName: name,
		people: built.people,
		unions: built.unions,
		relations: built.relations,
		contacts: built.contacts,
	};
}

export const sampleSlices: TreeSlice[] = [
	toSlice("Hawkins line", mine, "tree-mine"),
	toSlice("Clarke branch", cousins, "tree-cousin"),
	toSlice("Braathen side", inLaws, "tree-inlaw"),
];

/**
 * Accepted identity links between the trees.
 *
 * Both founders of `cousins` are the same couple as `mine`'s founders -- that is
 * what makes them cousins -- plus one third-generation person the in-law tree
 * also recorded. Three links is enough to show fusion, transitivity and the
 * stacked-sheet reveal without every card claiming to be merged.
 */
export const sampleLinks: AcceptedLink[] = buildLinks();

function buildLinks(): AcceptedLink[] {
	const links: AcceptedLink[] = [];

	// Founders: ids 1 and 2 in each tree by construction (see buildFamily).
	links.push({ personAId: "m1", personBId: "c1" });
	links.push({ personAId: "m2", personBId: "c2" });

	// One person the in-law tree also holds a row for. Picked from the middle
	// generation of each, where a marriage would actually join two families.
	const mid = mine.byDepth[2]?.[0];
	const theirs = inLaws.byDepth[1]?.[0];
	if (mid && theirs) links.push({ personAId: mid, personBId: theirs });

	return links;
}

export const samplePrimaryTreeId = "tree-mine";

/**
 * The viewer: somebody living, in the youngest generation of their own tree.
 *
 * Searched rather than indexed. A fixed `byDepth[3][0]` looks right and was wrong:
 * mortality is keyed on birth year, so that slot held a person who had died, and
 * the demo opened with the viewer's own card on the deceased rail. Walking up from
 * the youngest generation keeps this correct if the fanout or depth ever changes.
 */
export const sampleSelfId = pickSelf();

function pickSelf(): string {
	for (let depth = mine.byDepth.length - 1; depth >= 0; depth--) {
		const living = (mine.byDepth[depth] ?? []).find(
			(id) => mine.people.find((person) => person.id === id)?.living === "living",
		);
		if (living) return living;
	}
	return "m1";
}
