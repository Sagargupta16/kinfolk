/**
 * Layout via ELK's layered algorithm.
 *
 * Hand-rolled generation-band layout breaks the moment the data is real:
 * cousins marry, adoptions cross generations, and a "depth" integer stops
 * existing. ELK solves layer assignment as a graph problem, so those cases
 * degrade gracefully instead of overlapping nodes.
 *
 * Union nodes are sized near-zero so they read as a junction dot rather than a
 * box, which is what makes a couple look like a couple.
 */
import type { FlowEdge, FlowNode } from "./graph";

/**
 * How much of a person is drawn.
 *
 * Progressive disclosure, and the reason it reaches the LAYOUT rather than only
 * the card: shrinking a card in CSS alone leaves ELK reserving the full 200x92,
 * so a tree of dots would keep card-sized gaps and none of the promised overview.
 * The whole point of collapsing to a dot is that the shape of the family fits on
 * one screen, which only happens if the spacing collapses with it.
 *
 *   full    -- the archive card: name, dates, provenance, channels
 *   compact -- name and dates, for reading a wide tree
 *   dot     -- a node, for seeing the shape of a large one
 */
export type Lod = "full" | "compact" | "dot";

type Metrics = {
	width: number;
	height: number;
	/** elk.spacing.nodeNode: horizontal gap within a generation. */
	gap: number;
	/** elk.layered.spacing.nodeNodeBetweenLayers: gap between generations. */
	rowGap: number;
};

/**
 * Gaps shrink faster than the cards do.
 *
 * Scaling spacing in proportion to the node would keep the tree exactly as wide
 * in screen terms and collapse would buy nothing. These are tuned so each step
 * roughly halves the footprint.
 *
 * The full card is 168px, down from 200. Width here is not a style choice: the
 * widest generation in the sample tree holds 45 people, so every pixel of pitch is
 * multiplied by 45 and the card width alone decided the canvas was 10760px across.
 * 168 is what the content actually needs -- the p90 name is 15 characters and the
 * longest kinship term ("second cousin once removed") is 26 at 12px mono, both of
 * which fit -- and it is the same width `compact` already used, so the widest thing
 * this tree ever draws was already proven readable at it.
 */
export const NODE_METRICS: Record<Lod, Metrics> = {
	// 92, not 78, and the number is measured rather than chosen: with the kinship term
	// allowed two lines, the card's own content boxes to 92px for the longest term the
	// walk can produce ("great-great-uncle by marriage"). ELK reserves this box, so a card
	// that needs more than it says either overflows its own border or overlaps a
	// neighbour.
	full: { width: 168, height: 92, gap: 32, rowGap: 72 },
	compact: { width: 148, height: 40, gap: 22, rowGap: 48 },
	/*
	 * 56x34, not 16x16, because the dot now carries a first name under it.
	 *
	 * A nameless dot showed the SHAPE of a family and nothing else -- you could see the graph
	 * but not read it, so finding anybody meant going back to cards and losing the overview.
	 * A first name is what fits: measured across all 117 people at 9px mono, a first name needs
	 * 45px at p90 and 51px at the widest, where a FULL name needs 84px and would make this level
	 * nearly as wide as the compact row it exists to be smaller than.
	 *
	 * The gap is 30, not 18. 18 was reasoned from the reserved width containing the label,
	 * which is true and not sufficient: at 56px wide the three gap tiers computed to 20/35/79
	 * against a 56px card, so a partner gap was a third of a card and the whole row read as
	 * one continuous strip of dots with no groupings visible at all. The tiers are ratios of
	 * this number, so the overview level needs the gap that makes THEM legible, not the one
	 * that merely stops labels touching.
	 */
	dot: { width: 56, height: 34, gap: 30, rowGap: 44 },
};

export const PERSON_WIDTH = NODE_METRICS.full.width;
export const PERSON_HEIGHT = NODE_METRICS.full.height;
const UNION_SIZE = 12;

export type PositionedNode = FlowNode & {
	position: { x: number; y: number };
	width: number;
	height: number;
};

/**
 * A horizontal band holding one generation.
 *
 * Derived from the laid-out person rows rather than from a depth counter, because
 * after ELK runs the y coordinate IS the generation -- and a counter would have to
 * re-answer the question ELK just solved, differently, for cousin marriages and
 * cross-generation adoptions.
 */
export type GenerationBand = {
	/** Row centre, for placing the label. */
	y: number;
	top: number;
	bottom: number;
	left: number;
	right: number;
	/** How many people sit in this band. */
	count: number;
};

export type LayoutResult = {
	nodes: PositionedNode[];
	bands: GenerationBand[];
	/** The box every node fits inside. See `graphExtent`. */
	extent: Box;
};

/** Exported for the minimap, which shapes its own panel from the graph extent. */
export type Box = { x: number; y: number; width: number; height: number };

