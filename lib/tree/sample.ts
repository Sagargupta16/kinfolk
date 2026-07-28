/**
 * Sample data for the /demo route.
 *
 * Two trees that overlap on one couple: it exists so the combined-view merge is
 * visible before any database is wired up. Not seed data, not fixtures for
 * tests -- graph.test.ts builds its own.
 */
import type { Person } from "../db/schema";
import type { AcceptedLink, TreeSlice, UnionWithChildren } from "./graph";

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
	],
	unions: [
		u("m-u1", "tree-mine", "m-gf", "m-gm", ["m-dad", "m-uncle"], { startDate: "1948-02-10" }),
		u("m-u2", "tree-mine", "m-dad", "m-mum", ["m-me", "m-sister"], { startDate: "1990-11-28" }),
	],
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
