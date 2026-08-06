"use server";

/**
 * Sharing a graph, and leaving the app.
 *
 * The share model is an INVITE, not a link anybody can open. A family graph holds
 * children's names, addresses and phone numbers, so a URL that grants access to whoever
 * holds it is the wrong primitive -- it cannot be un-shared once forwarded, and it makes
 * "who can see my grandmother's address" unanswerable. An invite is addressed to a
 * person, is claimed once, expires, and can be revoked.
 *
 * Invites are addressed by email or GitHub login because the invitee usually has no
 * account yet, which is why `tree_invites` carries both and neither is a foreign key.
 */
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { sessionOrNull, signOut } from "@/auth";
import { db } from "../db/client";
import { treeInvites, treeMembers, trees, users } from "../db/schema";
import { assertCanEditTree, NotAllowedError } from "./authz";
import { userIdFromBearer } from "./bearer";
import { DEMO_COOKIE } from "./demo";
import type { Result } from "./edit-actions";

/** How long an unclaimed invite stays valid. */
const INVITE_DAYS = 14;

/**
 * Sign out.
 *
 * Wrapped rather than calling `signOut` from a component, because it has to clear the
 * DEMO COOKIE too. Otherwise signing out of a real session drops the viewer back into
 * sample data -- the demo cookie outlives the session, and `/tree` prefers a session but
 * falls back to the cookie, so the person would land on somebody else's family and be
 * told it was theirs.
 */
export async function leave(): Promise<void> {
	const { cookies } = await import("next/headers");
	const store = await cookies();
	store.delete(DEMO_COOKIE);
	// `redirectTo` rather than a bare signOut: Auth.js otherwise returns to the current
	// URL, which is /tree, which immediately redirects to /signin -- two navigations to
	// reach the page it could have gone to directly.
	await signOut({ redirectTo: "/" });
}

async function sharer(): Promise<{ userId: string } | { error: string }> {
	const { cookies, headers } = await import("next/headers");
	const store = await cookies();
	if (store.get(DEMO_COOKIE)) {
		return { error: "This is sample data. Sign in to share a graph of your own." };
	}
	const session = await sessionOrNull();
	const userId = session?.user?.id;
	if (userId) return { userId };

	// A bearer token, for a UI served from another origin. Same reasoning as
	// `editor()` in edit-actions.ts: the cookie is tried first, so the
	// server-rendered path is untouched.
	const bearer = await userIdFromBearer((await headers()).get("authorization"));
	if (bearer) return { userId: bearer };

	return { error: "Sign in to share." };
}

/**
 * A url-safe random token.
 *
 * `randomUUID` rather than a counter or a slug: this value is the whole credential, so it
 * has to be unguessable. 122 bits of entropy, and the unique index on it means a
 * collision is a failed insert rather than a silently shared invite.
 */
function inviteToken(): string {
	return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

/**
 * Invite somebody to a graph.
 *
 * Role defaults to `viewer`, which is the narrowest: seeing a family graph is already a
 * lot, and edit rights should be a deliberate second decision rather than the default
 * that happens when nobody thought about it.
 */
export async function invite(form: FormData): Promise<Result> {
	const auth = await sharer();
	if ("error" in auth) return { ok: false, error: auth.error };

	const treeId = String(form.get("treeId") ?? "");
	const email = String(form.get("email") ?? "")
		.trim()
		.toLowerCase();
	const githubLogin = String(form.get("githubLogin") ?? "")
		.trim()
		.replace(/^@/, "");
	const role = String(form.get("role") ?? "viewer") as "viewer" | "editor";

	if (!treeId) return { ok: false, error: "Which graph?" };
	if (!email && !githubLogin) {
		return { ok: false, error: "An email address or a GitHub username, so we know who to invite." };
	}
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return { ok: false, error: "That does not look like an email address." };
	}

	try {
		// Only somebody who may EDIT may invite. A viewer sharing onward would route around
		// the owner's decision about who sees their family.
		await assertCanEditTree(auth.userId, treeId);

		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + INVITE_DAYS);

		await db.insert(treeInvites).values({
			treeId,
			email: email || null,
			githubLogin: githubLogin || null,
			role,
			token: inviteToken(),
			invitedById: auth.userId,
			expiresAt,
		});

		revalidatePath("/tree");
		// There is no mail sender yet, so say so rather than implying one was sent. A
		// "invite sent" message for an email that never leaves the building is the kind of
		// lie that costs a user a week of waiting.
		return {
			ok: true,
			id: "Invite recorded. They will get access the first time they sign in with that address or username.",
		};
	} catch (error) {
		if (error instanceof NotAllowedError) return { ok: false, error: error.message };
		throw error;
	}
}