/**
 * The box the whole laid-out graph occupies.
 *
 * Returned with the layout because layout is the only thing that knows it: the
 * numbers are the positions it just assigned, and any consumer recomputing them
 * would either duplicate the sizing table or read measured DOM boxes that do not
 * exist until React Flow has painted.
 *
 * The overview minimap needs it to choose its own aspect ratio, and that has to be
 * derived rather than picked: this tree measures 10760x1137 as cards (9.5:1) and
 * 1512x488 as dots (3.1:1), so one fixed box would spend most of its area on empty
 * space at whichever level it was not tuned for.
 */
export function graphExtent(nodes: PositionedNode[]): Box {
	if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;

	// Every node, union dots included -- unlike generation bands, which are about
	// people. A dot is drawn, so a box that excluded it would clip the canvas.
	for (const node of nodes) {
		left = Math.min(left, node.position.x);
		top = Math.min(top, node.position.y);
		right = Math.max(right, node.position.x + node.width);
		bottom = Math.max(bottom, node.position.y + node.height);
	}

	return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * ELK ships as a bundled worker-less build; importing it lazily keeps it out of
 * the initial page payload since layout only runs once the graph is loaded.
 */
async function loadElk() {
	const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
	return new ELK();
}

/**
 * Turn partner equality and parentage direction into placement invariants.
 *
 * ELK receives union edges as ordinary directed edges. That is useful for finding a
 * readable x order, but it cannot express that partners are peers: a childless union is
 * literally person -> person, and a remarriage chain can pull partners onto different
 * layers. This pass keeps ELK's crossing-minimised x order, then applies pedigree
 * semantics to y and resolves each row as contiguous household groups.
 */
function alignPedigreeRows(
	nodes: FlowNode[],
	edges: FlowEdge[],
	positions: Map<string, Box>,
	metrics: Metrics,
): void {
	const people = new Set(nodes.filter((node) => node.type === "person").map((node) => node.id));
	const unions = new Set(nodes.filter((node) => node.type === "union").map((node) => node.id));
	const parent = new Map([...people].map((id) => [id, id]));

	const root = (id: string): string => {
		const next = parent.get(id);
		if (!next || next === id) return id;
		const resolved = root(next);
		parent.set(id, resolved);
		return resolved;
	};
	const join = (left: string, right: string) => {
		const a = root(left);
		const b = root(right);
		if (a === b) return;
		// Stable representative: input order must not change the household identity.
		if (a.localeCompare(b) <= 0) parent.set(b, a);
		else parent.set(a, b);
	};

	const partnersByUnion = new Map<string, string[]>();
	const partneredPeople = new Set<string>();
	for (const edge of edges) {
		if (!edge.layout || edge.kind !== "partner" || !people.has(edge.source)) continue;
		partneredPeople.add(edge.source);

		if (unions.has(edge.target)) {
			const partners = partnersByUnion.get(edge.target);
			if (partners) partners.push(edge.source);
			else partnersByUnion.set(edge.target, [edge.source]);
			continue;
		}

		// A childless partnership is projected directly from person to person.
		if (people.has(edge.target)) {
			partneredPeople.add(edge.target);
			join(edge.source, edge.target);
		}
	}
	for (const partners of partnersByUnion.values()) {
		for (let index = 1; index < partners.length; index += 1) {
			const first = partners[0];
			const partner = partners[index];
			if (first && partner) join(first, partner);
		}
	}

	const householdOf = new Map([...people].map((id) => [id, root(id)]));
	const members = new Map<string, string[]>();
	for (const id of people) {
		const household = householdOf.get(id) ?? id;
		const existing = members.get(household);
		if (existing) existing.push(id);
		else members.set(household, [id]);
	}

	const outgoing = new Map<string, Set<string>>();
	const structured = new Set<string>();
	for (const id of partneredPeople) structured.add(householdOf.get(id) ?? id);

	for (const edge of edges) {
		if (!edge.layout || edge.kind !== "child" || !people.has(edge.target)) continue;
		const childHousehold = householdOf.get(edge.target) ?? edge.target;
		for (const partnerId of partnersByUnion.get(edge.source) ?? []) {
			const parentHousehold = householdOf.get(partnerId) ?? partnerId;
			structured.add(parentHousehold);
			structured.add(childHousehold);
			// Partnering an ancestor is contradictory: equality and strict descent cannot
			// both be drawn. Keep the household intact and skip only the impossible rank edge.
			if (parentHousehold === childHousehold) continue;
			const targets = outgoing.get(parentHousehold);
			if (targets) targets.add(childHousehold);
			else outgoing.set(parentHousehold, new Set([childHousehold]));
		}
	}
	if (structured.size === 0) return;

	const indegree = new Map([...structured].map((id) => [id, 0]));
	for (const targets of outgoing.values()) {
		for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
	}

	const ranks = new Map([...structured].map((id) => [id, 0]));
	const queue = [...structured]
		.filter((id) => (indegree.get(id) ?? 0) === 0)
		.sort((a, b) => a.localeCompare(b));
	const placed = new Set<string>();
	while (queue.length > 0) {
		const household = queue.shift();
		if (!household) break;
		placed.add(household);
		for (const target of [...(outgoing.get(household) ?? [])].sort((a, b) => a.localeCompare(b))) {
			ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(household) ?? 0) + 1));
			const next = (indegree.get(target) ?? 0) - 1;
			indegree.set(target, next);
			if (next === 0) queue.push(target);
		}
		queue.sort((a, b) => a.localeCompare(b));
	}

	const structuredBoxes = [...structured].flatMap((household) =>
		(members.get(household) ?? []).flatMap((id) => {
			const box = positions.get(id);
			return box ? [box] : [];
		}),
	);
	const baseY = Math.min(...structuredBoxes.map((box) => box.y));
	const pitch = metrics.height + metrics.rowGap;

	// A household-cycle is invalid pedigree data, but the renderer must still be total.
	// Keep cyclic components near ELK's row while all satisfiable components use the DAG rank.
	for (const household of structured) {
		if (!placed.has(household)) {
			const boxes = (members.get(household) ?? [])
				.map((id) => positions.get(id))
				.filter((box): box is Box => Boolean(box));
			const averageY = boxes.reduce((sum, box) => sum + box.y, 0) / Math.max(boxes.length, 1);
			ranks.set(household, Math.max(0, Math.round((averageY - baseY) / pitch)));
		}
		for (const id of members.get(household) ?? []) {
			const box = positions.get(id);
			if (box) box.y = baseY + (ranks.get(household) ?? 0) * pitch;
		}
	}

	/**
	 * Which union each household descends FROM.
	 *
	 * Two readers: sibling blocks are grouped by it, and the family-boundary gap is applied
	 * where it changes. A household is keyed by its union-find representative and a couple
	 * has two members who may descend from different parents, so this records the union of
	 * whichever member has one, preferring the lower id for determinism. Absent for a
	 * household whose parents are not in the graph, and both readers treat absence as "no
	 * known family" rather than guessing.
	 */
	const parentUnionOf = new Map<string, string>();
	for (const edge of edges) {
		if (!edge.layout || edge.kind !== "child" || !people.has(edge.target)) continue;
		const household = householdOf.get(edge.target) ?? edge.target;
		const existing = parentUnionOf.get(household);
		if (!existing || edge.source.localeCompare(existing) < 0) {
			parentUnionOf.set(household, edge.source);
		}
	}

	// Preserve ELK's left-to-right solution, but make each partner component contiguous.
	// A larger gap between households makes the smaller partner gap read as grouping.
	const preferredX = new Map([...people].map((id) => [id, positions.get(id)?.x ?? 0] as const));
	const rows = new Map<number, string[]>();
	for (const household of structured) {
		for (const id of members.get(household) ?? []) {
			const box = positions.get(id);
			if (!box) continue;
			const row = rows.get(box.y);
			if (row) row.push(id);
			else rows.set(box.y, [id]);
		}
	}

	// A junction needs its 12px box plus 4px clearance on both sides. Keep two
	// additional pixels so exact blocker boundaries do not collapse to a zero-width gap.
	const partnerGap = Math.max(UNION_SIZE + 10, Math.round(metrics.gap * 0.65));
	const householdGap = Math.max(partnerGap + 8, Math.round(metrics.gap * 1.75));
	/**
	 * The gap at a family boundary: where the person to the left and the person to the
	 * right descend from different parents.
	 *
	 * Three tiers rather than two, and the ratio is what does the work: at 22 / 56 / 140
	 * each step is roughly 2.5x the last, so the eye groups on the largest gap first and a
	 * sibling set reads as a unit before any line is followed. Two tiers cannot express
	 * this -- a couple and a family boundary both landing on 56px is why fourteen people
	 * in one row read as undifferentiated.
	 */
	const siblingGroupGap = Math.max(householdGap + 16, Math.round(metrics.gap * 4.4));

	/** Children of each household, through the unions its members partner in. */
	const childrenOf = new Map<string, Set<string>>();
	for (const edge of edges) {
		if (!edge.layout || edge.kind !== "child" || !people.has(edge.target)) continue;
		for (const partnerId of partnersByUnion.get(edge.source) ?? []) {
			const household = householdOf.get(partnerId) ?? partnerId;
			const kids = childrenOf.get(household);
			if (kids) kids.add(edge.target);
			else childrenOf.set(household, new Set([edge.target]));
		}
	}

	/*
	 * Rows are packed DEEPEST FIRST, so a generation is placed over children that are
	 * already final.
	 *
	 * This ordering is the whole fix. Packing each row independently -- which is what it did
	 * before -- centres every row on its own ELK extent and discards the parent-over-children
	 * alignment ELK had found: measured on a real 40-person graph, ELK had a couple an average
	 * 169px from their children's midpoint and independent packing pushed that to 449px, one
	 * couple 1131px out, and the viewer's own parents 807px right of him and his sisters.
	 * Nothing in the picture explains that drift, so it reads as a rendering fault.
	 *
	 * Bottom-up cannot have that problem: when a block is placed its target is settled. The
	 * reverse order would centre a couple over children that then slide away.
	 */
	const rowsDeepestFirst = [...rows.entries()].sort(([a], [b]) => b - a);

	for (const [, ids] of rowsDeepestFirst) {
		const groups = new Map<string, string[]>();
		for (const id of ids) {
			const household = householdOf.get(id) ?? id;
			const group = groups.get(household);
			if (group) group.push(id);
			else groups.set(household, [id]);
		}
		/*
		 * Siblings are kept CONTIGUOUS, and their shared parent union orders them as a block.
		 *
		 * ELK orders households by its own crossing-minimised x, which interleaves in-laws
		 * between siblings: measured on a real graph, Aditya Anand and Amit Sarogi (two
		 * sisters' husbands) sat between the four siblings, so the set spanned 1052px to hold
		 * 4 people and its midpoint landed on a man who is not their parents' child. A
		 * sibling bracket is the mark that says "these are one family", so a stranger inside
		 * its span makes it say something false -- and the inflated span is what pushed the
		 * family past MAX_BAR_SPAN and lost the bracket entirely.
		 *
		 * Grouping by parent union preserves ELK's relative order at both levels: sibling
		 * blocks sort by their mean ELK x, and households within a block do too. So this is
		 * a regrouping of ELK's answer, not a replacement for it.
		 */
		const blocks = new Map<string, { households: string[]; centre: number }>();
		for (const [household, group] of groups.entries()) {
			// Households whose parents are absent each form their own block, keyed on
			// themselves, so they are never merged with an unrelated family.
			const key = parentUnionOf.get(household) ?? `solo:${household}`;
			const centre = group.reduce((sum, id) => sum + (preferredX.get(id) ?? 0), 0) / group.length;
			const block = blocks.get(key);
			if (block) {
				block.households.push(household);
				block.centre = Math.min(block.centre, centre);
			} else {
				blocks.set(key, { households: [household], centre });
			}
		}

		const householdCentre = (household: string): number => {
			const group = groups.get(household) ?? [];
			if (group.length === 0) return 0;
			return group.reduce((sum, id) => sum + (preferredX.get(id) ?? 0), 0) / group.length;
		};

		const ordered = [...blocks.entries()]
			.sort((a, b) => a[1].centre - b[1].centre || a[0].localeCompare(b[0]))
			.flatMap(([, block]) =>
				[...block.households]
					.sort((a, b) => householdCentre(a) - householdCentre(b) || a.localeCompare(b))
					.map((household) => ({
						household,
						ids: (groups.get(household) ?? []).sort(
							(a, b) => (preferredX.get(a) ?? 0) - (preferredX.get(b) ?? 0) || a.localeCompare(b),
						),
					})),
			);

		const originalLeft = Math.min(...ids.map((id) => preferredX.get(id) ?? 0));
		const originalRight = Math.max(
			...ids.map((id) => (preferredX.get(id) ?? 0) + (positions.get(id)?.width ?? metrics.width)),
		);

		const width = (group: { ids: string[] }): number =>
			group.ids.reduce((sum, id) => sum + (positions.get(id)?.width ?? metrics.width), 0) +
			Math.max(0, group.ids.length - 1) * partnerGap;

		/*
		 * Each household is given the x it WANTS -- centred over its own children -- and the row
		 * is then swept to enforce the minimum gaps. The row STRETCHES rather than packing tight.
		 *
		 * Packing at minimum gaps and nudging afterwards cannot work, and the numbers say why:
		 * on a real graph the parent row packed to 3761px while the children it had to reach
		 * spanned 5541px, 1.47x wider. Every couple in the middle then had 56px of slack against
		 * a 1445px journey, so the clamp pinned them all and only the two outermost families
		 * lined up. A generation is as wide as its descendants make it -- so the gap tiers are a
		 * FLOOR, not a target, and the extra width belongs in the gaps between families where it
		 * reinforces the grouping rather than fighting it.
		 *
		 * Households with no children keep their ELK offset relative to the row, so a childless
		 * couple stays where the crossing-minimised order put them instead of collapsing left.
		 */
		const desired = ordered.map((group) => {
			const kids = [...(childrenOf.get(group.household) ?? [])]
				.map((id) => positions.get(id))
				.filter((box): box is Box => Boolean(box));
			if (kids.length === 0) return null;
			const centre =
				(Math.min(...kids.map((box) => box.x)) +
					Math.max(...kids.map((box) => box.x + box.width))) /
				2;
			return centre - width(group) / 2;
		});

		// Anchor for the childless: ELK's own x, shifted so the row as a whole sits under the
		// families that do have children.
		const anchoredIndices = desired.flatMap((x, index) => (x === null ? [] : [index]));
		let drift = 0;
		if (anchoredIndices.length > 0) {
			let total = 0;
			for (const index of anchoredIndices) {
				const group = ordered[index];
				const target = desired[index];
				if (!group || target === null || target === undefined) continue;
				total += target - (preferredX.get(group.ids[0] ?? "") ?? 0);
			}
			drift = total / anchoredIndices.length;
		} else {
			drift = (originalLeft + originalRight) / 2 - (originalLeft + originalRight) / 2;
		}

		const wantedFor = new Map(
			ordered.map((group, index) => {
				const target = desired[index];
				if (target !== null && target !== undefined) return [group.household, target] as const;
				return [group.household, (preferredX.get(group.ids[0] ?? "") ?? 0) + drift] as const;
			}),
		);

		/*
		 * The row is RE-ORDERED to follow its children before any gap is enforced.
		 *
		 * This is the half the first attempt got wrong. Households were ordered by ELK's x while
		 * their wanted positions came from the children below, and those two orderings disagree:
		 * on the sample tree a couple sat at x=8098 whose own children were at x=5929, 2100px to
		 * their LEFT. A left-to-right sweep that only ever pushes RIGHT then pinned them -- and
		 * every household in the same situation -- so 16 of 34 couples stayed misaligned while
		 * the offline arithmetic reported success, because it measured the intent rather than the
		 * result.
		 *
		 * Ordering by the children is also the correct pedigree rule, not merely a fix: the row
		 * below is already final (bottom-up), so if family A's children sit left of family B's,
		 * then A belongs left of B. Sibling blocks keep their contiguity because cousins are
		 * adjacent in the row below, so following the children preserves the grouping rather than
		 * competing with it.
		 */
		const laidOut = [...ordered].sort((a, b) => {
			const ax = wantedFor.get(a.household) ?? 0;
			const bx = wantedFor.get(b.household) ?? 0;
			return ax - bx || a.household.localeCompare(b.household);
		});

		/*
		 * Households that are SIBLINGS of each other get a wider gap than unrelated neighbours,
		 * so a big family reads as one block rather than as a run of pairs.
		 *
		 * Without this, a row of fourteen aunts, uncles and their spouses is a uniform strip: the
		 * 22/56 partner/household rhythm says which two people are married but nothing says where
		 * one set of siblings ends. Seven couples then look like one enormous family, which is
		 * exactly the "whose child is whose" complaint. The boundary is where the parent union
		 * changes, and that is a fact already in the data rather than a heuristic on positions.
		 */
		const gapAt = (index: number): number => {
			if (index <= 0) return 0;
			const current = laidOut[index];
			const previous = laidOut[index - 1];
			if (!current || !previous) return householdGap;
			const a = parentUnionOf.get(previous.household);
			const b = parentUnionOf.get(current.household);
			// Both sides descend from a KNOWN and different union: a real family boundary.
			if (a && b && a !== b) return siblingGroupGap;
			return householdGap;
		};

		/*
		 * Relaxation rather than a single sweep, because a household may need to move EITHER way.
		 *
		 * Each pass moves every household towards its wanted x, clamped by where its neighbours
		 * now sit. Repeated, this settles into the arrangement closest to every wanted position
		 * that still satisfies the gaps -- and unlike a one-directional sweep it has no bias, so
		 * a family whose children are to the left is not pushed away from them. Four passes: the
		 * displacement roughly halves each time and the residual is under a pixel on real graphs.
		 */
		const slots = laidOut.map((group) => ({
			group,
			width: width(group),
			x: wantedFor.get(group.household) ?? 0,
		}));

		for (let pass = 0; pass < 4; pass += 1) {
			for (const [index, slot] of slots.entries()) {
				const previous = slots[index - 1];
				const next = slots[index + 1];
				const low = previous ? previous.x + previous.width + gapAt(index) : -Infinity;
				const high = next ? next.x - gapAt(index + 1) - slot.width : Infinity;
				const target = wantedFor.get(slot.group.household) ?? slot.x;
				// A row too tight to honour both bounds keeps the left one: overlapping cards are
				// a broken canvas, where an imperfectly centred parent is only a cosmetic loss.
				slot.x = low > high ? low : Math.min(Math.max(target, low), high);
			}
		}

		for (const slot of slots) {
			let x = slot.x;
			for (const [memberIndex, id] of slot.group.ids.entries()) {
				if (memberIndex > 0) x += partnerGap;
				const box = positions.get(id);
				if (!box) continue;
				box.x = x;
				x += box.width;
			}
		}
	}
}

