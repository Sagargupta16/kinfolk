/**
 * Build the demo family, lib/tree/sample-data.json, from Wikidata.
 *
 *   pnpm sample:build
 *
 * Two real families that married into each other, so the combined view has something
 * true to show: Queen Victoria's descendants to her great-grandchildren, and Christian
 * IX of Denmark's to his grandchildren. Each family's tree holds its own descendants and
 * the people they married; where the two met -- Edward VII and Alexandra of Denmark, and
 * every child of theirs -- both trees hold a row for the same person, joined by an
 * accepted link, which is the fusion Kinfolk exists to show.
 *
 * Wikidata is CC0, so the data needs no licence beyond the note this file writes. Everybody
 * in it was born before about 1920 and has died: a public sample has no business holding
 * living people. Run by hand, never in CI, because it reads the network; the output is
 * committed, so the demo is the same on every build until somebody rebuilds it.
 */
import { writeFile } from "node:fs/promises";

const ENDPOINT = "https://query.wikidata.org/sparql";
// Wikidata asks every script for a User-Agent naming it and a way to reach its author.
const USER_AGENT = "kinfolk-sample-builder/1.0 (https://github.com/Sagargupta16/kinfolk)";
const OUT = new URL("../lib/tree/sample-data.json", import.meta.url);

type Root = { qid: string; prefix: string; treeId: string; treeName: string; depth: number };

const ROOTS: Root[] = [
	{
		qid: "Q9439",
		prefix: "v",
		treeId: "tree-victoria",
		treeName: "Queen Victoria's family",
		depth: 3,
	},
	{
		qid: "Q151305",
		prefix: "c",
		treeId: "tree-christian",
		treeName: "Christian IX's family",
		depth: 2,
	},
];

/** The viewer: George VI, a great-grandson of Victoria and of Christian IX. */
const SELF_QID = "Q280856";

const MALE = "Q6581097";
const FEMALE = "Q6581072";
const DIVORCE = "Q93190";

type Binding = Record<string, { value: string } | undefined>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const qid = (uri: string) => uri.slice(uri.lastIndexOf("/") + 1);

/** One SPARQL query, POSTed (VALUES lists outgrow a URL), retried on a rate limit. */
async function sparql(query: string): Promise<Binding[]> {
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const response = await fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "application/sparql-results+json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({ query }),
			signal: AbortSignal.timeout(90_000),
		});
		if (response.status === 429 || response.status >= 500) {
			const wait = Number(response.headers.get("retry-after")) * 1000 || 3000 * (attempt + 1);
			await sleep(wait);
			continue;
		}
		if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
		const body = (await response.json()) as { results: { bindings: Binding[] } };
		return body.results.bindings;
	}
	throw new Error("Wikidata kept refusing the query");
}

/** The same query over many items, in batches small enough for the endpoint. */
async function batched(ids: string[], build: (values: string) => string): Promise<Binding[]> {
	const rows: Binding[] = [];
	for (let start = 0; start < ids.length; start += 120) {
		const values = ids
			.slice(start, start + 120)
			.map((id) => `wd:${id}`)
			.join(" ");
		rows.push(...(await sparql(build(values))));
		await sleep(400);
	}
	return rows;
}

type Member = { level: number; descendant: boolean };

