/**
 * What each person IS to the viewer: "grandmother", "second cousin", "brother".
 *
 * The card used to spend its two spare lines on a birth surname and two channel
 * icons. Neither answers the question a viewer actually arrives with -- Cambridge
 * Intelligence puts it as "avoid repeating words if they appear across most nodes"
 * and an `@` glyph on 60 of 117 cards separates nobody. A kinship term is the
 * opposite: it is different on almost every card, and it is the one fact that
 * cannot be recovered by looking at the picture, because counting six edges up and
 * four back down is exactly what a viewer cannot do by eye.
 *
 * Computed from the graph rather than stored. A stored label would be wrong the
 * moment somebody inserts a missing generation, and it would have to be written
 * once per viewer -- the same man is a father to one account and a great-uncle to
 * another.
 *
 * Pure: no React, no DB, so the arithmetic is unit-testable. Which matters here
 * more than anywhere, because "second cousin once removed" is a claim about a
 * family that a reader will believe without checking.
 */
import type { Person, RelationKind } from "../db/schema";
import type { FusedGraph, FusedPerson } from "./graph";
import { relationLabel } from "./relations";

/**
 * The graph reduced to the three adjacencies kinship needs.
 *
 * Built once per graph and reused for every person, because the naive shape --
 * walk the union list per lookup -- is O(people * unions) and this runs for all
 * 117 people on every layout.
 */
type FamilyIndex = {
	/** Person id to their parents' ids. */
	parents: Map<string, string[]>;
	/** Person id to their partners' ids. */
	partners: Map<string, string[]>;
};

function indexFamily(graph: FusedGraph): FamilyIndex {
	const parents = new Map<string, string[]>();
	const partners = new Map<string, string[]>();

	for (const union of graph.unions) {
		const couple = [union.partnerAId, union.partnerBId].filter((id): id is string => Boolean(id));

		for (const a of couple) {
			for (const b of couple) {
				if (a === b) continue;
				push(partners, a, b);
			}
		}

		for (const childId of union.childIds) {
			for (const parentId of couple) push(parents, childId, parentId);
		}
	}

	return { parents, partners };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
	const existing = map.get(key);
	if (existing) existing.push(value);
	else map.set(key, [value]);
}

/**
 * Every ancestor of `startId`, and how many generations up each one sits.
 *
 * Includes the person themselves at 0, which is what makes the (up, down) pair
 * below cover parent, child and self with no special cases. Breadth-first so the
 * SHORTEST path wins: cousins marry, and in a graph where two branches rejoin the
 * same ancestor can be reachable at two depths.
 */
function ancestorDepths(startId: string, parents: Map<string, string[]>): Map<string, number> {
	const depths = new Map<string, number>([[startId, 0]]);
	let frontier = [startId];
	let depth = 0;

	while (frontier.length > 0) {
		depth += 1;
		const next: string[] = [];
		for (const id of frontier) {
			for (const parentId of parents.get(id) ?? []) {
				if (depths.has(parentId)) continue;
				depths.set(parentId, depth);
				next.push(parentId);
			}
		}
		frontier = next;
	}

	return depths;
}

type Sex = Person["sex"];

/** Gendered where the data says so, neutral where it does not. */
function pick(sex: Sex, female: string, male: string, neutral: string): string {
	if (sex === "female") return female;
	if (sex === "male") return male;
	return neutral;
}

/**
 * How many "great"s, written out to three and numbered after.
 *
 * "great-great-great-great-grandmother" is 38 characters of mostly one word, on a
 * card 200px wide. Past three the count is the information, so it is printed as a
 * count.
 */
function greats(count: number, base: string): string {
	if (count <= 0) return base;
	if (count <= 3) return `${"great-".repeat(count)}${base}`;
	return `${count}x great-${base}`;
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];

function ordinal(n: number): string {
	return ORDINALS[n - 1] ?? `${n}th`;
}

