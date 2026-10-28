/**
 * The `+` controls around a card: what each one adds, and where it sits.
 *
 * The canvas is the editor. A card grows its family in the three directions the picture
 * already means -- a `+` ABOVE adds a parent, BESIDE adds a partner, BELOW adds a child --
 * so nobody has to learn the data model to record a grandmother. A couple shares ONE `+`
 * under the pair instead of one under each card: a child of a marriage is the couple's
 * child, and two buttons would invite recording the same daughter twice, once per parent.
 *
 * Pure, for the reason the planner is: which union a new child lands in is a claim about a
 * family, and the geometry decides whether a control covers somebody's name. Both are
 * things to assert rather than to squint at.
 *
 * Writes always target SOURCE rows. A card shows a fused person whose id is the smallest
 * member id, which on a merged person is the far family's row about half the time -- so the
 * caller resolves `editTarget` first and hands this module the row and unions it may write.
 */
import type { ParentRole, Sex } from "../db/schema";
import type { UnionWithChildren } from "./graph";
import type { KinRole } from "./kin-plan";
import type { Box } from "./layout";

/** What one `+` adds, as the add sheet needs it. */
export type AddTarget = {
	/** The source row the action writes against. */
	subjectId: string;
	/** Whose relative this is, named in the sheet's heading. */
	subjectName: string;
	direction: "parent" | "partner" | "child";
	/**
	 * The two roles the sheet offers, in display order.
	 *
	 * Always a gendered pair, so the button pressed IS the sex and no gender field exists.
	 * The order puts the likelier answer first -- a mother beside a recorded father -- but
	 * pressing Enter never picks one: a daughter saved as a son because Enter chose the first
	 * button is exactly the silent wrong fact this sheet must not produce.
	 */
	roles: [KinRole, KinRole];
	/** The union the new person joins, when it is already decided. */
	unionId?: string;
	/**
	 * Several families qualify (birth and adoptive, two single-parent families), so the sheet
	 * asks which -- with NOTHING pre-chosen. `planKin` refuses to pick one, and a default
	 * radio would quietly do exactly what it refuses to.
	 */
	choices?: { id: string; label: string }[];
};

/** Every `+` one person carries, before any geometry. */
export type NodeAffordances = {
	/** Absent once both parents are recorded: a third would have nowhere to go. */
	parent: AddTarget | null;
	partner: AddTarget;
	/** One shared `+` per couple the person is in, placed under the pair. */
	couples: { unionId: string; partnerSourceId: string; target: AddTarget }[];
	/**
	 * A `+` under the person's own card: their single-parent family, or a new one when they
	 * have no family at all. Present beside couples too -- a child recorded with one known
	 * parent is real data, and the couple's `+` would assert the spouse is the other parent.
	 */
	child: AddTarget | null;
};

/** The parent roles, the recorded parent's complement first. */
function parentRoles(existing: Sex | undefined): [KinRole, KinRole] {
	return existing === "male" ? ["mother", "father"] : ["father", "mother"];
}

/** The partner roles, the subject's complement first. */
function partnerRoles(subject: Sex): [KinRole, KinRole] {
	return subject === "female" ? ["husband", "wife"] : ["wife", "husband"];
}

const NON_BIOLOGICAL: Partial<Record<ParentRole, string>> = {
	adoptive: "adoptive",
	step: "step",
	foster: "foster",
	guardian: "guardian",
};

/**
 * What the person may grow, from the unions of the tree the viewer may write to.
 *
 * `people` maps a source id to its display name and sex, for headings, role order and
 * family labels. A union whose partner is missing from it still counts: the partner may be
 * folded away or simply unnamed, and the slot they occupy is real either way.
 */
