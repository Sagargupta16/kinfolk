"use server";

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { contactDetails, people } from "../db/schema";
import { editableTreeIds, NotAllowedError } from "./authz";
import type { ContactState } from "./contacts";
import { displayName } from "./graph";
import { treeAccessForUser } from "./read-access";
import { requestUserId } from "./request-user";
import { canSee } from "./visibility";

/** Values are loaded only after a deliberate visit to the contact page. */
export async function contactState(personId: string): Promise<ContactState> {
	const userId = await requestUserId();
	if (!userId) throw new NotAllowedError("Sign in to see contact details.");
	if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(personId)) throw new NotAllowedError();
	const { access } = await treeAccessForUser(userId);
	const [person] = await db.select().from(people).where(eq(people.id, personId)).limit(1);
	const level = person && access.get(person.treeId);
	if (!person || !level) throw new NotAllowedError("You do not have access to these details.");
	const rows = await db.select().from(contactDetails).where(eq(contactDetails.personId, personId));
	return {
		personId,
		name: displayName(person),
		editable: (await editableTreeIds(userId)).includes(person.treeId),
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
