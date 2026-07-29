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
 * Called from the `createUser` event in auth.ts, so it runs once per account inside
 * Auth.js's own sign-in flow.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { people, trees } from "../db/schema";

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
 * Idempotent by checking for an existing tree first. `createUser` should fire once,
 * but a retried OAuth callback must not leave somebody with two graphs -- and the
 * unique index on (ownerId, slug) would turn the second attempt into a failed
 * sign-in rather than a duplicate, which is a worse outcome than a no-op.
 *
 * Errors are swallowed deliberately. This runs inside the sign-in flow, and a failed
 * convenience must not cost the user their session: without the catch, a transient
 * database blip during provisioning would surface as a broken sign-in, where the
 * honest fallback is the empty state that already exists for this case.
 */
export async function provisionGraph(userId: string, name: string | null): Promise<void> {
	try {
		const existing = await db
			.select({ id: trees.id })
			.from(trees)
			.where(eq(trees.ownerId, userId))
			.limit(1);
		if (existing.length > 0) return;

		const [tree] = await db
			.insert(trees)
			.values({
				name: name ? `${name.split(" ")[0]}'s people` : "My people",
				slug: slugify(name),
				ownerId: userId,
			})
			.returning({ id: trees.id });
		// `.returning()` is typed as an array, so the rows have to be checked rather than
		// asserted. Bailing leaves the account with no graph, which the empty state already
		// handles -- a non-null assertion here would turn the same condition into a crash
		// inside the OAuth callback.
		if (!tree) return;

		// `claimedByUserId` is what makes this node "you" everywhere downstream: the
		// kinship walk starts from it, the canvas frames on it, and the "You" button
		// returns to it. A person row without it would render as just another card.
		const [self] = await db
			.insert(people)
			.values({
				treeId: tree.id,
				givenName: name?.split(" ")[0] ?? "You",
				familyName: name?.split(" ").slice(1).join(" ") || null,
				living: "living",
				claimedByUserId: userId,
				// The person themselves is signed in and saying so, which is a stronger
				// claim than the `unverified` default and is what that level means.
				verification: "self_confirmed",
			})
			.returning({ id: people.id });
		// A graph with no self node is still usable -- it just has nothing in it -- so this
		// returns rather than unwinding the tree row it already wrote.
		if (!self) return;

		// The canvas opens centred here. Set after the insert rather than in the tree
		// row above, because the person cannot be referenced before it exists.
		await db.update(trees).set({ rootPersonId: self.id }).where(eq(trees.id, tree.id));
	} catch {
		// Left to the empty state, which is a correct screen for "no graph yet".
	}
}
