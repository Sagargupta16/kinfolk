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
import { and, eq, gt, inArray } from "drizzle-orm";
import { signOut } from "@/auth";
import { db } from "../db/client";
import { treeInvites, treeMembers, trees, users } from "../db/schema";
import { assertCanEditTree, assertOwnsTree, NotAllowedError } from "./authz";
import { DEMO_COOKIE } from "./demo";
import { isUuid } from "./ids";
import { normalizeGitHubLogin, parseInviteRole } from "./invite";
import { withinHourlyBudget } from "./rate-limit";
import { inDemo, requestUserId } from "./request-user";
import type { Result } from "./result";
import type { ShareState } from "./sharing";

export type { ShareState } from "./sharing";

/** How long an unclaimed invite stays valid. */
const INVITE_DAYS = 14;

/** A GitHub username: letters, digits and single inner hyphens, at most 39 characters. */
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;

/**
 * Sign out.
 *
 * Wrapped rather than calling `signOut` from a component, because it has to clear the
 * DEMO COOKIE too. Otherwise signing out of a real session drops the viewer back into
 * sample data -- the demo cookie outlives the session, and `/tree` prefers a session but
 * falls back to the cookie, so the person would land on somebody else's family and be
 * told it was theirs.
 *
 * Shaped for `useActionState`, which hands it the previous message and the form, so the
 * menu can say when the SPA's version of this fails. This one never returns a message:
 * Auth.js's `signOut` ends in Next's redirect, which must reach the framework, so
 * nothing here may catch it.
 */
export async function leave(_previous: string | null, _form?: FormData): Promise<string | null> {
	const { cookies } = await import("next/headers");
	const store = await cookies();
	store.delete(DEMO_COOKIE);
	// `redirectTo` rather than a bare signOut: Auth.js otherwise returns to the current
	// URL, which is /tree, which immediately redirects to /signin -- two navigations to
	// reach the page it could have gone to directly.
	await signOut({ redirectTo: "/" });
	return null;
}

async function sharer(): Promise<{ userId: string } | { error: string }> {
	const userId = await requestUserId();
	if (userId) return { userId };
	return {
		error: (await inDemo())
			? "This is sample data. Sign in to share a graph of your own."
			: "Sign in to share.",
	};
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
 * NotAllowedError as the panel's message. Anything else is logged by name and rethrown
 * bare, because a failed query's message carries its bound values -- here an invitee's
 * email address -- and Next logs whatever an action throws.
 */
function refuse(error: unknown, action: string): Result {
	if (error instanceof NotAllowedError) return { ok: false, error: error.message };
	console.error(`[share] ${action} failed`);
	throw new Error(`${action} failed`);
}

/**
 * Invite somebody to a graph.
 *
 * Role defaults to `viewer`, which is the narrowest: seeing a family graph is already a
 * lot, and edit rights should be a deliberate second decision rather than the default
 * that happens when nobody thought about it.
 *
 * Only the OWNER may invite. A viewer sharing onward would route around the owner's
 * decision about who sees their family, and an editor doing it routes around the same
 * decision: editing the records is not deciding who reads them.
 */
export async function invite(form: FormData): Promise<Result> {
	const auth = await sharer();
	if ("error" in auth) return { ok: false, error: auth.error };

	const treeId = String(form.get("treeId") ?? "");
	const email = String(form.get("email") ?? "")
		.trim()
		.toLowerCase();
	const githubLoginValue = form.get("githubLogin");
	const githubLogin = normalizeGitHubLogin(
		typeof githubLoginValue === "string" ? githubLoginValue : null,
	);
	const role = parseInviteRole(form.get("role"));

	if (!isUuid(treeId)) return { ok: false, error: "Which graph?" };
	if (!email && !githubLogin) {
		return { ok: false, error: "An email address or a GitHub username, so we know who to invite." };
	}
	if (!role) return { ok: false, error: "Invite access must be viewer or editor." };
	if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
		return { ok: false, error: "That does not look like an email address." };
	}
	if (githubLogin && !GITHUB_LOGIN.test(githubLogin)) {
		return { ok: false, error: "That does not look like a GitHub username." };
	}

	try {
		await assertOwnsTree(auth.userId, treeId);
		const budget = await withinHourlyBudget("invites", treeId);
		if (!budget.ok) return budget;

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

		// No revalidatePath here or below: nothing the tree page draws depends on who has
		// access, and the panel re-reads its own state after every change.
		//
		// There is no mail sender yet, so say so rather than implying one was sent. A
		// "invite sent" message for an email that never leaves the building is the kind of
		// lie that costs a user a week of waiting.
		return {
			ok: true,
			id: "Invite recorded. They will get access the first time they sign in with that address or username.",
		};
	} catch (error) {
		return refuse(error, "invite");
	}
}

