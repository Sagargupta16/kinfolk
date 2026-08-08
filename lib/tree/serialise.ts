/**
 * Turning a `TreeView` into JSON and back.
 *
 * This file exists because of one landmine: `TreeView.kinship` is a `Map`, and
 * `JSON.stringify(new Map([["a", 1]]))` is `"{}"`. Not an error, not a warning --
 * an empty object. Serialise the view naively and every card silently loses the
 * line saying what that person is to the viewer, on a canvas that otherwise looks
 * completely correct. That is the worst class of bug in this repo: it renders.
 *
 * So the Map crosses the wire as entries and is rebuilt on arrival. Both halves
 * live here rather than at the two call sites, because a serialiser and a parser
 * that disagree fail in exactly the same invisible way.
 *
 * Contact VALUES are not a concern here: `lib/tree/visibility.ts` strips them
 * while the view is being assembled, so a view reaching this file has already
 * been filtered. This must never become the place that filtering happens -- by
 * the time a view is being serialised, the decision about who may see what has
 * already been made, and re-deciding it here would put the same rule in two
 * places.
 */
import type { Person, Union } from "../db/schema";
import type { FlowNode, FusedPerson, UnionWithChildren } from "./graph";
import type { Kinship } from "./kinship";
import type { TreeView } from "./view";

/**
 * A `TreeView` with the Map flattened.
 *
 * Timestamps flatten too: `Date` fields cross the wire as ISO STRINGS, and
 * `parseTreeView` now REVIVES every one of them. This file used to record the
 * opposite decision -- "nothing renders them, so reviving would be ceremony" --
 * and that note expired exactly the way it predicted: the family feed calls
 * `.getTime()` on person rows, which threw only on the API path and took the
 * whole SPA canvas down while the server-rendered app worked perfectly. The
 * boundary's job is that a parsed view is indistinguishable from a served one,
 * so the revival lives HERE, not defensively inside every consumer -- a
 * serialiser and a parser that disagree fail invisibly, and so do a consumer
 * that copes with strings and one that does not.
 */
export type SerialisedTreeView = Omit<TreeView, "kinship"> & {
	kinship: [string, Kinship][];
};

export function serialiseTreeView(view: TreeView): SerialisedTreeView {
	return { ...view, kinship: [...view.kinship.entries()] };
}

export function parseTreeView(payload: SerialisedTreeView): TreeView {
	return {
		...payload,
		// `?? []` because a payload from an older deployment may predate the field, and
		// an empty kinship map degrades to unlabelled cards rather than a crash.
		kinship: new Map(payload.kinship ?? []),
		nodes: (payload.nodes ?? []).map(reviveNode),
	};
}

/**
 * JSON.parse hands back whatever the wire carried, so a "Date" here may be a
 * string. Instanceof-guarded rather than blindly constructed: a view that never
 * crossed the wire (the demo path calls nothing here, but a future caller
 * might) must round-trip unchanged.
 */
function reviveDate(value: Date | string): Date;
function reviveDate(value: Date | string | null): Date | null;
function reviveDate(value: Date | string | null): Date | null {
	if (value === null) return null;
	return value instanceof Date ? value : new Date(value);
}

function revivePerson(row: Person): Person {
	return {
		...row,
		createdAt: reviveDate(row.createdAt),
		updatedAt: reviveDate(row.updatedAt),
		verifiedAt: reviveDate(row.verifiedAt),
	};
}

function reviveUnion(union: UnionWithChildren): UnionWithChildren {
	return { ...union, createdAt: reviveDate((union as Union).createdAt) };
}

function reviveNode(node: FlowNode): FlowNode {
	if (node.type === "person") {
		const person: FusedPerson = {
			...node.data,
			primary: revivePerson(node.data.primary),
			sources: node.data.sources.map(revivePerson),
			contacts: node.data.contacts.map((contact) => ({
				...contact,
				createdAt: reviveDate(contact.createdAt),
				updatedAt: reviveDate(contact.updatedAt),
			})),
		};
		return { ...node, data: person };
	}
	return { ...node, data: { union: reviveUnion(node.data.union) } };
}
