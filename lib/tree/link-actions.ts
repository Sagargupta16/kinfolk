"use server";

import { and, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";
import { db } from "../db/client";
import { people, personLinks, trees } from "../db/schema";
import { NotAllowedError } from "./authz";
import type { Result } from "./edit-actions";
import { displayName } from "./graph";
import type { LinkState } from "./links";
import { treeAccessForUser } from "./read-access";
import { requestUserId } from "./request-user";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const personA = alias(people, "proposal_person_a");
const personB = alias(people, "proposal_person_b");
const treeA = alias(trees, "proposal_tree_a");
const treeB = alias(trees, "proposal_tree_b");

function proposalsFor(userId: string) {
	return db
		.select({ link: personLinks, personA, personB, treeA, treeB })
		.from(personLinks)
		.innerJoin(personA, eq(personA.id, personLinks.personAId))
		.innerJoin(personB, eq(personB.id, personLinks.personBId))
		.innerJoin(treeA, eq(treeA.id, personA.treeId))
		.innerJoin(treeB, eq(treeB.id, personB.treeId))
		.where(or(eq(treeA.ownerId, userId), eq(treeB.ownerId, userId)));
}

function mayDecide(userId: string, proposer: string, ownerA: string, ownerB: string) {
	// Consent must come from the other owner. An owner of both workspaces may
	// confirm both sides, but an editor grant never authorizes cross-family access.
	return (ownerA === proposer && ownerB === userId) || (ownerB === proposer && ownerA === userId);
}

/** Only already-visible records are offered; this is not a public people search. */
export async function linkState(): Promise<LinkState> {
	const userId = await requestUserId();
	if (!userId) throw new NotAllowedError("Sign in to link family records.");
	const { access } = await treeAccessForUser(userId);
	const rows =
		access.size === 0
			? []
			: await db
					.select({ person: people, tree: trees })
					.from(people)
					.innerJoin(trees, eq(trees.id, people.treeId))
					.where(inArray(people.treeId, [...access.keys()]));
	const proposals = await proposalsFor(userId);
	return {
		candidates: rows
			.map(({ person, tree }) => ({
				id: person.id,
				name: displayName(person),
				treeId: tree.id,
				treeName: tree.name,
				owned: tree.ownerId === userId,
			}))
			.sort((a, b) => a.name.localeCompare(b.name)),
		proposals: proposals.map(({ link, personA: a, personB: b, treeA: ta, treeB: tb }) => ({
			id: link.id,
			a: `${displayName(a)} · ${ta.name}`,
			b: `${displayName(b)} · ${tb.name}`,
			note: link.note,
			status: link.status,
			canDecide:
				link.status === "pending" && mayDecide(userId, link.proposedById, ta.ownerId, tb.ownerId),
			canRevoke:
				link.status === "accepted" || (link.status === "pending" && link.proposedById === userId),
		})),
	};
}

export async function proposeLink(form: FormData): Promise<Result> {
	const userId = await requestUserId();
	if (!userId) return { ok: false, error: "Sign in to link family records." };
	const fromId = String(form.get("fromPersonId") ?? "");
	const toId = String(form.get("toPersonId") ?? "");
	if (!uuid.test(fromId) || !uuid.test(toId) || fromId === toId) {
		return { ok: false, error: "Choose two records of the same person in different families." };
	}
	if (form.get("consent") !== "true") {
		return { ok: false, error: "Confirm what linking shares before proposing a link." };
	}
	const note = String(form.get("note") ?? "").trim();
	if (note.length > 1000) return { ok: false, error: "Keep the note under 1,000 characters." };
	const { access } = await treeAccessForUser(userId);
	const rows = await db
		.select({ person: people, tree: trees })
		.from(people)
		.innerJoin(trees, eq(trees.id, people.treeId))
		.where(inArray(people.id, [fromId, toId]));
	const from = rows.find(({ person }) => person.id === fromId);
	const to = rows.find(({ person }) => person.id === toId);
	if (!from || !to || from.tree.ownerId !== userId || !access.has(to.tree.id)) {
		return {
			ok: false,
			error: "Choose a record in your own family and a family you can already see.",
		};
	}
	if (from.tree.id === to.tree.id) {
		return { ok: false, error: "These records are in the same family." };
	}
	const [a, b] = [fromId, toId].sort();
	if (!a || !b) return { ok: false, error: "Choose two records." };
	const [saved] = await db
		.insert(personLinks)
		.values({
			personAId: a,
			personBId: b,
			proposedById: userId,
			note: note || null,
		})
		.onConflictDoUpdate({
			target: [personLinks.personAId, personLinks.personBId],
			set: {
				// A fresh proposal must invalidate forms and decisions for the old one.
				id: crypto.randomUUID(),
				status: "pending",
				proposedById: userId,
				note: note || null,
				decidedById: null,
				decidedAt: null,
			},
			setWhere: inArray(personLinks.status, ["rejected", "revoked"]),
		})
		.returning({ id: personLinks.id });
	if (!saved) return { ok: false, error: "These records already have a pending or accepted link." };
	revalidatePath("/tree");
	return { ok: true, id: saved.id };
}

export async function decideLink(form: FormData): Promise<Result> {
	const userId = await requestUserId();
	if (!userId) return { ok: false, error: "Sign in to manage family links." };
	const linkId = String(form.get("linkId") ?? "");
	const decision = String(form.get("decision") ?? "");
	if (!uuid.test(linkId) || !["accept", "reject", "revoke"].includes(decision)) {
		return { ok: false, error: "Choose a link and a decision." };
	}
	const row = (await proposalsFor(userId)).find(({ link }) => link.id === linkId);
	if (!row) return { ok: false, error: "You do not have permission to manage that link." };
	const { link, treeA: a, treeB: b } = row;
	const canDecide = mayDecide(userId, link.proposedById, a.ownerId, b.ownerId);
	if (decision === "revoke") {
		if (
			link.status !== "accepted" &&
			!(link.status === "pending" && link.proposedById === userId)
		) {
			return { ok: false, error: "That link is no longer active." };
		}
	} else if (link.status !== "pending" || !canDecide) {
		return { ok: false, error: "Only the other family's owner can decide a pending proposal." };
	}
	if (decision === "accept" && form.get("consent") !== "true") {
		return { ok: false, error: "Confirm what linking shares before accepting." };
	}
	const status =
		decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : "revoked";
	const [saved] = await db
		.update(personLinks)
		.set({ status, decidedById: userId, decidedAt: new Date() })
		.where(and(eq(personLinks.id, link.id), eq(personLinks.status, link.status)))
		.returning({ id: personLinks.id });
	if (!saved) return { ok: false, error: "This proposal changed. Refresh and try again." };
	revalidatePath("/tree");
	return { ok: true, id: saved.id };
}
