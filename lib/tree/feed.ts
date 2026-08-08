/**
 * The family feed: what changed in this record, newest first.
 *
 * Derived entirely from row timestamps the schema already carries -- a person
 * row's `createdAt`/`updatedAt` and a union's `createdAt` -- so there is no
 * events table, no migration, and nothing that can drift from the graph it
 * describes. The trade is honest and worth naming: the feed knows THAT a record
 * changed and when, not which field or by whom. An audit trail is a different
 * feature with a different table.
 *
 * Deliberately PRIVATE. This reads like a social feed and is scoped like the
 * rest of the product: it is computed from the nodes the viewer already
 * received, so it can never show a person the canvas would not. A public
 * discovery feed would be an opt-in per tree and a different design.
 *
 * Pure, no React and no database imports, like every other graph calculation.
 */
import type { FlowNode } from "./graph";
import { displayName } from "./graph";

export type FeedEventKind = "arrived" | "updated" | "partnership";

export type FeedEvent = {
	/** Unique per event, for React keys. */
	id: string;
	kind: FeedEventKind;
	at: Date;
	/** The fused person to travel to when the row is clicked. */
	personId: string;
	/** Who the event is about. */
	name: string;
	/** The second half of the sentence: "was added to the record", "and X, recorded". */
	detail: string;
	/** Initial for the avatar disc. */
	initial: string;
};

/**
 * An update is only an EVENT if it happened meaningfully after creation.
 *
 * Every insert sets both stamps to the same moment (give or take the row trip),
 * so without a floor every arrival would also produce an update -- the same
 * fact twice, back to back, which is how a feed teaches people to stop reading.
 */
const UPDATE_FLOOR_MS = 60_000;

/** How many events the panel shows. Enough for a real scroll, not an archive. */
const FEED_LIMIT = 80;

export function familyFeed(nodes: FlowNode[], limit = FEED_LIMIT): FeedEvent[] {
	const events: FeedEvent[] = [];
	const personById = new Map<string, { name: string }>();

	for (const node of nodes) {
		if (node.type !== "person") continue;
		const name = displayName(node.data.primary);
		personById.set(node.id, { name });

		/*
		 * Earliest creation across the SOURCES, not the primary row's. A fused person
		 * exists in the record from the moment the FIRST family wrote them down; the
		 * primary is just whichever row won the display contest.
		 */
		let created: Date | null = null;
		let updated: Date | null = null;
		for (const source of node.data.sources) {
			if (!created || source.createdAt < created) created = source.createdAt;
			if (!updated || source.updatedAt > updated) updated = source.updatedAt;
		}
		if (!created) continue;

		events.push({
			id: `arrived:${node.id}`,
			kind: "arrived",
			at: created,
			personId: node.id,
			name,
			detail: "was added to the record",
			initial: initialOf(name),
		});

		if (updated && updated.getTime() - created.getTime() > UPDATE_FLOOR_MS) {
			events.push({
				id: `updated:${node.id}`,
				kind: "updated",
				at: updated,
				personId: node.id,
				name,
				detail: "had their record updated",
				initial: initialOf(name),
			});
		}
	}

	for (const node of nodes) {
		if (node.type !== "union") continue;
		const union = node.data.union;
		const a = union.partnerAId ? personById.get(union.partnerAId) : null;
		const b = union.partnerBId ? personById.get(union.partnerBId) : null;
		// A partnership event needs somebody to name and somebody to travel to; a
		// union whose partners are both outside the visible graph offers neither.
		// The anchor follows whichever partner the canvas can actually show --
		// `partnerAId` alone would name the row after B and fly the camera to a
		// node that is not there.
		const anchor = a ? union.partnerAId : union.partnerBId;
		if (!anchor || (!a && !b)) continue;

		const name = a?.name ?? b?.name ?? "Unknown";
		const other = a && b ? b.name : null;
		const detail = other
			? `and ${other}, recorded as partners`
			: union.partnerAId && union.partnerBId
				? "recorded in a partnership"
				: "recorded as a parent";

		events.push({
			id: `union:${union.id}`,
			kind: "partnership",
			at: union.createdAt,
			personId: anchor,
			name,
			detail,
			initial: initialOf(name),
		});
	}

	events.sort((left, right) => right.at.getTime() - left.at.getTime());
	return events.slice(0, limit);
}

function initialOf(name: string): string {
	return (name.trim()[0] ?? "?").toUpperCase();
}

/**
 * "2d ago", "3w ago", "just now" -- the compressed form a feed row wants.
 *
 * Hand-rolled rather than Intl.RelativeTimeFormat because that API refuses to
 * pick its own unit: the caller must already know whether the answer is in
 * days or months, which is the whole computation. The vocabulary here is the
 * one every feed reader already knows.
 */
export function relativeTime(at: Date, now: Date): string {
	const seconds = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
	if (seconds < 90) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 14) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	if (weeks < 9) return `${weeks}w ago`;
	const months = Math.floor(days / 30);
	if (months < 18) return `${months}mo ago`;
	const years = Math.floor(days / 365);
	return `${years}y ago`;
}

/**
 * The section a feed event files under. Coarse on purpose: a feed is read as
 * "what happened lately", and ten date headings answer a question nobody asked.
 */
export function feedSection(at: Date, now: Date): "This week" | "This month" | "Earlier" {
	const days = (now.getTime() - at.getTime()) / 86_400_000;
	if (days < 7) return "This week";
	if (days < 31) return "This month";
	return "Earlier";
}