export function nodeAffordances({
	subjectId,
	subjectName,
	subjectSex,
	unions,
	people,
}: {
	subjectId: string;
	subjectName: string;
	subjectSex: Sex;
	/** Source unions of the subject's own tree. */
	unions: UnionWithChildren[];
	people: Map<string, { name: string; sex: Sex }>;
}): NodeAffordances {
	const nameOf = (id: string | null) => (id ? (people.get(id)?.name ?? "Unknown") : null);
	const partnersOf = (union: UnionWithChildren, except?: string) =>
		[union.partnerAId, union.partnerBId]
			.filter((id): id is string => Boolean(id) && id !== except)
			.map((id) => nameOf(id) ?? "Unknown");

	/*
	 * A family label must tell the choices APART, which a list of partner names cannot always
	 * do: a parent with two single-parent families would see their own name twice. So a
	 * birth/adoptive choice names the parents and the subject's role in that family, and a
	 * single-parent choice names the children already in it.
	 */
	const childList = (ids: string[]) => {
		const kids = ids.map((id) => nameOf(id) ?? "Unknown");
		const shown = kids.slice(0, 3).join(", ");
		return kids.length > 3 ? `${shown} and ${kids.length - 3} more` : shown;
	};
	const parentFamilyLabel = (union: UnionWithChildren) => {
		const names = partnersOf(union).join(" and ") || "Parents not yet recorded";
		const role = (union.childRoles?.[subjectId] ?? []).map((r) => NON_BIOLOGICAL[r]).find(Boolean);
		const siblings = union.childIds.filter((id) => id !== subjectId);
		return [
			role ? `${names} (${role})` : names,
			siblings.length > 0 ? `with ${childList(siblings)}` : null,
		]
			.filter(Boolean)
			.join(", ");
	};
	const ownFamilyLabel = (union: UnionWithChildren) =>
		union.childIds.length === 0 ? "No children recorded yet" : `With ${childList(union.childIds)}`;
	/*
	 * Two different people can share a name -- two "Unknown" placeholders are ordinary in a
	 * half-recorded family -- and then even the facts above can match. A choice the reader
	 * cannot tell apart is a guess, so repeats are numbered in the order the families exist.
	 */
	const distinct = (choices: { id: string; label: string }[]) => {
		const seen = new Map<string, number>();
		return choices.map((choice) => {
			const count = (seen.get(choice.label) ?? 0) + 1;
			seen.set(choice.label, count);
			const repeats = choices.filter((other) => other.label === choice.label).length;
			return repeats > 1
				? { ...choice, label: `${choice.label} (${count} of ${repeats})` }
				: choice;
		});
	};

	/* -- Above: a parent ------------------------------------------------------ */

	const parentUnions = unions.filter((union) => union.childIds.includes(subjectId));
	const withRoom = parentUnions.filter((union) => !union.partnerAId || !union.partnerBId);
	let parent: AddTarget | null = null;
	if (parentUnions.length === 0 || withRoom.length > 0) {
		const only = withRoom.length === 1 ? withRoom[0] : undefined;
		const recorded = only?.partnerAId ?? only?.partnerBId ?? null;
		parent = {
			subjectId,
			subjectName,
			direction: "parent",
			roles: parentRoles(recorded ? people.get(recorded)?.sex : undefined),
			...(only ? { unionId: only.id } : {}),
			...(withRoom.length > 1
				? {
						choices: distinct(
							withRoom.map((union) => ({ id: union.id, label: parentFamilyLabel(union) })),
						),
					}
				: {}),
		};
	}

	/* -- Beside: a partner ---------------------------------------------------- */

	const partner: AddTarget = {
		subjectId,
		subjectName,
		direction: "partner",
		roles: partnerRoles(subjectSex),
	};

	/* -- Below: a child, shared by a couple ----------------------------------- */

	const own = unions.filter(
		(union) => union.partnerAId === subjectId || union.partnerBId === subjectId,
	);
	const couples = own.flatMap((union) => {
		const other = union.partnerAId === subjectId ? union.partnerBId : union.partnerAId;
		if (!other) return [];
		return [
			{
				unionId: union.id,
				partnerSourceId: other,
				target: {
					subjectId,
					// Both parents, because the child belongs to the couple and the heading should
					// say which couple -- after a remarriage it is the only thing telling them apart.
					subjectName: `${subjectName} and ${nameOf(other)}`,
					direction: "child" as const,
					roles: ["son", "daughter"] as [KinRole, KinRole],
					unionId: union.id,
				},
			},
		];
	});

	// Single-parent families are the subject's unions with nobody in the other slot.
	const singles = own.filter((union) => !union.partnerAId || !union.partnerBId);
	let child: AddTarget | null = null;
	if (singles.length > 0 || own.length === 0) {
		child = {
			subjectId,
			subjectName,
			direction: "child",
			roles: ["son", "daughter"],
			...(singles.length === 1 && singles[0] ? { unionId: singles[0].id } : {}),
			...(singles.length > 1
				? {
						choices: distinct(
							singles.map((union) => ({ id: union.id, label: ownFamilyLabel(union) })),
						),
					}
				: {}),
		};
	}

	return { parent, partner, couples, child };
}

