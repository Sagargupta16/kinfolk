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
import type { Kinship } from "./kinship";
import type { TreeView } from "./view";

/**
 * A `TreeView` with the Map flattened.
 *
 * One thing this type does NOT capture, and a test pins it: `people.createdAt`
 * and `updatedAt` are real `Date` objects that come back as ISO STRINGS. Nothing
 * renders them, and the fields a card does show (`birthDate`, `deathDate`) are
 * typed `string` and read with `slice`, never parsed -- so the round trip is safe
 * today. It would stop being safe the moment somebody calls a date method on a
 * timestamp, which would throw only on the API path and work fine locally.
 *
 * Deliberately not "fixed" by reviving those two fields: reviving a `Date` to
 * satisfy a type nothing reads would be ceremony, and the honest thing is to
 * record that the boundary loosens them.
 */
export type SerialisedTreeView = Omit<TreeView, "kinship"> & {
	kinship: [string, Kinship][];
};

export function serialiseTreeView(view: TreeView): SerialisedTreeView {
	return { ...view, kinship: [...view.kinship.entries()] };
}

export function parseTreeView(payload: SerialisedTreeView): TreeView {
	// `?? []` because a payload from an older deployment may predate the field, and
	// an empty kinship map degrades to unlabelled cards rather than a crash.
	return { ...payload, kinship: new Map(payload.kinship ?? []) };
}