/**
 * A blood term from the two distances to the nearest common ancestor.
 *
 * This is the whole of consanguinity in one function, and the reason it is worth
 * writing rather than special-casing: `up` generations from the viewer to a shared
 * ancestor, `down` from that ancestor to the person. Every term falls out.
 *
 *   0,0  you          1,0  parent        0,1  child
 *   1,1  sibling      2,0  grandparent   0,2  grandchild
 *   2,1  aunt/uncle   1,2  niece/nephew  2,2  first cousin
 *
 * Cousins generalise: the degree is `min(up, down) - 1` and the remove is the
 * difference, which is where "second cousin once removed" comes from -- a phrase
 * people use loosely and this gets right.
 */
export function bloodTerm(up: number, down: number, sex: Sex): string {
	if (up === 0 && down === 0) return "you";

	// Direct line down: child, grandchild, great-grandchild.
	if (up === 0) {
		if (down === 1) return pick(sex, "daughter", "son", "child");
		return greats(down - 2, pick(sex, "granddaughter", "grandson", "grandchild"));
	}

	// Direct line up: parent, grandparent, great-grandparent.
	if (down === 0) {
		if (up === 1) return pick(sex, "mother", "father", "parent");
		return greats(up - 2, pick(sex, "grandmother", "grandfather", "grandparent"));
	}

	if (up === 1 && down === 1) return pick(sex, "sister", "brother", "sibling");

	// Parent's sibling and further up the same rung: aunt, great-aunt.
	if (down === 1) return greats(up - 2, pick(sex, "aunt", "uncle", "aunt or uncle"));

	// Sibling's child and further down: niece, great-niece.
	if (up === 1) return greats(down - 2, pick(sex, "niece", "nephew", "niece or nephew"));

	const degree = Math.min(up, down) - 1;
	const removed = Math.abs(up - down);
	const cousin = `${ordinal(degree)} cousin`;
	if (removed === 0) return cousin;
	if (removed === 1) return `${cousin} once removed`;
	if (removed === 2) return `${cousin} twice removed`;
	return `${cousin} ${removed}x removed`;
}

/**
 * The in-law term for a blood relation of the viewer's partner, or a partner of
 * their blood relation.
 *
 * Three of these are real English words. The rest are built as "<rung> by
 * marriage", and that phrasing is doing deliberate work: a bare "in-law" was the
 * first version and it landed on 29 of the 117 cards in the sample tree, which is
 * the same repeated-word problem the channel icons had. It filled the one line the
 * card has with a word that separated a quarter of the canvas into one bucket.
 *
 * Cousin degree is dropped on purpose. "second cousin once removed by marriage" is
 * 38 characters, and past the first rung the exact degree of somebody you are not
 * related to is not what a viewer is reading the card for.
 */
function inLawTerm(up: number, down: number, sex: Sex): string {
	if (up === 1 && down === 0) return pick(sex, "mother-in-law", "father-in-law", "parent-in-law");
	if (up === 1 && down === 1) return pick(sex, "sister-in-law", "brother-in-law", "sibling-in-law");
	if (up === 0 && down === 1) return pick(sex, "daughter-in-law", "son-in-law", "child-in-law");

	if (down === 0) return `${greats(up - 2, "grandparent")} by marriage`;
	if (up === 0) return `${greats(down - 2, "grandchild")} by marriage`;
	if (down === 1)
		return `${greats(up - 2, pick(sex, "aunt", "uncle", "aunt or uncle"))} by marriage`;
	if (up === 1)
		return `${greats(down - 2, pick(sex, "niece", "nephew", "niece or nephew"))} by marriage`;
	return "cousin by marriage";
}

export type Kinship = {
	/** "grandmother", "second cousin once removed", "friend". */
	label: string;
	/**
	 * How the label was arrived at. The card draws blood kin and partners more
	 * firmly than an in-law guess or a social edge, so it has to know which it got.
	 */
	via: "self" | "blood" | "partner" | "in_law" | "relation";
};

/**
 * Everybody's relationship to the viewer, keyed by fused person id.
 *
 * Four passes, strongest claim first, and the order is the point: a man who is
 * both your uncle and your colleague is your uncle. Skipping a pass because an
 * earlier one already answered is what keeps that true.
 *
 * `selfId` is a FUSED id. Callers hold an original row id and must map it through
 * `graph.idMap` first, since after fusion the viewer's own row is one contributor
 * to a node whose id is the smallest member's.
 */