/** Every person one root's tree holds: descendants to `depth`, and the people they married. */
async function collect(root: Root): Promise<Map<string, Member>> {
	const members = new Map<string, Member>([[root.qid, { level: 0, descendant: true }]]);
	let frontier = [root.qid];
	for (let level = 1; level <= root.depth && frontier.length > 0; level += 1) {
		const rows = await batched(
			frontier,
			(values) =>
				`SELECT ?parent ?child WHERE { VALUES ?parent { ${values} } ?parent wdt:P40 ?child }`,
		);
		const next: string[] = [];
		for (const row of rows) {
			const child = row.child && qid(row.child.value);
			if (!child || members.has(child)) continue;
			members.set(child, { level, descendant: true });
			next.push(child);
		}
		frontier = next;
	}

	// Both parents of every child: the one who married in is part of this family's record.
	const descendants = [...members.entries()].filter(([, m]) => m.descendant && m.level > 0);
	const parents = await batched(
		descendants.map(([id]) => id),
		(values) =>
			`SELECT ?child ?father ?mother WHERE { VALUES ?child { ${values} } OPTIONAL { ?child wdt:P22 ?father } OPTIONAL { ?child wdt:P25 ?mother } }`,
	);
	for (const row of parents) {
		const child = row.child && qid(row.child.value);
		const level = child ? (members.get(child)?.level ?? 1) - 1 : 0;
		for (const parent of [row.father, row.mother]) {
			const id = parent && qid(parent.value);
			if (id && !members.has(id)) members.set(id, { level, descendant: false });
		}
	}

	// Spouses of everybody above the last generation, childless marriages included.
	const married = [...members.entries()].filter(([, m]) => m.descendant && m.level < root.depth);
	const spouses = await batched(
		married.map(([id]) => id),
		(values) =>
			`SELECT ?person ?spouse WHERE { VALUES ?person { ${values} } ?person wdt:P26 ?spouse }`,
	);
	for (const row of spouses) {
		const person = row.person && qid(row.person.value);
		const spouse = row.spouse && qid(row.spouse.value);
		if (!person || !spouse || members.has(spouse)) continue;
		members.set(spouse, { level: members.get(person)?.level ?? 0, descendant: false });
	}
	return members;
}

type Details = {
	label: string;
	sex: "male" | "female" | "unknown";
	birth?: { value: string; precision: number };
	death?: { value: string; precision: number };
	house?: string;
	father?: string;
	mother?: string;
	spouses: { id: string; divorced: boolean }[];
	godparents: string[];
};

/** Labels, sex, dates, house, parents, marriages and godparents for every person. */
async function details(ids: string[]): Promise<Map<string, Details>> {
	const out = new Map<string, Details>();
	const get = (id: string) => {
		let entry = out.get(id);
		if (!entry) {
			entry = { label: id, sex: "unknown", spouses: [], godparents: [] };
			out.set(id, entry);
		}
		return entry;
	};

	const facts = await batched(
		ids,
		(values) => `SELECT ?p ?pLabel ?sex ?father ?mother ?houseLabel WHERE {
			VALUES ?p { ${values} }
			OPTIONAL { ?p wdt:P21 ?sex }
			OPTIONAL { ?p wdt:P22 ?father }
			OPTIONAL { ?p wdt:P25 ?mother }
			OPTIONAL { ?p wdt:P53 ?house }
			SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
		}`,
	);
	for (const row of facts) {
		const id = row.p && qid(row.p.value);
		if (!id) continue;
		const entry = get(id);
		if (row.pLabel) entry.label = row.pLabel.value;
		const sex = row.sex && qid(row.sex.value);
		if (sex === MALE) entry.sex = "male";
		if (sex === FEMALE) entry.sex = "female";
		if (row.father) entry.father = qid(row.father.value);
		if (row.mother) entry.mother = qid(row.mother.value);
		if (row.houseLabel && !entry.house) entry.house = row.houseLabel.value;
	}

	// Dates with their precision, skipping deprecated statements: a year-only birth must be
	// stored as a year, not invented into 1 January.
	for (const [property, key] of [
		["P569", "birth"],
		["P570", "death"],
	] as const) {
		const rows = await batched(
			ids,
			(values) => `SELECT ?p ?time ?precision WHERE {
				VALUES ?p { ${values} }
				?p p:${property} ?st . ?st psv:${property} ?node .
				?node wikibase:timeValue ?time ; wikibase:timePrecision ?precision .
				?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
			}`,
		);
		for (const row of rows) {
			const id = row.p && qid(row.p.value);
			if (!id || !row.time || !row.precision) continue;
			const entry = get(id);
			const precision = Number(row.precision.value);
			const current = entry[key];
			if (!current || precision > current.precision) {
				entry[key] = { value: row.time.value, precision };
			}
		}
	}

	const marriages = await batched(
		ids,
		(values) => `SELECT ?p ?spouse ?end WHERE {
			VALUES ?p { ${values} }
			?p p:P26 ?st . ?st ps:P26 ?spouse .
			OPTIONAL { ?st pq:P1534 ?end }
		}`,
	);
	for (const row of marriages) {
		const id = row.p && qid(row.p.value);
		const spouse = row.spouse && qid(row.spouse.value);
		if (!id || !spouse) continue;
		const entry = get(id);
		if (entry.spouses.some((s) => s.id === spouse)) continue;
		entry.spouses.push({
			id: spouse,
			divorced: Boolean(row.end && qid(row.end.value) === DIVORCE),
		});
	}

	const godparents = await batched(
		ids,
		(values) => `SELECT ?p ?godparent WHERE { VALUES ?p { ${values} } ?p wdt:P1290 ?godparent }`,
	);
	for (const row of godparents) {
		const id = row.p && qid(row.p.value);
		const godparent = row.godparent && qid(row.godparent.value);
		if (id && godparent) get(id).godparents.push(godparent);
	}
	return out;
}

