import { and, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client";
import { people, personLinks, treeMembers, trees } from "../db/schema";
import type { ViewerAccess } from "./visibility";

/**
 * Explicit grants plus one hop through accepted links. Pending proposals never
 * grant access, and linked access never promotes itself to a membership.
 */
export async function treeAccessForUser(userId: string, combined = true) {
	const rows = await db
		.select({ id: trees.id, ownerId: trees.ownerId })
		.from(trees)
		.leftJoin(treeMembers, and(eq(treeMembers.treeId, trees.id), eq(treeMembers.userId, userId)))
		.where(or(eq(trees.ownerId, userId), eq(treeMembers.userId, userId)));
	const access = new Map<string, ViewerAccess>();
	for (const row of rows.sort(
		(a, b) =>
			Number(b.ownerId === userId) - Number(a.ownerId === userId) || a.id.localeCompare(b.id),
	)) {
		access.set(row.id, "member");
	}

	const directIds = [...access.keys()];
	if (!combined || directIds.length === 0) return { access, links: [] };

	const personA = alias(people, "access_person_a");
	const personB = alias(people, "access_person_b");
	const linked = await db
		.select({
			personAId: personLinks.personAId,
			personBId: personLinks.personBId,
			treeAId: personA.treeId,
			treeBId: personB.treeId,
		})
		.from(personLinks)
		.innerJoin(personA, eq(personA.id, personLinks.personAId))
		.innerJoin(personB, eq(personB.id, personLinks.personBId))
		.where(
			and(
				eq(personLinks.status, "accepted"),
				or(inArray(personA.treeId, directIds), inArray(personB.treeId, directIds)),
			),
		);
	for (const row of linked) {
		for (const treeId of [row.treeAId, row.treeBId]) {
			if (!access.has(treeId)) access.set(treeId, "linked");
		}
	}
	return {
		access,
		links: linked.map(({ personAId, personBId }) => ({ personAId, personBId })),
	};
}