export function kinshipMap(graph: FusedGraph, selfId?: string): Map<string, Kinship> {
	const labels = new Map<string, Kinship>();
	if (!selfId) return labels;

	const { parents, partners } = indexFamily(graph);
	const sexById = new Map<string, Sex>(graph.people.map((p) => [p.id, p.primary.sex]));
	const sexOf = (id: string): Sex => sexById.get(id) ?? "unknown";
	if (!sexById.has(selfId)) return labels;

	const mine = ancestorDepths(selfId, parents);

	/* 1. Blood, including the viewer themselves. */
	for (const person of graph.people) {
		const theirs = ancestorDepths(person.id, parents);
		const best = nearestCommon(mine, theirs);
		if (!best) continue;
		labels.set(person.id, {
			label: bloodTerm(best.up, best.down, sexOf(person.id)),
			via: person.id === selfId ? "self" : "blood",
		});
	}

	/* 2. The viewer's own partners, which no ancestor walk can reach. */
	for (const partnerId of partners.get(selfId) ?? []) {
		if (labels.has(partnerId)) continue;
		labels.set(partnerId, {
			label: pick(sexOf(partnerId), "wife", "husband", "partner"),
			via: "partner",
		});
	}

	/* 3. In-laws: blood kin of a partner, and partners of blood kin. */
	for (const partnerId of partners.get(selfId) ?? []) {
		const theirLine = ancestorDepths(partnerId, parents);
		for (const person of graph.people) {
			if (labels.has(person.id)) continue;
			const best = nearestCommon(theirLine, ancestorDepths(person.id, parents));
			if (!best) continue;
			labels.set(person.id, {
				label: inLawTerm(best.up, best.down, sexOf(person.id)),
				via: "in_law",
			});
		}
	}

	// Partner of somebody already placed by blood. Read from the blood relative's
	// rung, so a sibling's husband is a brother-in-law rather than a bare "in-law".
	for (const [relativeId, kin] of [...labels]) {
		if (kin.via !== "blood") continue;
		const theirs = ancestorDepths(relativeId, parents);
		const rung = nearestCommon(mine, theirs);
		if (!rung) continue;
		for (const spouseId of partners.get(relativeId) ?? []) {
			if (labels.has(spouseId)) continue;
			labels.set(spouseId, {
				label: inLawTerm(rung.up, rung.down, sexOf(spouseId)),
				via: "in_law",
			});
		}
	}

	/* 4. A recorded relation, for everybody the family graph cannot reach at all --
	   which is most of a contact graph, and the reason this pass exists. */
	for (const relation of graph.relations) {
		const otherId =
			relation.personAId === selfId
				? relation.personBId
				: relation.personBId === selfId
					? relation.personAId
					: null;
		if (!otherId || labels.has(otherId)) continue;
		labels.set(otherId, {
			label: relationLabel(
				relation.kind as RelationKind,
				relation.personAId,
				otherId,
				relation.label,
			),
			via: "relation",
		});
	}

	return labels;
}

/**
 * The common ancestor reachable in the fewest steps overall.
 *
 * Total distance, not the shallowest ancestor: your father and your first cousin
 * share a grandparent, but your father is also his own ancestor at depth 1, and
 * picking by depth alone would call him a cousin. Ties break toward the smaller
 * `up`, which keeps a merged branch reading from the viewer's own side.
 */
function nearestCommon(
	mine: Map<string, number>,
	theirs: Map<string, number>,
): { up: number; down: number } | null {
	let best: { up: number; down: number } | null = null;

	for (const [id, up] of mine) {
		const down = theirs.get(id);
		if (down === undefined) continue;
		if (
			!best ||
			up + down < best.up + best.down ||
			(up + down === best.up + best.down && up < best.up)
		) {
			best = { up, down };
		}
	}

	return best;
}

/** The fused id of the viewer's own row, or undefined when there is no viewer. */
export function fusedSelfId(graph: FusedGraph, selfRowId?: string): string | undefined {
	if (!selfRowId) return undefined;
	return graph.idMap.get(selfRowId) ?? selfRowId;
}

/** Convenience for the card, which holds a `FusedPerson` and not an id. */
export function kinshipOf(
	labels: Map<string, Kinship>,
	person: Pick<FusedPerson, "id">,
): Kinship | undefined {
	return labels.get(person.id);
}