/** "1819-05-24" when the day is recorded, otherwise the year alone for the fuzzy column. */
function dateColumns(date: { value: string; precision: number } | undefined) {
	if (!date) return { exact: null, approx: null };
	// SPARQL returns "1819-05-24T00:00:00Z"; the API form carries a leading "+".
	const match = /^([+-]?)(\d{4,})-(\d{2})-(\d{2})/.exec(date.value);
	if (!match) return { exact: null, approx: null };
	const year = Number(match[2]) * (match[1] === "-" ? -1 : 1);
	if (date.precision >= 11) return { exact: `${match[2]}-${match[3]}-${match[4]}`, approx: null };
	if (date.precision >= 9) return { exact: null, approx: String(year) };
	return { exact: null, approx: `about ${year}` };
}

/**
 * A card-length name from a Wikidata label.
 *
 * Titles and the territorial tail come off ("Princess Louise, Duchess of Argyll" is
 * Louise, "Princess Alice of the United Kingdom" is Alice), and the house becomes the
 * family name, the way genealogy records royal lines: "Alice" of the House of
 * Saxe-Coburg and Gotha is Alice Saxe-Coburg. A regnal number stays, since "Edward VII"
 * is the name everybody knows him by.
 */
const TITLES = [
	"Hereditary Grand Duke",
	"Hereditary Prince",
	"Grand Duchess",
	"Grand Duke",
	"Crown Princess",
	"Crown Prince",
	"Archduchess",
	"Archduke",
	"Landgravine",
	"Landgrave",
	"Margravine",
	"Margrave",
	"Princess",
	"Prince",
	"Duchess",
	"Duke",
	"Countess",
	"Count",
	"Empress",
	"Emperor",
	"Queen",
	"King",
	"Tsarina",
	"Tsar",
	"Infanta",
	"Infante",
	"Lady",
	"Lord",
	"Sir",
];

/** Longest name a card shows unclipped: measured, the full card fits about 20 characters. */
const CARD_NAME = 20;

