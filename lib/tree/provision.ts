/**
 * What a brand new account gets.
 *
 * Signing in for the first time used to land on an empty state, and an empty state
 * is a worse first screen here than in most apps: the editor does not exist yet, so
 * "add your first relative" is not an action anybody can take. The one screen a new
 * user saw was a dead end.
 *
 * So the account arrives with a graph containing exactly one node -- them. That is
 * the smallest thing that is still true. Seeding invented relatives would put claims
 * in a genealogy database that nobody made, which is the one thing this schema exists
 * to prevent; seeding nothing leaves a canvas that cannot demonstrate it works.
 *
 * Called from both account creation and recurring sign-in paths. The latter repairs
 * partial first-sign-in writes without making a transient provisioning failure cost
 * the visitor their session.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { people, trees } from "../db/schema";
import { normalizeGitHubLogin } from "./invite";

/**
 * A url-safe slug from a display name.
 *
 * Only the slug is derived from the name -- never the person's `sex`, which stays
 * `unknown` until they say otherwise. Guessing gender from a name is exactly the
 * assertion kinship.ts refuses to make, and it would be a stored value rather than a
 * rendering choice, so it would outlive the guess.
 */
function slugify(name: string | null): string {
	const base = (name ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	return base || "my-people";
}

/**
 * Create a first graph and a self node for a new user.
 *
 * Idempotent by reusing an existing tree and looking for its claimed self person.
 * `createUser` should fire once, but a retried OAuth callback must not leave somebody
 * with two graphs -- and it must also finish a first callback that inserted the tree
 * before a transient failure stopped the self person or root pointer from landing.
 *
 * Errors are swallowed deliberately. This runs inside the sign-in flow, and a failed
 * convenience must not cost the user their session: without the catch, a transient
 * database blip during provisioning would surface as a broken sign-in, where the
 * honest fallback is the empty state that already exists for this case.
 */
export async function provisionGraph(userId: string, name: string | null): Promise<void> {
	try {
		// Reuse an existing claimed row and repair the smaller partial state where the
		// self exists but the root update failed.
		const [claimedSelf] = await db
			.select({ id: people.id, treeId: people.treeId })
			.from(people)
			.where(eq(people.claimedByUserId, userId))
			.limit(1);
		if (claimedSelf) {
			await db
				.update(trees)
				.set({ rootPersonId: claimedSelf.id })
				.where(
					and(
						eq(trees.id, claimedSelf.treeId),
						eq(trees.ownerId, userId),
						isNull(trees.rootPersonId),
					),
				);
			return;
		}

		const [existing] = await db
			.select({ id: trees.id })
			.from(trees)
			.where(eq(trees.ownerId, userId))
			.limit(1);

		let treeId = existing?.id ?? null;
		if (!treeId) {
			const slug = slugify(name);
			const [created] = await db
				.insert(trees)
				.values({
					name: name ? `${name.split(" ")[0]}'s people` : "My people",
					slug,
					ownerId: userId,
				})
				.onConflictDoNothing({ target: [trees.ownerId, trees.slug] })
				.returning({ id: trees.id });

			if (created) {
				treeId = created.id;
			} else {
				const [winner] = await db
					.select({ id: trees.id })
					.from(trees)
					.where(and(eq(trees.ownerId, userId), eq(trees.slug, slug)))
					.limit(1);
				treeId = winner?.id ?? null;
			}
		}
		if (!treeId) return;

		// `claimedByUserId` makes this node "you" downstream. Reusing the user's UUID as
		// this starter row's primary key makes concurrent retries conflict safely even
		// during the rollout window before the claimed-user index exists. Once migration
		// 0003 lands, that index remains the database backstop for every other write path.
		const [createdSelf] = await db
			.insert(people)
			.values({
				id: userId,
				treeId,
				givenName: name?.split(" ")[0] ?? "You",
				familyName: name?.split(" ").slice(1).join(" ") || null,
				living: "living",
				claimedByUserId: userId,
				verification: "self_confirmed",
			})
			.onConflictDoNothing()
			.returning({ id: people.id, treeId: people.treeId });
		const [winner] = createdSelf
			? [createdSelf]
			: await db
					.select({ id: people.id, treeId: people.treeId })
					.from(people)
					.where(eq(people.claimedByUserId, userId))
					.limit(1);
		if (!winner || winner.treeId !== treeId) return;

		// A stale read must not replace a root selected between the read and this write.
		await db
			.update(trees)
			.set({ rootPersonId: winner.id })
			.where(and(eq(trees.id, treeId), eq(trees.ownerId, userId), isNull(trees.rootPersonId)));
	} catch {
		// Left to the empty state; the next successful sign-in retries this repair.
	}
}

/**
 * Turn pending invites addressed to this person into real access.
 *
 * Invites are addressed by email or GitHub login rather than by user id, because the
 * invitee usually has no account when they are invited -- so this is where the address
 * becomes a grant. It runs on every SIGN IN, not only on account creation: somebody may
 * be invited long after they first signed in, and a grant that only ever landed for brand
 * new accounts would silently never arrive for everybody else.
 *
 * Matching is on a lowercased email or a de-@'d login. Both are stored as given, so
 * comparing raw values would miss `Ada@Example.com` against `ada@example.com` -- and a
 * missed invite looks to the user like the owner never sent one.
 */
export async function claimInvites(
	userId: string,
	email: string | null,
	githubLogin: string | null,
): Promise<number> {
	try {
		const address = email?.trim().toLowerCase() ?? null;
		const login = normalizeGitHubLogin(githubLogin);
		if (!address && !login) return 0;

		// Claim and grant in one statement. The conditional UPDATE locks the invite,
		// so a concurrent withdrawal cannot be overwritten by a stale pending read.
		const result = await db.execute<{ count: number }>(sql`
			WITH claimed AS (
				UPDATE tree_invites SET status = 'accepted', as_person_id = NULL
				WHERE status = 'pending' AND expires_at > now()
					AND (
						(${address}::text IS NOT NULL AND email = ${address})
						OR (${login}::text IS NOT NULL AND lower(github_login) = ${login})
					)
				RETURNING tree_id, role
			), granted AS (
				INSERT INTO tree_members (tree_id, user_id, role)
				SELECT tree_id, ${userId}::uuid, role FROM claimed
				ON CONFLICT DO NOTHING
				RETURNING tree_id
			)
			SELECT count(*)::integer AS count FROM claimed
		`);
		return Number(result.rows[0]?.count ?? 0);
	} catch {
		// Same reasoning as provisionGraph: this runs inside the sign-in flow, and a failed
		// grant must not cost somebody their session. They can sign in again to retry.
		return 0;
	}
}
