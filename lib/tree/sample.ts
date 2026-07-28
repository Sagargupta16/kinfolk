/**
 * Sample data for the /demo route.
 *
 * Two trees that overlap on one couple: it exists so the combined-view merge is
 * visible before any database is wired up. Not seed data, not fixtures for
 * tests -- graph.test.ts builds its own.
 */
import type {
	ContactDetail,
	ContactKind,
	Person,
	PersonRelation,
	RelationKind,
} from "../db/schema";
import type { AcceptedLink, TreeSlice, UnionWithChildren } from "./graph";
import { canonicalPair } from "./relations";

const EPOCH = new Date("2026-01-01T00:00:00Z");

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
		bio: null,
		photoKey: null,
		claimedByUserId: null,
		createdAt: EPOCH,
		updatedAt: EPOCH,
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
		createdAt: EPOCH,
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

/** Sagar's side: grandparents, their two sons, and one grandchild. */
const myTree: TreeSlice = {
	treeId: "tree-mine",
	treeName: "Gupta (mine)",
	people: [
		p("m-gf", "tree-mine", "Hariram", "Gupta", {
			birthDate: "1918-06-11",
			deathDate: "1991-03-04",
			birthPlace: "Kanpur",
		}),
		p("m-gm", "tree-mine", "Savitri", "Gupta", {
			birthFamilyName: "Agarwal",
			birthDate: "1924-09-02",
			deathDate: "2003-12-18",
		}),
		p("m-dad", "tree-mine", "Rakesh", "Gupta", { birthDate: "1958-01-27" }),
		p("m-mum", "tree-mine", "Sunita", "Gupta", {
			birthFamilyName: "Seth",
			birthDate: "1962-07-15",
		}),
		p("m-uncle", "tree-mine", "Mahesh", "Gupta", { birthDate: "1955-04-09" }),
		p("m-me", "tree-mine", "Sagar", "Gupta", { birthDate: "1996-10-16" }),
		p("m-sister", "tree-mine", "Priya", "Gupta", { birthDate: "1999-02-23" }),
		// Not blood relatives, and in no union. They exist to show that a contact
		// can be a node with no place in any generation.
		p("m-friend", "tree-mine", "Rohan", "Mehta", { birthDate: "1996-03-08" }),
		p("m-friend-dad", "tree-mine", "Vikram", "Mehta", { birthDate: "1961-11-19" }),
	],
	unions: [
		u("m-u1", "tree-mine", "m-gf", "m-gm", ["m-dad", "m-uncle"], { startDate: "1948-02-10" }),
		u("m-u2", "tree-mine", "m-dad", "m-mum", ["m-me", "m-sister"], { startDate: "1990-11-28" }),
	],
	relations: [
		// A friend who belongs to no generation -- the case that proves social
		// edges must stay out of the layout.
		rel("m-r1", "tree-mine", "close_friend", "m-me", "m-friend"),
		rel("m-r2", "tree-mine", "family_friend", "m-dad", "m-friend-dad"),
		// Directed: A is B's mentor, and B's side reads "mentee".
		rel("m-r3", "tree-mine", "mentor", "m-uncle", "m-me"),
		rel("m-r4", "tree-mine", "neighbour", "m-mum", "m-friend-dad"),
	],
	contacts: {
		"m-me": [
			contact("m-c1", "m-me", "phone", "+91 98765 43210", { isPrimary: true, label: "mobile" }),
			contact("m-c2", "m-me", "email", "sagar@example.com", { visibility: "linked" }),
			contact("m-c3", "m-me", "instagram", "@sagar", { visibility: "shared" }),
		],
		"m-dad": [contact("m-c4", "m-dad", "phone", "+91 90000 11111", { isPrimary: true })],
		"m-sister": [contact("m-c5", "m-sister", "whatsapp", "+91 98111 22222")],
		// Recorded by BOTH families with the same value: fusion must show it once.
		"m-uncle": [contact("m-c6", "m-uncle", "phone", "+91 91234 56789", { isPrimary: true })],
		"m-friend": [contact("m-c7", "m-friend", "email", "rohan@example.com")],
	},
};

/**
 * The cousin's side. Note m-uncle appears here too as c-dad, and the shared
 * grandparents are recorded independently, with a slightly different spelling
 * of the grandmother's maiden name. That disagreement is the point: fusion
 * keeps both rows.
 */
const cousinTree: TreeSlice = {
	treeId: "tree-cousin",
	treeName: "Gupta (cousin)",
	people: [
		p("c-gf", "tree-cousin", "Hariram", "Gupta", {
			birthDateApprox: "about 1918",
			deathDate: "1991-03-04",
		}),
		p("c-gm", "tree-cousin", "Savitri", "Gupta", {
			birthFamilyName: "Aggarwal",
			birthDate: "1924-09-02",
		}),
		p("c-dad", "tree-cousin", "Mahesh", "Gupta", { birthDate: "1955-04-09" }),
		p("c-mum", "tree-cousin", "Kavita", "Gupta", {
			birthFamilyName: "Jain",
			birthDate: "1959-05-30",
		}),
		p("c-cousin", "tree-cousin", "Anjali", "Gupta", { birthDate: "1988-08-12" }),
	],
	unions: [
		u("c-u1", "tree-cousin", "c-gf", "c-gm", ["c-dad"]),
		u("c-u2", "tree-cousin", "c-dad", "c-mum", ["c-cousin"], { startDate: "1984-12-02" }),
	],
	relations: [
		// Recorded by the cousin's side only. After fusion the endpoint moves onto
		// the merged Mahesh node, so it shows up in the combined view too.
		rel("c-r1", "tree-cousin", "colleague", "c-dad", "c-cousin"),
	],
	contacts: {
		// Same number as m-c6, recorded independently. Dedupes to one on merge.
		"c-dad": [contact("c-c1", "c-dad", "phone", "+91 91234 56789")],
		"c-cousin": [
			contact("c-c2", "c-cousin", "email", "anjali@example.com", { isPrimary: true }),
			contact("c-c3", "c-cousin", "linkedin", "in/anjali-gupta", { visibility: "shared" }),
		],
	},
};

export const sampleSlices: TreeSlice[] = [myTree, cousinTree];

/** Accepted identity links between the two trees. */
export const sampleLinks: AcceptedLink[] = [
	{ personAId: "m-gf", personBId: "c-gf" },
	{ personAId: "m-gm", personBId: "c-gm" },
	{ personAId: "m-uncle", personBId: "c-dad" },
];

export const samplePrimaryTreeId = "tree-mine";
export const sampleSelfId = "m-me";