function nameOf(label: string, house: string | undefined) {
	// "Maria Feodorovna (Dagmar of Denmark)" -> "Maria Feodorovna"; then the title tail.
	let given =
		label
			.replace(/\s*\([^)]*\)\s*/g, " ")
			.split(",")[0]
			?.trim() ?? label;
	for (const title of TITLES) {
		if (given.startsWith(`${title} `)) {
			given = given.slice(title.length + 1);
			break;
		}
	}
	const of = given.indexOf(" of ");
	const territory = of > 0 ? given.slice(of + 4) : null;
	if (of > 0) given = given.slice(0, of);
	// "Fernando de Borbón y Battenberg": the house carries the family name.
	given = given.replace(/\s(de|von|van|zu)\s.*$/, "");
	let words = given.replace(/\s+/g, " ").trim().split(" ");
	// A monarch is known by the regnal name alone: "George VI", never "George VI Windsor".
	if (words.length > 1 && ROMAN.test(words.at(-1) ?? "")) {
		return { givenName: words.join(" "), familyName: null };
	}
	let family = houseName(house);
	// A surname already in the label ("Alexander Mountbatten") is the family name, once,
	// and outranks a place ("Alexander Ramsay of Mar" is a Ramsay, not a Mar).
	const last = words.at(-1);
	if (words.length > 1 && last && (last === family || (!family && /^[A-Z][a-z]+$/.test(last)))) {
		family = last;
		words = words.slice(0, -1);
	}
	if (!family && territory) family = territoryName(territory);
	// A patronymic ("Alexander Alexandrovich Romanov") makes the name too long for a card;
	// with a family name beside it, the given name is enough.
	if (family)
		words = words.filter((word, index) => index === 0 || !/(ovich|evich|ovna|evna)$/.test(word));
	let givenName = words.join(" ");
	if (`${givenName} ${family ?? ""}`.trim().length > CARD_NAME)
		givenName = words.slice(0, 1).join(" ");
	if (`${givenName} ${family ?? ""}`.trim().length > CARD_NAME) family = null;
	return { givenName, familyName: family };
}

/** A regnal number, which stays with the name: "Edward VII", "Alfonso XIII". */
const ROMAN = /^[IVXL]+$/;

/** Records with no name to show: a stillborn or unnamed child is a fact, not a card. */
const UNNAMED = /^(stillborn|unnamed|infant)\b/i;

const HOUSES: Record<string, string> = {
	"House of Saxe-Coburg and Gotha": "Saxe-Coburg",
	"House of Windsor": "Windsor",
	"House of Hanover": "Hanover",
	"House of Glücksburg": "Glücksburg",
	"House of Schleswig-Holstein-Sonderburg-Glücksburg": "Glücksburg",
	"House of Hesse": "Hesse",
	"House of Hesse-Darmstadt": "Hesse",
	"House of Battenberg": "Battenberg",
	"Battenberg family": "Battenberg",
	"House of Mountbatten": "Mountbatten",
	"House of Holstein-Gottorp-Romanov": "Romanov",
	"House of Romanov": "Romanov",
	"House of Hohenzollern": "Hohenzollern",
	"House of Teck": "Teck",
	"House of Württemberg": "Württemberg",
	"House of Wittelsbach": "Wittelsbach",
	"House of Bourbon": "Bourbon",
	"House of Bourbon-Anjou": "Bourbon",
	"House of Habsburg-Lorraine": "Habsburg",
	"House of Wettin": "Wettin",
	"House of Bernadotte": "Bernadotte",
	"House of Orléans": "Orléans",
	"House of Braganza": "Braganza",
	"House of Hohenzollern-Sigmaringen": "Hohenzollern",
	"House of Schleswig-Holstein-Sonderburg-Augustenburg": "Augustenburg",
	"House of Oldenburg": "Oldenburg",
	"House of Mecklenburg": "Mecklenburg",
	"House of Mecklenburg-Strelitz": "Mecklenburg",
	"House of Mecklenburg-Schwerin": "Mecklenburg",
	"House of Waldeck and Pyrmont": "Waldeck",
	"House of Nassau-Weilburg": "Nassau",
	"House of Baden": "Baden",
	"House of Zähringen": "Baden",
	"House of Liechtenstein": "Liechtenstein",
	"House of Petrović-Njegoš": "Petrović",
	"House of Savoy": "Savoy",
	"House of Lippe": "Lippe",
	"House of Schaumburg-Lippe": "Schaumburg",
	"House of Wied": "Wied",
	"House of Reuss": "Reuss",
	"House of Saxe-Meiningen": "Saxe-Meiningen",
	"House of Saxe-Altenburg": "Saxe-Altenburg",
	"House of Saxe-Weimar-Eisenach": "Saxe-Weimar",
	"House of Anhalt": "Anhalt",
	"House of Anhalt-Dessau": "Anhalt",
	"House of Leiningen": "Leiningen",
	"House of Fife": "Fife",
	"House of Campbell": "Campbell",
	"Clan Campbell": "Campbell",
	"House of Bentinck": "Bentinck",
	"House of Bowes-Lyon": "Bowes-Lyon",
	"Bowes-Lyon family": "Bowes-Lyon",
	"House of Grosvenor": "Grosvenor",
	"House of Cambridge": "Cambridge",
	"House of Ramsay": "Ramsay",
	"Clan Ramsay": "Ramsay",
};