export async function layoutGraph(
	nodes: FlowNode[],
	edges: FlowEdge[],
	lod: Lod = "full",
): Promise<LayoutResult> {
	if (nodes.length === 0)
		return { nodes: [], bands: [], extent: { x: 0, y: 0, width: 0, height: 0 } };

	const elk = await loadElk();
	const metrics = NODE_METRICS[lod];

	const graph = {
		id: "root",
		layoutOptions: {
			"elk.algorithm": "layered",
			// Generations read top-to-bottom, the convention every family tree uses.
			"elk.direction": "DOWN",
			"elk.layered.spacing.nodeNodeBetweenLayers": String(metrics.rowGap),
			"elk.spacing.nodeNode": String(metrics.gap),
			// Keeps siblings in the order they were entered rather than reshuffling
			// them on every reload.
			"elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
			"elk.layered.crossingMinimization.semiInteractive": "true",
			"elk.edgeRouting": "ORTHOGONAL",
			// Centres a couple over their children instead of over their edge bundle.
			//
			// ELK's default is Brandes-Koepf, which optimises for straight edges and on
			// this tree parked the founding couple 4916px LEFT of the graph centre: the
			// top of a family tree hanging off the far edge, which is exactly the
			// "sideways" complaint. Measured across all five strategies on the sample
			// tree (34 unions), the average distance from a union dot to the midpoint of
			// its own children:
			//
			//   BRANDES_KOEPF (default)  465px      root offset -4916
			//   NETWORK_SIMPLEX          171px      root offset   +129
			//   LINEAR_SEGMENTS          142px      root offset   +987
			//   SIMPLE                  1953px      root offset      0
			//
			// LINEAR_SEGMENTS centres children marginally better but drifts the root
			// eight times further, and the root is the one node a viewer looks for first.
			// SIMPLE centres every band perfectly by ignoring edges entirely, which costs
			// 420px of height in crossings and reads as a stack of unrelated rows.
			"elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
		},
		children: nodes.map((node) => ({
			id: node.id,
			width: node.type === "union" ? UNION_SIZE : metrics.width,
			height: node.type === "union" ? UNION_SIZE : metrics.height,
		})),
		// Only hierarchical edges. A friendship or a cousinhood carries no
		// generation, so including it here would pull that person into a lower
		// layer and misrepresent the family. Those edges are drawn as an overlay
		// on top of the family layout instead.
		edges: edges
			.filter((edge) => edge.layout)
			.map((edge) => ({
				id: edge.id,
				sources: [edge.source],
				targets: [edge.target],
			})),
	};

	const laid = await elk.layout(graph);
	const positions = new Map<string, Box>(
		(laid.children ?? []).map((child) => [
			child.id as string,
			{ x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 },
		]),
	);

	alignPedigreeRows(nodes, edges, positions, metrics);
	anchorFamilylessNodes(nodes, edges, positions, metrics.gap);
	placeUnionJunctions(nodes, edges, positions);

	const positioned = nodes.map((node) => {
		const box = positions.get(node.id);
		return {
			...node,
			position: { x: box?.x ?? 0, y: box?.y ?? 0 },
			width: box?.width ?? metrics.width,
			height: box?.height ?? metrics.height,
		};
	});

	return {
		nodes: positioned,
		bands: generationBands(positioned, metrics.height),
		extent: graphExtent(positioned),
	};
}