/** Withdraw an invite that has not been claimed. */
export async function revokeInvite(form: FormData): Promise<Result> {
	const auth = await sharer();
	if ("error" in auth) return { ok: false, error: auth.error };

	const inviteId = String(form.get("inviteId") ?? "");
	if (!isUuid(inviteId)) return { ok: false, error: "Which invite?" };

	try {
		const [row] = await db
			.select({ treeId: treeInvites.treeId })
			.from(treeInvites)
			.where(eq(treeInvites.id, inviteId))
			.limit(1);
		if (!row) return { ok: true };

		await assertOwnsTree(auth.userId, row.treeId);
		// Marked revoked rather than deleted, so a claim attempt can say "that invite was
		// withdrawn" instead of "no such invite", and so the owner keeps a record of who
		// they invited.
		const [revoked] = await db
			.update(treeInvites)
			.set({ status: "revoked" })
			.where(and(eq(treeInvites.id, inviteId), eq(treeInvites.status, "pending")))
			.returning({ id: treeInvites.id });
		if (!revoked) {
			return {
				ok: false,
				error:
					"That invite is no longer pending. If it was claimed, remove the person from Family access instead.",
			};
		}

		return { ok: true };
	} catch (error) {
		return refuse(error, "revokeInvite");
	}
}

/** Remove somebody's access to a graph. */
export async function removeMember(form: FormData): Promise<Result> {
	const auth = await sharer();
	if ("error" in auth) return { ok: false, error: auth.error };

	const treeId = String(form.get("treeId") ?? "");
	const userId = String(form.get("userId") ?? "");
	if (!isUuid(treeId) || !isUuid(userId)) return { ok: false, error: "Which person?" };

	try {
		await assertOwnsTree(auth.userId, treeId);

		// The owner is not a member row and must not be removable: a graph with no owner
		// has nobody who can invite, revoke, or delete it.
		if (userId === auth.userId) {
			return { ok: false, error: "The owner of a graph cannot be removed from it." };
		}

		await db
			.delete(treeMembers)
			.where(and(eq(treeMembers.treeId, treeId), eq(treeMembers.userId, userId)));

		return { ok: true };
	} catch (error) {
		return refuse(error, "removeMember");
	}
}

/**
 * Who currently has access, and who has been invited but not yet arrived.
 *
 * Read by owners and editors alike -- seeing who else can read the family is part of
 * editing it -- while `canManage` keeps the changes to the owner.
 */
export async function shareState(treeId: string): Promise<ShareState> {
	const nothing: ShareState = { canManage: false, members: [], invites: [] };
	const auth = await sharer();
	// Thrown, not answered with an empty list: a session that failed to load is not a
	// graph nobody shares, and the panel must be able to tell the two apart.
	if ("error" in auth) throw new NotAllowedError(auth.error);
	if (!isUuid(treeId)) return nothing;

	try {
		await assertCanEditTree(auth.userId, treeId);
	} catch (error) {
		// Somebody who may not see this graph's access learns nothing about it. Anything
		// else is the database failing, and must read as a failure: an outage shown as
		// "nobody has access" is the panel lying.
		if (error instanceof NotAllowedError) return nothing;
		throw error;
	}

	const [[tree], memberRows, inviteRows] = await Promise.all([
		db.select({ ownerId: trees.ownerId }).from(trees).where(eq(trees.id, treeId)).limit(1),
		db
			.select({ userId: treeMembers.userId, role: treeMembers.role })
			.from(treeMembers)
			.where(eq(treeMembers.treeId, treeId)),
		db
			.select({
				id: treeInvites.id,
				email: treeInvites.email,
				githubLogin: treeInvites.githubLogin,
				role: treeInvites.role,
				expiresAt: treeInvites.expiresAt,
			})
			.from(treeInvites)
			.where(
				and(
					eq(treeInvites.treeId, treeId),
					eq(treeInvites.status, "pending"),
					// An expired invite can never be claimed, so listing it as pending would
					// tell the owner somebody is still on their way.
					gt(treeInvites.expiresAt, new Date()),
				),
			),
	]);

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

	return {
		canManage: tree?.ownerId === auth.userId,
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