function houseName(house: string | undefined): string | null {
	if (!house) return null;
	if (HOUSES[house]) return HOUSES[house] ?? null;
	const trimmed = house
		.replace(/^(House|Clan) of /, "")
		.replace(/^Clan /, "")
		.replace(/ (family|dynasty|clan)$/i, "")
		.trim();
	// "Duke of Teck" is a title somebody put in the family field, not a family name.
	if (/\s(of|von)\s|^(Duke|Earl|Marquess|Count)\b/.test(trimmed)) return null;
	return trimmed.length > 0 && trimmed.length <= 14 ? trimmed : null;
}

const TERRITORIES: Record<string, string> = {
	"the United Kingdom": "Windsor",
	"Great Britain": "Hanover",
	Denmark: "Glücksburg",
	Greece: "Glücksburg",
	Russia: "Romanov",
	Prussia: "Hohenzollern",
	Teck: "Teck",
	Battenberg: "Battenberg",
	Hesse: "Hesse",
	"Hesse and by Rhine": "Hesse",
	Edinburgh: "Saxe-Coburg",
	Connaught: "Saxe-Coburg",
	Albany: "Saxe-Coburg",
	Fife: "Fife",
	Sweden: "Bernadotte",
	Norway: "Glücksburg",
	Spain: "Bourbon",
	Romania: "Hohenzollern",
};

function territoryName(territory: string): string | null {
	return TERRITORIES[territory] ?? (territory.length <= 14 ? territory : null);
}

/* -------------------------------------------------------------------------- */

const trees = new Map<string, Map<string, Member>>();
for (const root of ROOTS) trees.set(root.treeId, await collect(root));
const collected = [...new Set([...trees.values()].flatMap((members) => [...members.keys()]))];
const facts = await details(collected);
// Drop the nameless records from every tree, and anybody Wikidata could not describe.
for (const members of trees.values()) {
	for (const id of [...members.keys()]) {
		const label = facts.get(id)?.label;
		if (!label || UNNAMED.test(label) || /^Q\d+$/.test(label)) members.delete(id);
	}
}
const everybody = collected.filter((id) => [...trees.values()].some((members) => members.has(id)));

type OutPerson = {
	id: string;
	qid: string;
	givenName: string;
	familyName: string | null;
	sex: "male" | "female" | "unknown";
	birthDate: string | null;
	birthDateApprox: string | null;
	deathDate: string | null;
	deathDateApprox: string | null;
	living: "living" | "deceased" | "unknown";
};
type OutUnion = {
	id: string;
	partnerAId: string | null;
	partnerBId: string | null;
	status: "married" | "divorced";
	childIds: string[];
};

const output = {
	source: {
		name: "Wikidata",
		url: "https://www.wikidata.org",
		license: "CC0 1.0",
		retrieved: new Date().toISOString().slice(0, 10),
		roots: ROOTS.map((root) => ({ qid: root.qid, treeId: root.treeId, depth: root.depth })),
	},
	trees: [] as {
		treeId: string;
		treeName: string;
		people: OutPerson[];
		unions: OutUnion[];
		relations: { id: string; kind: "godparent"; personAId: string; personBId: string }[];
	}[],
	links: [] as { personAId: string; personBId: string }[],
	selfId: "",
};

