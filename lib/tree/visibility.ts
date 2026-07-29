/**
 * Which contact details a given viewer is allowed to receive.
 *
 * This runs on the SERVER, before rows are handed to any component. Contact
 * values are the most sensitive data in the app -- a phone number is not public
 * just because a family tree is shared -- and the canvas is a screenshot waiting
 * to happen. Filtering in the client would mean the values were already sent.
 *
 * The visibility ladder, narrowest first:
 *
 *   tree   -- members of the owning tree only.
 *   linked -- also anyone whose tree is joined to it by an ACCEPTED person link.
 *   shared -- any signed-in viewer who can see the tree at all.
 *
 * Every stored row defaults to `tree`, so a detail is private until somebody
 * deliberately widens it.
 */
import type { ContactDetail, Visibility } from "../db/schema";

/** How the viewer reaches a given person's tree. Ordered, narrowest first. */
export type ViewerAccess = "member" | "linked" | "shared";

const ALLOWED: Record<ViewerAccess, ReadonlySet<Visibility>> = {
	// A member of the owning tree sees everything that tree recorded.
	member: new Set<Visibility>(["tree", "linked", "shared"]),
	// A linked relative sees what was opened up beyond the owning tree.
	linked: new Set<Visibility>(["linked", "shared"]),
	// Everyone else sees only what was explicitly marked shared.
	shared: new Set<Visibility>(["shared"]),
};

/** Whether a single detail may be sent to a viewer with this access level. */
export function canSee(visibility: Visibility, access: ViewerAccess): boolean {
	return ALLOWED[access].has(visibility);
}

/**
 * Drop every detail the viewer may not receive.
 *
 * Takes access PER TREE rather than one global level: in a combined view the
 * viewer is a member of their own tree and merely linked to a relative's, and
 * collapsing that to a single level would either leak the relative's private
 * rows or hide the viewer's own.
 */
export function filterContacts(
	contacts: Record<string, ContactDetail[]>,
	treeIdByPersonId: Map<string, string>,
	accessByTreeId: Map<string, ViewerAccess>,
): Record<string, ContactDetail[]> {
	const visible: Record<string, ContactDetail[]> = {};

	for (const [personId, details] of Object.entries(contacts)) {
		const treeId = treeIdByPersonId.get(personId);
		// A person we cannot place in a tree gets no access level, so no contacts.
		// Failing closed matters more here than rendering a complete card.
		if (!treeId) continue;

		const access = accessByTreeId.get(treeId);
		if (!access) continue;

		const allowed = details.filter((detail) => canSee(detail.visibility, access));
		if (allowed.length > 0) visible[personId] = allowed;
	}

	return visible;
}