/** Minimum touch target, in SCREEN pixels. */
export const HIT_TARGET = 44;

/**
 * Where the fold chevron's pill sits across a card's top and bottom edges, as a fraction of
 * the card width, and half the pill's own width. PersonNode places the chevron with the
 * same fraction; the `+` targets are sized so they never cover it.
 */
export const FOLD_AT = 0.16;
export const FOLD_PILL_HALF = 15;

/** Free space below which a card's side counts as occupied: a partner gutter, not a gap. */
const SIDE_MIN = 30;
/** Facing edges closer than this are an adjacent couple sharing a gutter. */
const ADJACENT = 40;

/** One placed `+`. Coordinates are the control's CENTRE, in flow space. */
export type AddSlot = {
	key: string;
	kind: "parent" | "partner" | "child" | "couple";
	target: AddTarget;
	x: number;
	y: number;
	/** Which edge a partner `+` sits on, so its target reaches outward. */
	side?: "left" | "right";
	/** How far a partner target may reach outward: a little less than the free space there. */
	reach?: number;
	/** The facing edges of an adjacent couple, which bound the shared `+`'s target. */
	gutter?: { left: number; right: number };
	/** The accessible name, which is also the tooltip. */
	label: string;
};

/**
 * Where each `+` sits around a laid-out card.
 *
 * On the card's EDGES, centred, because the edge is where the new relative will connect: a
 * parent's line arrives at the top centre, a child's leaves from the bottom centre, and the
 * marriage line runs out of the side at mid-height. An adjacent couple's shared `+` sits in
 * the gutter between the two cards, on the drop line a child will hang from. A couple that
 * is NOT side by side draws its line through the generation lane, so its `+` goes on that
 * lane -- at the junction when there is one -- rather than on the bottom edge of whoever
 * stands between them, where it would read as that person's.
 *
 * Which sides are free comes from the LAID-OUT row (`free`), not from the unions alone: in
 * a combined view a spouse recorded only by the linked family sits in the partner gutter
 * without being in this tree's unions, and a `+` drawn there would sit on their marriage
 * line. With no free side the partner control is left out.
 */
