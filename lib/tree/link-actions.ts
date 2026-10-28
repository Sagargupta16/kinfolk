"use server";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client";
import { people, personLinks, trees } from "../db/schema";
import { NotAllowedError } from "./authz";
import { displayName } from "./graph";
import { isUuid } from "./ids";
import type { LinkState } from "./links";
import { withinHourlyBudget } from "./rate-limit";
import { treeAccessForUser } from "./read-access";
import { requestUserId } from "./request-user";
import type { Result } from "./result";

const personA = alias(people, "proposal_person_a");
const personB = alias(people, "proposal_person_b");
const treeA = alias(trees, "proposal_tree_a");
const treeB = alias(trees, "proposal_tree_b");

/**
 * The proposals this user owns a side of, one if `linkId` is given.
 *
 * Only the columns the panel and the decision need. Filtering one link in SQL rather
 * than finding it among every proposal the user has ever made keeps a decision one
 * small read however long that history gets.
 */
function proposalsFor(userId: string, linkId?: string) {
	const owned = or(eq(treeA.ownerId, userId), eq(treeB.ownerId, userId));
	return db
		.select({
			link: personLinks,
			personA: {
				givenName: personA.givenName,
				familyName: personA.familyName,
				nickname: personA.nickname,
			},
			personB: {
				givenName: personB.givenName,
				familyName: personB.familyName,
				nickname: personB.nickname,
			},
			treeA: { name: treeA.name, ownerId: treeA.ownerId },
			treeB: { name: treeB.name, ownerId: treeB.ownerId },
		})
		.from(personLinks)
		.innerJoin(personA, eq(personA.id, personLinks.personAId))
		.innerJoin(personB, eq(personB.id, personLinks.personBId))
		.innerJoin(treeA, eq(treeA.id, personA.treeId))
		.innerJoin(treeB, eq(treeB.id, personB.treeId))
		.where(linkId ? and(owned, eq(personLinks.id, linkId)) : owned);
}

function mayDecide(userId: string, proposer: string, ownerA: string, ownerB: string) {
	// Consent must come from the other owner. An owner of both workspaces may
	// confirm both sides, but an editor grant never authorizes cross-family access.
	return (ownerA === proposer && ownerB === userId) || (ownerB === proposer && ownerA === userId);
}

/**
 * Two records' combined identity, as accepted links already join them: every row it
 * reaches, and whether two of those rows belong to one family.
 *
 * Fusion is transitive, so a link is a claim about everybody either record is already
 * linked to. Linking my grandfather and then my great-uncle to the same record in
 * another family would make one card of two people in MY family, and `editTarget` would
 * then write every edit to whichever of them came first. A direct link inside one
 * family is refused for the same reason; this catches the indirect one.
 */
const mergesOneFamily = (aId: string, bId: string) => sql`
	EXISTS (
		WITH RECURSIVE component(id) AS (
			SELECT unnest(ARRAY[${aId}::uuid, ${bId}::uuid])
			UNION
			SELECT CASE WHEN l.person_a_id = c.id THEN l.person_b_id ELSE l.person_a_id END
			FROM component c
			JOIN person_links l
				ON l.status = 'accepted' AND (l.person_a_id = c.id OR l.person_b_id = c.id)
		)
		SELECT 1 FROM component c JOIN people p ON p.id = c.id
		GROUP BY p.tree_id HAVING count(*) > 1
	)
`;

const MERGES_ONE_FAMILY =
	"That would make two different people in one family into one person, because one of these records is already linked to the other family.";

async function wouldMergeOneFamily(aId: string, bId: string): Promise<boolean> {
	const result = await db.execute<{ merges: boolean }>(
		sql`SELECT ${mergesOneFamily(aId, bId)} AS merges`,
	);
	return Boolean(result.rows[0]?.merges);
}

