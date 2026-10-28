/**
 * Sample data for the demo: two real families, from Wikidata.
 *
 * Queen Victoria's descendants to her great-grandchildren, and Christian IX of Denmark's
 * to his grandchildren, each with the people they married. Built by `pnpm sample:build`
 * (scripts/build-sample.mts) into sample-data.json, which is committed, so the demo is the
 * same on every build. Real and public rather than invented: Wikidata is CC0, and every
 * person here was born between 1817 and 1920 and has died, so the demo holds nobody living.
 *
 * Two trees because the combined view is the product. Each family records its own; where
 * they married into each other -- Edward VII and Alexandra of Denmark, and every child of
 * theirs -- both trees hold a row for the same person, joined by an accepted link, which
 * is exactly the fusion a real pair of families would do by consent. About 220 people is
 * the scale where the layout has to earn it: crossings, wide generations, remarriages and
 * divorces all occur, because they occurred.
 *
 * No contact details. The people are historical, and a made-up phone number on a real
 * person would be a false fact; the contact features are shown with your own records.
 */
import type { Person, PersonRelation } from "../db/schema";
import type { AcceptedLink, TreeSlice, UnionWithChildren } from "./graph";
import { canonicalPair } from "./relations";
import data from "./sample-data.json";

/**
 * When the feed pretends "now" is, for the sample data's own timestamps.
 *
 * Row timestamps drive the family feed, and every row created at one instant would render
 * as one giant "7 months ago" dump -- a feed with no rhythm shows nothing about what a
 * feed is for. So each row gets a DETERMINISTIC moment in the ~7 months before this
 * reference, hashed from its own id: stable across reloads (the demo rebuilds per request,
 * and a feed that reshuffles on refresh reads as broken), and varied enough that days,
 * weeks and months all appear.
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
	// A quarter of the records were touched again later, because a real family archive is
	// corrections as much as arrivals.
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
 * Mulberry32. Chosen because it is eight lines, has no dependencies, and its sequence is
 * stable across Node versions -- `Math.random` is seedless and would make the demo's feed
 * different on every reload.
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

const SEXES = new Set<Person["sex"]>(["female", "male", "other", "unknown"]);
const LIVING = new Set<Person["living"]>(["living", "deceased", "unknown"]);
const STATUSES = new Set<UnionWithChildren["status"]>(["married", "divorced"]);

type SamplePerson = (typeof data.trees)[number]["people"][number];

function person(row: SamplePerson, treeId: string): Person {
	return {
		id: row.id,
		treeId,
		givenName: row.givenName,
		familyName: row.familyName,
		birthFamilyName: null,
		nickname: null,
		sex: SEXES.has(row.sex as Person["sex"]) ? (row.sex as Person["sex"]) : "unknown",
		birthDate: row.birthDate,
		birthDateApprox: row.birthDateApprox,
		birthPlace: null,
		deathDate: row.deathDate,
		deathDateApprox: row.deathDateApprox,
		deathPlace: null,
		living: LIVING.has(row.living as Person["living"])
			? (row.living as Person["living"])
			: "unknown",
		bio: null,
		photoKey: null,
		currentPlace: null,
		occupation: null,
		// Every row cites the Wikidata item it was built from.
		verification: "documented",
		sourceNote: `Wikidata ${row.qid}`,
		verifiedAt: null,
		verifiedById: null,
		claimedByUserId: null,
		...stamp(row.id),
	};
}

export const sampleSlices: TreeSlice[] = data.trees.map((tree) => ({
	treeId: tree.treeId,
	treeName: tree.treeName,
	people: tree.people.map((row) => person(row, tree.treeId)),
	unions: tree.unions.map(
		(union): UnionWithChildren => ({
			id: union.id,
			treeId: tree.treeId,
			partnerAId: union.partnerAId,
			partnerBId: union.partnerBId,
			status: STATUSES.has(union.status as UnionWithChildren["status"])
				? (union.status as UnionWithChildren["status"])
				: "married",
			startDate: null,
			endDate: null,
			place: null,
			createdAt: stamp(union.id).createdAt,
			childIds: union.childIds,
		}),
	),
	relations: tree.relations.map((relation): PersonRelation => {
		// Through the same canonicaliser the real insert path uses, so the demo cannot show a
		// shape the database would reject. A godparent is directed: A holds the role.
		const pair = canonicalPair("godparent", relation.personAId, relation.personBId);
		return {
			id: relation.id,
			treeId: tree.treeId,
			personAId: pair.personAId,
			personBId: pair.personBId,
			kind: "godparent",
			label: null,
			closeness: null,
			startDate: null,
			endDate: null,
			note: null,
			createdAt: stamp(relation.id).createdAt,
		};
	}),
	contacts: {},
}));

/** The people both families recorded, accepted as the same person on each side. */
export const sampleLinks: AcceptedLink[] = data.links;

/** The viewer's own tree: Queen Victoria's family. */
export const samplePrimaryTreeId = data.trees[0]?.treeId ?? "tree-victoria";

/** The viewer: George VI, a great-grandson of both Victoria and Christian IX. */
export const sampleSelfId = data.selfId;