export function addSlots(
	affordances: NodeAffordances,
	box: Box,
	geometry: {
		boxOf: (sourceId: string) => Box | undefined;
		junctionOf: (unionId: string) => Box | undefined;
		/** Free space from each side of the card to the nearest other card on its row. */
		free: { left: number; right: number };
		/** The default outward reach of a side target, before the free space clamps it. */
		reach: number;
		/** The gap between generations, for the lane a non-adjacent couple's line runs in. */
		rowGap: number;
	},
): AddSlot[] {
	const { boxOf, junctionOf, free, reach, rowGap } = geometry;
	const slots: AddSlot[] = [];
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	const bottom = box.y + box.height;

	if (affordances.parent) {
		slots.push({
			key: "parent",
			kind: "parent",
			target: affordances.parent,
			x: cx,
			y: box.y,
			label: `Add a parent of ${affordances.parent.subjectName}`,
		});
	}

	const partnerBoxes = affordances.couples
		.map((couple) => boxOf(couple.partnerSourceId))
		.filter((partner): partner is Box => Boolean(partner) && partner?.y === box.y);
	const rightFree = free.right >= SIDE_MIN && !partnerBoxes.some((partner) => partner.x > box.x);
	const leftFree = free.left >= SIDE_MIN && !partnerBoxes.some((partner) => partner.x < box.x);
	if (rightFree || leftFree) {
		const right = rightFree;
		slots.push({
			key: "partner",
			kind: "partner",
			target: affordances.partner,
			x: right ? box.x + box.width : box.x,
			y: cy,
			side: right ? "right" : "left",
			reach: Math.max(0, Math.min(reach, (right ? free.right : free.left) - 6)),
			label: `Add a partner of ${affordances.partner.subjectName}`,
		});
	}

	for (const couple of affordances.couples) {
		const partner = boxOf(couple.partnerSourceId);
		const junction = junctionOf(couple.unionId);
		let slot: Pick<AddSlot, "x" | "y" | "gutter">;
		const [left, right] =
			partner && partner.x < box.x ? [partner, box] : [box, partner ?? undefined];
		const facing = left && right ? right.x - (left.x + left.width) : Number.POSITIVE_INFINITY;
		if (partner && partner.y === box.y && facing >= 0 && facing <= ADJACENT && left && right) {
			// Side by side: the gutter they share, on the drop line a child hangs from.
			const gutter = { left: left.x + left.width, right: right.x };
			slot = {
				x: junction ? junction.x + junction.width / 2 : (gutter.left + gutter.right) / 2,
				y: Math.max(bottom, partner.y + partner.height),
				gutter,
			};
		} else if (junction) {
			// Not adjacent: the junction sits in the generation lane, and so does the `+`.
			slot = {
				x: junction.x + junction.width / 2,
				y: Math.max(bottom, junction.y + junction.height / 2),
			};
		} else if (partner) {
			// Childless and not adjacent: their line runs through the lane below the cards.
			slot = {
				x: (box.x + box.width / 2 + partner.x + partner.width / 2) / 2,
				y: bottom + rowGap / 3,
			};
		} else {
			// The partner is folded away: under the subject's own card, clear of its centre.
			slot = { x: cx + box.width / 4, y: bottom };
		}
		slots.push({
			key: `couple:${couple.unionId}`,
			kind: "couple",
			target: couple.target,
			...slot,
			label: `Add a child of ${couple.target.subjectName}`,
		});
	}

	if (affordances.child) {
		slots.push({
			key: "child",
			kind: "child",
			target: affordances.child,
			x: cx,
			y: bottom,
			label: `Add a child of ${affordances.child.subjectName}`,
		});
	}

	return slots;
}

/**
 * The pressable box of one `+`, in flow coordinates, for the current zoom.
 *
 * A 44px target has to be 44 SCREEN pixels, so it is divided by the zoom it is about to be
 * multiplied by -- and at a legible zoom that is larger than a third of the card. Centring it
 * on the edge, as the first version did, then had to be capped to stop it covering the name,
 * and the cap won: measured at fit zoom, 37x41 on cards and 42x23 on the row level.
 *
 * So the target is ASYMMETRIC, and every side of it is bounded by what it must not cover:
 *
 *   - INTO the card by a fifth of the card's height at most, so the name stays pressable.
 *   - OUT of the card by a little less than the gap between generations, so a parent's
 *     bottom `+` cannot reach the only child laid out directly beneath them. At a low zoom
 *     that bound wins and the target is shorter than 44 screen pixels: a smaller target is a
 *     cost, a target that opens "add a child" when you tap the child is a defect.
 *   - ACROSS the edge short of the fold chevron's pill, on this card and, for a couple's `+`,
 *     on the right-hand partner's card, whose pill sits 16% from the gutter side.
 *   - A side target reaches outward by less than the free space beside the card (`reach`).
 */