for (const root of ROOTS) {
	const members = trees.get(root.treeId) ?? new Map<string, Member>();
	const rowId = (id: string) => `${root.prefix}-${id}`;
	const people: OutPerson[] = [];
	for (const id of members.keys()) {
		const fact = facts.get(id);
		if (!fact) continue;
		const birth = dateColumns(fact.birth);
		const death = dateColumns(fact.death);
		const born = Number((birth.exact ?? birth.approx ?? "").replace(/\D/g, "").slice(0, 4)) || null;
		people.push({
			id: rowId(id),
			qid: id,
			...nameOf(fact.label, fact.house),
			sex: fact.sex,
			birthDate: birth.exact,
			birthDateApprox: birth.approx,
			deathDate: death.exact,
			deathDateApprox: death.approx,
			// Nobody born before 1920 is living now; with a death recorded, plainly not.
			living: fact.death || (born !== null && born < 1920) ? "deceased" : "unknown",
		});
	}

	// Parentage from each child's own father and mother, which Wikidata records more
	// completely than a parent's list of children.
	const unions = new Map<string, OutUnion>();
	const unionFor = (a: string | null, b: string | null) => {
		const pair = [a, b].filter((x): x is string => Boolean(x)).sort();
		const key = pair.join("+");
		let union = unions.get(key);
		if (!union) {
			union = {
				id: `${root.prefix}u-${key.replaceAll("+", "-")}`,
				partnerAId: pair[0] ? rowId(pair[0]) : null,
				partnerBId: pair[1] ? rowId(pair[1]) : null,
				status: "married",
				childIds: [],
			};
			unions.set(key, union);
		}
		return union;
	};
	for (const [id, member] of members) {
		if (!member.descendant || member.level === 0) continue;
		const fact = facts.get(id);
		const father = fact?.father && members.has(fact.father) ? fact.father : null;
		const mother = fact?.mother && members.has(fact.mother) ? fact.mother : null;
		if (!father && !mother) continue;
		unionFor(father, mother).childIds.push(rowId(id));
	}
	for (const id of members.keys()) {
		for (const spouse of facts.get(id)?.spouses ?? []) {
			if (!members.has(spouse.id)) continue;
			const union = unionFor(id, spouse.id);
			if (spouse.divorced) union.status = "divorced";
		}
	}

	// Godparents only inside the tree: a relation may never straddle two families' records.
	const relations: { id: string; kind: "godparent"; personAId: string; personBId: string }[] = [];
	for (const id of members.keys()) {
		for (const godparent of facts.get(id)?.godparents ?? []) {
			if (!members.has(godparent) || godparent === id) continue;
			relations.push({
				id: `${root.prefix}r-${godparent}-${id}`,
				kind: "godparent",
				personAId: rowId(godparent),
				personBId: rowId(id),
			});
		}
	}

	output.trees.push({
		treeId: root.treeId,
		treeName: root.treeName,
		people: people.sort((a, b) => a.id.localeCompare(b.id)),
		unions: [...unions.values()].sort((a, b) => a.id.localeCompare(b.id)),
		relations: relations.sort((a, b) => a.id.localeCompare(b.id)),
	});
}

// The same Wikidata item in both trees is the same person, accepted by both families.
const [first, second] = ROOTS;
if (first && second) {
	const shared = everybody.filter(
		(id) => trees.get(first.treeId)?.has(id) && trees.get(second.treeId)?.has(id),
	);
	output.links = shared.map((id) => ({
		personAId: `${first.prefix}-${id}`,
		personBId: `${second.prefix}-${id}`,
	}));
}
output.selfId = `${ROOTS[0]?.prefix}-${SELF_QID}`;

await writeFile(OUT, `${JSON.stringify(output, null, "\t")}\n`);
for (const tree of output.trees) {
	console.log(
		`${tree.treeName}: ${tree.people.length} people, ${tree.unions.length} unions, ${tree.relations.length} godparent relations`,
	);
}
console.log(`links: ${output.links.length}; self: ${output.selfId}`);