/**
 * Group the laid-out people into horizontal bands, one per generation.
 *
 * Person nodes only: union dots sit BETWEEN rows, so including them would invent
 * half-generations. Rows are keyed on the y ELK assigned, which is already
 * uniform within a layer.
 */
function generationBands(nodes: PositionedNode[], personHeight: number): GenerationBand[] {
	const rows = new Map<number, PositionedNode[]>();

	for (const node of nodes) {
		if (node.type !== "person") continue;
		const existing = rows.get(node.position.y);
		if (existing) existing.push(node);
		else rows.set(node.position.y, [node]);
	}

	return [...rows.entries()]
		.sort(([a], [b]) => a - b)
		.map(([y, members]) => ({
			y: y + personHeight / 2,
			top: y,
			bottom: y + Math.max(...members.map((m) => m.height)),
			left: Math.min(...members.map((m) => m.position.x)),
			right: Math.max(...members.map((m) => m.position.x + m.width)),
			count: members.length,
		}));
}

/**
 * Put each union junction where the marriage line runs.
 *
 * ELK places the junction as an ordinary node in the gap between generations, to
 * minimise edge crossings -- the right objective for a layered graph and the wrong
 * position for a marriage. The convention every hand-drawn pedigree uses is a
 * horizontal line joining the couple at mid-card height with the children
 * descending from its midpoint, so a couple's junction is moved ONTO that line:
 * x at the couple's midpoint, y at the partners' mid-card height. The partner
 * edges then draw the line itself (see `partnerPath`), and the child drop leaves
 * from between the couple -- one stem, through the gutter the two cards share.
 *
 * A SINGLE-parent union keeps ELK's y in the generation gap and is centred under
 * its one parent instead: there is no couple to run a line between, and the
 * honest picture is the classic straight drop from parent to children. It also
 * cannot sit at mid-card height, because union nodes paint above cards and a
 * bead on somebody's face is not a junction.
 *
 * A post-layout nudge rather than an ELK constraint, for the same reason
 * `siblingBars` is computed afterwards: the skeleton must not shift for
 * cosmetics, and moving a 12x12 dot cannot introduce an overlap that matters.
 *
 * Where the couple's midpoint and the children's midpoint disagree, this prefers
 * the COUPLE. The junction's job is to say "these two are partners"; the bracket
 * below already says which children are theirs, and it spans the children's own
 * extent independently.
 */