/** Only already-visible records are offered; this is not a public people search. */
export async function linkState(): Promise<LinkState> {
	const userId = await requestUserId();
	if (!userId) throw new NotAllowedError("Sign in to link family records.");
	const [{ access }, proposals] = await Promise.all([
		treeAccessForUser(userId),
		proposalsFor(userId),
	]);
	// Names only: the picker needs to tell two people apart, not their whole records.
	const rows =
		access.size === 0
			? []
			: await db
					.select({
						id: people.id,
						givenName: people.givenName,
						familyName: people.familyName,
						nickname: people.nickname,
						treeId: trees.id,
						treeName: trees.name,
						ownerId: trees.ownerId,
					})
					.from(people)
					.innerJoin(trees, eq(trees.id, people.treeId))
					.where(inArray(people.treeId, [...access.keys()]));
	return {
		candidates: rows
			.map((row) => ({
				id: row.id,
				name: displayName(row),
				treeId: row.treeId,
				treeName: row.treeName,
				owned: row.ownerId === userId,
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
	if (!isUuid(fromId) || !isUuid(toId) || fromId === toId) {
		return { ok: false, error: "Choose two records of the same person in different families." };
	}
	if (form.get("consent") !== "true") {
		return { ok: false, error: "Confirm what linking shares before proposing a link." };
	}
	const note = String(form.get("note") ?? "").trim();
	if (note.length > 1000) return { ok: false, error: "Keep the note under 1,000 characters." };
	const [{ access }, rows] = await Promise.all([
		treeAccessForUser(userId),
		db
			.select({ id: people.id, treeId: trees.id, ownerId: trees.ownerId })
			.from(people)
			.innerJoin(trees, eq(trees.id, people.treeId))
			.where(inArray(people.id, [fromId, toId])),
	]);
	const from = rows.find((row) => row.id === fromId);
	const to = rows.find((row) => row.id === toId);
	if (!from || !to || from.ownerId !== userId || !access.has(to.treeId)) {
		return {
			ok: false,
			error: "Choose a record in your own family and a family you can already see.",
		};
	}
	if (from.treeId === to.treeId) {
		return { ok: false, error: "These records are in the same family." };
	}
	if (await wouldMergeOneFamily(fromId, toId)) return { ok: false, error: MERGES_ONE_FAMILY };
	const budget = await withinHourlyBudget("proposals", userId);
	if (!budget.ok) return budget;
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
	// No revalidatePath: the panel refreshes the route after every change it makes.
	return { ok: true, id: saved.id };
}

export async function decideLink(form: FormData): Promise<Result> {
	const userId = await requestUserId();
	if (!userId) return { ok: false, error: "Sign in to manage family links." };
	const linkId = String(form.get("linkId") ?? "");
	const decision = String(form.get("decision") ?? "");
	if (!isUuid(linkId) || !["accept", "reject", "revoke"].includes(decision)) {
		return { ok: false, error: "Choose a link and a decision." };
	}
	const [row] = await proposalsFor(userId, linkId);
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
	const accepting = decision === "accept";
	// Checked when it is accepted too: the families may have linked other records since
	// the proposal was made.
	if (accepting && (await wouldMergeOneFamily(link.personAId, link.personBId))) {
		return { ok: false, error: MERGES_ONE_FAMILY };
	}
	const status = accepting ? "accepted" : decision === "reject" ? "rejected" : "revoked";
	const changed = and(eq(personLinks.id, link.id), eq(personLinks.status, link.status));
	// Two acceptances that are each fine alone can merge one family together, so every
	// acceptance takes the same lock and re-checks inside it.
	const [, saved] = await db.batch([
		db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('kinfolk.person_links'))`),
		db
			.update(personLinks)
			.set({ status, decidedById: userId, decidedAt: new Date() })
			.where(
				accepting
					? and(changed, sql`NOT ${mergesOneFamily(link.personAId, link.personBId)}`)
					: changed,
			)
			.returning({ id: personLinks.id }),
	]);
	if (saved.length === 0)
		return { ok: false, error: "This proposal changed. Refresh and try again." };
	// No revalidatePath: the panel refreshes the route after every change it makes.
	return { ok: true, id: saved[0]?.id };
}
