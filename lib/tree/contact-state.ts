"use server";

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { contactDetails, people } from "../db/schema";
import { editableTreeIds, NotAllowedError } from "./authz";
import type { ContactState } from "./contacts";
import { displayName } from "./graph";
import { isUuid } from "./ids";
import { treeAccessForUser } from "./read-access";
import { requestUserId } from "./request-user";
import { canSee } from "./visibility";

/**
 * Values are loaded only after a deliberate visit to the contact page.
 *
 * The reads that do not depend on each other run together. The rows are fetched before
 * access is known, but nothing leaves this function until the access level has filtered
 * them, so the order costs nothing in privacy and saves three round trips.
 */
export async function contactState(personId: string): Promise<ContactState> {
	const userId = await requestUserId();
	if (!userId) throw new NotAllowedError("Sign in to see contact details.");
	if (!isUuid(personId)) throw new NotAllowedError("Those contact details could not be found.");
	const [{ access }, [person], rows, editable] = await Promise.all([
		treeAccessForUser(userId),
		db.select().from(people).where(eq(people.id, personId)).limit(1),
		db.select().from(contactDetails).where(eq(contactDetails.personId, personId)),
		editableTreeIds(userId),
	]);
	const level = person && access.get(person.treeId);
	if (!person || !level) throw new NotAllowedError("You do not have access to these details.");
	return {
		personId,
		name: displayName(person),
		editable: editable.includes(person.treeId),
		contacts: rows
			.filter((row) => canSee(row.visibility, level))
			.map((row) => ({
				id: row.id,
				kind: row.kind,
				value: row.value,
				label: row.label,
				visibility: row.visibility,
			})),
	};
}