function placeUnionJunctions(
	nodes: FlowNode[],
	edges: FlowEdge[],
	positions: Map<string, Box>,
): void {
	/** Partners per union node id. */
	const partners = new Map<string, string[]>();
	for (const edge of edges) {
		if (!edge.layout || edge.kind !== "partner") continue;
		const existing = partners.get(edge.target);
		if (existing) existing.push(edge.source);
		else partners.set(edge.target, [edge.source]);
	}

	const personBoxes = nodes.flatMap((node) => {
		if (node.type !== "person") return [];
		const box = positions.get(node.id);
		return box ? [{ id: node.id, box }] : [];
	});

	for (const node of nodes) {
		if (node.type !== "union") continue;
		const dot = positions.get(node.id);
		if (!dot) continue;

		const partnerBoxes = (partners.get(node.id) ?? []).flatMap((id) => {
			const box = positions.get(id);
			return box ? [{ id, box }] : [];
		});
		const boxes = partnerBoxes.map(({ box }) => box);
		if (boxes.length === 0) continue;

		const centres = boxes.map((box) => box.x + box.width / 2);
		const childTops = edges
			.filter((edge) => edge.layout && edge.kind === "child" && edge.source === node.id)
			.map((edge) => positions.get(edge.target)?.y)
			.filter((top): top is number => top !== undefined);
		const parentBottom = Math.max(...boxes.map((box) => box.y + box.height));
		const childTop = childTops.length > 0 ? Math.min(...childTops) : null;
		const generationGapY =
			childTop !== null && childTop > parentBottom
				? parentBottom + (childTop - parentBottom - dot.height) / 2
				: null;

		// One parent on the canvas (a single parent, or the other partner sits in a
		// tree the viewer cannot see): centre the junction under them so the drop to
		// the children is a straight vertical line.
		if (boxes.length === 1) {
			const onlyBox = boxes[0];
			if (!onlyBox) continue;
			dot.x = onlyBox.x + onlyBox.width / 2 - dot.width / 2;
			if (generationGapY !== null) dot.y = generationGapY;
			continue;
		}

		const midX = (Math.min(...centres) + Math.max(...centres)) / 2;
		// Mid-card height, averaged so a cross-generation couple gets a rail between
		// their two rows rather than through either of them.
		const railY = boxes.reduce((sum, box) => sum + box.y + box.height / 2, 0) / boxes.length;

		/*
		 * The bead must land in a GUTTER, never on a card.
		 *
		 * The couple's midpoint is only clear space when the partners are adjacent.
		 * With somebody laid out between them (a remarriage chain, a fused graph),
		 * the midpoint is the middle of that person's card. Find the nearest clear
		 * point, then prove both partner-to-bead segments avoid every other card.
		 * If endpoint adjacency is impossible, route the marriage through the empty
		 * generation lane instead of drawing a horizontal line through a person.
		 */
		const clearance = dot.width / 2 + 4;
		const blockers = personBoxes
			.filter(({ box }) => railY >= box.y && railY <= box.y + box.height)
			.map(({ box }) => ({
				start: box.x - clearance,
				end: box.x + box.width + clearance,
			}));
		const beadX = nearestClearPoint(midX, Math.min(...centres), Math.max(...centres), blockers);
		const crossesCard =
			beadX !== null &&
			partnerBoxes.some(({ id, box }) => {
				const sourceX = box.x + box.width / 2;
				const left = Math.min(sourceX, beadX) + 0.5;
				const right = Math.max(sourceX, beadX) - 0.5;
				return personBoxes.some(
					(person) =>
						person.id !== id &&
						railY >= person.box.y &&
						railY <= person.box.y + person.box.height &&
						person.box.x < right &&
						person.box.x + person.box.width > left,
				);
			});
		if (beadX === null || crossesCard) {
			dot.x = midX - dot.width / 2;
			if (generationGapY !== null) dot.y = generationGapY;
			continue;
		}

		dot.x = beadX - dot.width / 2;
		dot.y = railY - dot.height / 2;
	}
}

