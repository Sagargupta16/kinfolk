/**
 * WHICH row an edit writes to, when a person on screen is several rows.
 *
 * A card shows a `FusedPerson`: one logical human assembled from every person row that
 * accepted links say is the same individual. Its `id` is the smallest member id, chosen in
 * `fuseTrees` so the value never depends on input order -- and that is exactly what makes it
 * the wrong thing to hand an edit action. "Smallest" is a uuid comparison, so on a merged
 * person it lands on the far family's row about half the time, and `treeIdForEditablePerson`
 * would then refuse the write. The user would be told they may not edit their own record.
 *
 * So the panel resolves a TARGET first: the contributing row that sits in a tree this viewer
 * may write to. Pure, because "which of these rows is mine" is a claim that decides where
 * somebody's data lands, and it is invisible on screen either way.
 */
import type { Person } from "../db/schema";
import type { FusedPerson } from "./graph";

/**
 * The row to edit, or why there is none.
 *
 * `reason` is present only on a refusal, and it is written for the person reading the panel
 * rather than for a log: "this record belongs to another family" is actionable, where
 * "forbidden" is not.
 */
export type EditTarget =
	| { editable: true; personId: string; treeId: string }
	| { editable: false; reason: string };

/**
 * Resolve the editable source row of a fused person.
 *
 * `editableTreeIds` is a list rather than a single id on purpose. `TreeView.editableTreeId`
 * is one value -- the graph the Add panel writes to -- but a viewer can hold write grants on
 * several trees, and a merged person can carry a row in more than one of them. Taking a list
 * means this helper cannot be the thing that gets it wrong later.
 *
 * Where several sources qualify, the FIRST in `editableTreeIds` order wins, so the caller's
 * own preference (its primary graph first) decides rather than uuid ordering.
 */
export function editTarget(person: FusedPerson, editableTreeIds: readonly string[]): EditTarget {
	if (editableTreeIds.length === 0) {
		return { editable: false, reason: "You have read-only access to this graph." };
	}

	for (const treeId of editableTreeIds) {
		const source = person.sources.find((row) => row.treeId === treeId);
		if (source) return { editable: true, personId: source.id, treeId };
	}

	/*
	 * A person visible but not editable is the normal case for a linked family, not an error.
	 *
	 * An accepted person link means "we agree this is the same human", never "you may edit my
	 * records" -- so the message says whose it is rather than implying something is broken.
	 */
	return {
		editable: false,
		reason:
			person.contributingTreeIds.length > 1
				? "This person is recorded by another family. You can edit your own copy only."
				: "This person belongs to a graph you cannot edit.",
	};
}

/**
 * The values an edit form opens with.
 *
 * Read from the TARGET row rather than from `FusedPerson.primary`, and the difference is the
 * whole point: `primary` is whichever contributing row won the display contest (the viewer's
 * own tree if present, else the most recently updated), so on a merged person it can be the
 * far family's data. Editing a form prefilled from their row would copy their values into
 * yours the moment you pressed save.
 */
export function editInitialValues(person: FusedPerson, personId: string): Person | undefined {
	return person.sources.find((row) => row.id === personId);
}

/**
 * Preserve the recorded precision when a date is opened for editing.
 * Both exact dates and approximate text must survive an unrelated profile edit.
 */
export function dateInputValue(exact: string | null, approx: string | null): string {
	return exact ?? approx ?? "";
}