export function hitBox(
	slot: Pick<AddSlot, "kind" | "x" | "y" | "side" | "reach" | "gutter">,
	card: { width: number; height: number; reach: number; rowGap: number },
	zoom: number,
): { left: number; top: number; width: number; height: number } {
	const hit = HIT_TARGET / Math.max(zoom, 0.01);
	const lane = Math.max(0, card.rowGap - 4);

	if (slot.kind === "partner") {
		const inward = Math.min(hit / 2, card.width * 0.12);
		const width = Math.min(hit, inward + (slot.reach ?? card.reach));
		// Vertically centred on mid-card; never past the gaps above and below the row.
		const height = Math.min(hit, card.height + 2 * lane);
		// Outward is away from the card: right for a `+` on the right edge, left on the left.
		const left = slot.side === "left" ? slot.x + inward - width : slot.x - inward;
		return { left, top: slot.y - height / 2, width, height };
	}

	const inward = Math.min(hit / 2, card.height * 0.22);
	const outward = Math.min(hit - inward, lane);
	const height = inward + outward;
	const top = slot.kind === "parent" ? slot.y - outward : slot.y - inward;

	if (slot.kind === "couple" && slot.gutter) {
		// Into the left card freely (its pill is at its far edge), into the right card only up
		// to its fold pill, which sits 16% from the gutter.
		const leftLimit = slot.gutter.left - card.width * 0.4;
		const rightLimit = slot.gutter.right + Math.max(0, FOLD_AT * card.width - FOLD_PILL_HALF);
		const width = Math.min(hit, rightLimit - leftLimit);
		const left = Math.min(Math.max(slot.x - width / 2, leftLimit), rightLimit - width);
		return { left, top, width, height };
	}

	const width =
		slot.kind === "couple"
			? Math.min(hit, card.width * 0.4)
			: Math.min(hit, 2 * ((0.5 - FOLD_AT) * card.width - FOLD_PILL_HALF));
	return { left: slot.x - width / 2, top, width, height };
}

/** Which way a strip opens from the control that opened it. */
export type StripSide = "above" | "below" | "left" | "right";

/** The way a `+` strip opens: away from the card, toward where its relative goes. */
export function stripSide(slot: Pick<AddSlot, "kind" | "side">): StripSide {
	if (slot.kind === "parent") return "above";
	if (slot.kind === "partner") return slot.side === "left" ? "left" : "right";
	return "below";
}

const OPPOSITE: Record<StripSide, StripSide> = {
	above: "below",
	below: "above",
	left: "right",
	right: "left",
};

/**
 * Where a strip sits on screen, and the point inside it that it grows from.
 *
 * The strip opens beside the control on the side its relative goes, flips to the opposite
 * side when that one has no room, and is then clamped into the canvas. The origin is the
 * control's own point in the strip's box, so the strip grows OUT of the `+` and folds back
 * into it even after clamping has moved it. All in screen pixels relative to the canvas.
 */
export function placeStrip(
	anchor: { x: number; y: number },
	side: StripSide,
	size: { width: number; height: number },
	bounds: { width: number; height: number },
	gap = 18,
	margin = 12,
): { left: number; top: number; originX: number; originY: number; side: StripSide } {
	const fits: Record<StripSide, boolean> = {
		above: anchor.y - gap - size.height >= margin,
		below: anchor.y + gap + size.height <= bounds.height - margin,
		left: anchor.x - gap - size.width >= margin,
		right: anchor.x + gap + size.width <= bounds.width - margin,
	};
	const chosen = fits[side] || !fits[OPPOSITE[side]] ? side : OPPOSITE[side];

	let left = anchor.x - size.width / 2;
	let top = anchor.y - size.height / 2;
	if (chosen === "above") top = anchor.y - gap - size.height;
	if (chosen === "below") top = anchor.y + gap;
	if (chosen === "left") left = anchor.x - gap - size.width;
	if (chosen === "right") left = anchor.x + gap;

	const clamp = (value: number, room: number) =>
		Math.min(Math.max(value, margin), Math.max(margin, room - margin));
	left = clamp(left, bounds.width - size.width);
	top = clamp(top, bounds.height - size.height);
	return { left, top, originX: anchor.x - left, originY: anchor.y - top, side: chosen };
}

/**
 * First names only, for a placeholder that has to fit a phone.
 *
 * "Alex Rivera and Morgan Rivera" reads "Alex and Morgan": the strip sits beside the card it
 * belongs to, so the first name is enough to say whose relative is being added.
 */
export function shortSubject(subjectName: string): string {
	return subjectName
		.split(" and ")
		.map((name) => name.trim().split(/\s+/)[0] || name)
		.join(" and ");
}