/**
 * The point nearest `target` inside [lo, hi] that no blocker covers, or null.
 *
 * Blockers are merged first, so two touching cards read as one wall rather than
 * as a zero-width gap between them. The partners' own cards are always blockers
 * (their centres are inside them), which is what pushes the answer into the
 * gutter between the couple instead of onto either of them.
 */
function nearestClearPoint(
	target: number,
	lo: number,
	hi: number,
	blockers: Array<{ start: number; end: number }>,
): number | null {
	const sorted = [...blockers].sort((a, b) => a.start - b.start);
	const merged: Array<{ start: number; end: number }> = [];
	for (const blocker of sorted) {
		const last = merged[merged.length - 1];
		if (last && blocker.start <= last.end) last.end = Math.max(last.end, blocker.end);
		else merged.push({ ...blocker });
	}

	const gaps: Array<{ start: number; end: number }> = [];
	let cursor = lo;
	for (const wall of merged) {
		if (wall.end <= lo) continue;
		if (wall.start >= hi) break;
		if (wall.start > cursor) gaps.push({ start: cursor, end: Math.min(wall.start, hi) });
		cursor = Math.max(cursor, wall.end);
		if (cursor >= hi) break;
	}
	if (cursor < hi) gaps.push({ start: cursor, end: hi });

	let best: number | null = null;
	for (const gap of gaps) {
		if (gap.end - gap.start < 1) continue;
		const point = Math.min(Math.max(target, gap.start), gap.end);
		if (best === null || Math.abs(point - target) < Math.abs(best - target)) best = point;
	}
	return best;
}

