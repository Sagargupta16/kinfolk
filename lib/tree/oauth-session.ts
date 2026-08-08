/**
 * Turning a GitHub profile into a Kinfolk user, account and session.
 *
 * This is the part Auth.js normally does inside its own callback. The SPA flow
 * cannot use that handler -- it returns the browser to the API host, which is the
 * whole thing being avoided -- so the rows are written here instead.
 *
 * Written to be INDISTINGUISHABLE from what the Drizzle adapter produces, because
 * both flows share one database and one set of pages. A session minted here has to
 * work for a server-rendered `/tree`, and a user created by the server-rendered
 * sign-in has to work for the SPA. Two shapes would mean two classes of account,
 * and the difference would surface as a bug months later.
 *
 * Sequenced rather than transactional, because the Neon HTTP driver has no
 * transactions -- `db.transaction()` type-checks and throws at runtime. So the order
 * is chosen for its failure modes: a user with no account is a user who can sign in
 * again and get one, whereas an account row pointing at a missing user is a foreign
 * key violation. Provisioning is last and swallows its own errors, exactly as the
 * Auth.js event does, because a failed graph must not cost somebody their session.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, sessions, users } from "@/lib/db/schema";
import type { GitHubProfile } from "./oauth-github";
import { claimInvites, provisionGraph } from "./provision";

/** Thirty days, matching the Auth.js default so the two flows expire alike. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SignInResult = {
	token: string;
	expires: Date;
	userId: string;
	isNewUser: boolean;
};

export async function signInWithGitHub(profile: GitHubProfile): Promise<SignInResult> {
	const existing = await findUser(profile);
	const isNewUser = !existing;

	const userId = existing ?? (await createUser(profile));

	// Link the provider account if this is the first time, and refresh the cached
	// handle every time -- somebody can rename themselves on GitHub, and an invite
	// addressed to the new handle would never match a stale one.
	await linkAccount(userId, profile);
	await db.update(users).set({ githubLogin: profile.login }).where(eq(users.id, userId));

	const token = crypto.randomUUID();
	const expires = new Date(Date.now() + SESSION_TTL_MS);
	await db.insert(sessions).values({ sessionToken: token, userId, expires });

	// Last, and both swallow their own failures. Provision on every sign-in so a
	// callback that created only part of the starter graph gets another repair chance;
	// a thrown error here must not discard the valid session row already written.
	await provisionGraph(userId, profile.name);
	await claimInvites(userId, profile.email, profile.login);

	return { token, expires, userId, isNewUser };
}

/**
 * The existing user for this GitHub identity, if any.
 *
 * By `providerAccountId` FIRST, which is the only stable identifier -- an email can
 * be changed or removed on GitHub, and matching on it alone would hand somebody
 * else's account to whoever claimed a recycled address.
 *
 * Falling back to email is what lets a user who first signed in through the
 * server-rendered flow arrive here and land on the same account rather than a
 * duplicate. `users.email` is unique, so a duplicate would fail loudly anyway --
 * but failing loudly at sign-in is still a broken sign-in.
 */
async function findUser(profile: GitHubProfile): Promise<string | null> {
	const linked = await db
		.select({ userId: accounts.userId })
		.from(accounts)
		.where(
			and(
				eq(accounts.provider, "github"),
				eq(accounts.providerAccountId, profile.providerAccountId),
			),
		)
		.limit(1);
	if (linked[0]) return linked[0].userId;

	if (profile.email) {
		const byEmail = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, profile.email))
			.limit(1);
		if (byEmail[0]) return byEmail[0].id;
	}

	return null;
}

async function createUser(profile: GitHubProfile): Promise<string> {
	const [row] = await db
		.insert(users)
		.values({
			name: profile.name,
			// Nullable on purpose: a GitHub account with no verified address yields
			// none, and refusing the sign-in for a field nothing requires would be
			// worse than storing null.
			email: profile.email,
			image: profile.avatarUrl,
			githubLogin: profile.login,
		})
		.returning({ id: users.id });
	if (!row) throw new Error("Could not create the user record.");
	return row.id;
}

/**
 * The `accounts` row, written once.
 *
 * The access token is deliberately NOT stored. Auth.js keeps it because a provider
 * refresh may need it; nothing in Kinfolk ever calls GitHub on the user's behalf
 * after sign-in, so persisting a live credential would be storing a secret for no
 * reader -- and a database that holds one is a database worth stealing.
 */
async function linkAccount(userId: string, profile: GitHubProfile): Promise<void> {
	const existing = await db
		.select({ userId: accounts.userId })
		.from(accounts)
		.where(
			and(
				eq(accounts.provider, "github"),
				eq(accounts.providerAccountId, profile.providerAccountId),
			),
		)
		.limit(1);
	if (existing[0]) return;

	await db.insert(accounts).values({
		userId,
		type: "oauth",
		provider: "github",
		providerAccountId: profile.providerAccountId,
		scope: "read:user,user:email",
	});
}