/** Withdraw an invite that has not been claimed. */
export async function revokeInvite(form: FormData): Promise<Result> {
	const auth = await sharer();
	if ("error" in auth) return { ok: false, error: auth.error };

	const inviteId = String(form.get("inviteId") ?? "");
	if (!inviteId) return { ok: false, error: "Which invite?" };

	try {
		const [row] = await db
			.select({ treeId: treeInvites.treeId })
			.from(treeInvites)
			.where(eq(treeInvites.id, inviteId))
			.limit(1);
		if (!row) return { ok: true };

		await assertCanEditTree(auth.userId, row.treeId);
		// Marked revoked rather than deleted, so a claim attempt can say "that invite was
		// withdrawn" instead of "no such invite", and so the owner keeps a record of who
		// they invited.
		await db.update(treeInvites).set({ status: "revoked" }).where(eq(treeInvites.id, inviteId));

		revalidatePath("/tree");
		return { ok: true };
	} catch (error) {
		if (error instanceof NotAllowedError) return { ok: false, error: error.message };
		throw error;
	}
}

/** Remove somebody's access to a graph. */
export async function removeMember(form: FormData): Promise<Result> {
	const auth = await sharer();
	if ("error" in auth) return { ok: false, error: auth.error };

	const treeId = String(form.get("treeId") ?? "");
	const userId = String(form.get("userId") ?? "");
	if (!treeId || !userId) return { ok: false, error: "Which person?" };

	try {
		await assertCanEditTree(auth.userId, treeId);

		// The owner is not a member row and must not be removable: a graph with no owner
		// has nobody who can invite, revoke, or delete it.
		const [tree] = await db
			.select({ ownerId: trees.ownerId })
			.from(trees)
			.where(eq(trees.id, treeId))
			.limit(1);
		if (tree?.ownerId === userId) {
			return { ok: false, error: "The owner of a graph cannot be removed from it." };
		}

		await db
			.delete(treeMembers)
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, userId)));

		revalidatePath("/tree");
		return { ok: true };
	} catch (error) {
		if (error instanceof NotAllowedError) return { ok: false, error: error.message };
		throw error;
	}
}

export type ShareState = {
	members: { userId: string; name: string; role: string; isOwner: boolean }[];
	invites: { id: string; addressedTo: string; role: string; expiresAt: string }[];
};

/** Who currently has access, and who has been invited but not yet arrived. */
export async function shareState(treeId: string): Promise<ShareState> {
	const auth = await sharer();
	if ("error" in auth) return { members: [], invites: [] };

	try {
		await assertCanEditTree(auth.userId, treeId);
	} catch {
		return { members: [], invites: [] };
	}

	const [tree] = await db
		.select({ ownerId: trees.ownerId })
		.from(trees)
		.where(eq(trees.id, treeId))
		.limit(1);

	const memberRows = await db
		.select({ userId: treeMembers.userId, role: treeMembers.role })
		.from(treeMembers)
		.where(eq(treeMembers.treeId, treeId));

	// The owner plus every member, so the list answers "who can see this" completely --
	// the owner has no member row, and omitting them would make the list look shorter
	// than the truth.
	const ids = [...new Set([tree?.ownerId, ...memberRows.map((r) => r.userId)].filter(Boolean))];
	const nameRows =
		ids.length > 0
			? await db
					.select({ id: users.id, name: users.name, email: users.email })
					.from(users)
					.where(inArray(users.id, ids as string[]))
			: [];
	const nameById = new Map(nameRows.map((r) => [r.id, r.name ?? r.email]));

	const members: ShareState["members"] = [];
	if (tree?.ownerId) {
		members.push({
			userId: tree.ownerId,
			name: nameById.get(tree.ownerId) ?? "Unknown",
			role: "owner",
			isOwner: true,
		});
	}
	for (const row of memberRows) {
		if (row.userId === tree?.ownerId) continue;
		members.push({
			userId: row.userId,
			name: nameById.get(row.userId) ?? "Unknown",
			role: row.role,
			isOwner: false,
		});
	}

	const inviteRows = await db
		.select({
			id: treeInvites.id,
			email: treeInvites.email,
			githubLogin: treeInvites.githubLogin,
			role: treeInvites.role,
			expiresAt: treeInvites.expiresAt,
		})
		.from(treeInvites)
		.where(and(eq(treeInvites.treeId, treeId), eq(treeInvites.status, "pending")));

	return {
		members,
		invites: inviteRows.map((row) => ({
			id: row.id,
			addressedTo: row.email ?? (row.githubLogin ? `@${row.githubLogin}` : "unknown"),
			role: row.role,
			// Date only. A time would imply a precision nobody needs and would render
			// differently for the inviter and the invitee.
			expiresAt: row.expiresAt.toISOString().slice(0, 10),
		})),
	};
}