/**
 * Place people who have no family edge beside somebody they actually know.
 *
 * ELK only saw hierarchical edges, so a friend with no parents and no partner is
 * an isolated node: it gets dropped into the first layer, which reads as "older
 * than the grandparents". That is worse than being unplaced, because the canvas
 * asserts a generation that does not exist.
 *
 * So they are positioned afterwards, to the right of their best-known contact
 * and on that person's row. This runs after layout rather than as an ELK
 * constraint on purpose: the family skeleton must not shift to accommodate a
 * friend, which is the invariant layout.test.ts pins down.
 */
function anchorFamilylessNodes(
	nodes: FlowNode[],
	edges: FlowEdge[],
	positions: Map<string, Box>,
	/** Matches elk.spacing.nodeNode, so anchored nodes sit on the same rhythm. */
	gap: number,
): void {
	const inFamily = new Set<string>();
	for (const edge of edges) {
		if (!edge.layout) continue;
		inFamily.add(edge.source);
		inFamily.add(edge.target);
	}

	const floating = nodes.filter((node) => !inFamily.has(node.id));
	if (floating.length === 0 || floating.length === nodes.length) return;

	// Anchor to whoever they know who is themselves anchored. Resolved in passes
	// so a friend-of-a-friend still lands somewhere sensible.
	const pending = new Set(floating.map((n) => n.id));
	// Rows fill left to right, so two friends of one person do not stack.
	const occupied = new Map<number, number>();
	for (const [id, box] of positions) {
		if (pending.has(id)) continue;
		occupied.set(box.y, Math.max(occupied.get(box.y) ?? 0, box.x + box.width));
	}

	let progressed = true;
	while (pending.size > 0 && progressed) {
		progressed = false;

		for (const id of [...pending]) {
			const anchorId = edges.find(
				(edge) =>
					!edge.layout &&
					((edge.source === id && !pending.has(edge.target)) ||
						(edge.target === id && !pending.has(edge.source))),
			);
			if (!anchorId) continue;

			const otherId = anchorId.source === id ? anchorId.target : anchorId.source;
			const anchor = positions.get(otherId);
			const box = positions.get(id);
			if (!anchor || !box) continue;

			const rowEnd = occupied.get(anchor.y) ?? anchor.x + anchor.width;
			box.x = rowEnd + gap;
			box.y = anchor.y;
			occupied.set(anchor.y, box.x + box.width);
			pending.delete(id);
			progressed = true;
		}
	}

	// Household alignment can move a family onto an isolated person's ELK box.
	// With no anchored contact, retain their row and move only if that box now
	// collides. Check vertical extents because their row need not match a family row.
	const placed = [...positions].filter(([id]) => !pending.has(id)).map(([, box]) => box);
	for (const id of pending) {
		const box = positions.get(id);
		if (!box) continue;
		const row = placed.filter(
			(other) => box.y < other.y + other.height && box.y + box.height > other.y,
		);
		if (row.some((other) => box.x < other.x + other.width && box.x + box.width > other.x)) {
			box.x = Math.max(...row.map((other) => other.x + other.width)) + gap;
		}
		placed.push(box);
	}
}
