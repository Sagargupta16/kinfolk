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
import { SESSION_MAX_AGE_MS } from "./session-lifetime";

type SignInResult = {
	token: string;
	expires: Date;
	userId: string;
	isNewUser: boolean;
};

/**
 * A GitHub identity whose email belongs to a Kinfolk user with a GitHub account of
 * their own. Refused, as Auth.js refuses the same case with `OAuthAccountNotLinked`.
 */
export class AccountConflict extends Error {
	constructor() {
		super(
			"Another Kinfolk account already uses this GitHub account's email address. Sign in with the GitHub account that created it.",
		);
		this.name = "AccountConflict";
	}
}

export async function signInWithGitHub(profile: GitHubProfile): Promise<SignInResult> {
	let userId = await accountOwner(profile.providerAccountId);
	let isNewUser = false;

	if (!userId) {
		const repaired = await accountlessUser(profile);
		const candidate = repaired ?? (await createUser(profile));
		userId = await linkAccount(candidate, profile);
		isNewUser = !repaired && userId === candidate;
		// Two first sign-ins raced and the other one linked first. The user made here
		// has nothing attached yet, so it is removed rather than left as an orphan.
		if (!repaired && userId !== candidate) await db.delete(users).where(eq(users.id, candidate));
	}

	// Refresh the cached handle every time -- somebody can rename themselves on GitHub,
	// and an invite addressed to the new handle would never match a stale one.
	await db.update(users).set({ githubLogin: profile.login }).where(eq(users.id, userId));

	const token = crypto.randomUUID();
	const expires = new Date(Date.now() + SESSION_MAX_AGE_MS);
	await db.insert(sessions).values({ sessionToken: token, userId, expires });

	// Last, and both swallow their own failures. Provision on every sign-in so a
	// callback that created only part of the starter graph gets another repair chance;
	// a thrown error here must not discard the valid session row already written.
	await provisionGraph(userId, profile.name);
	await claimInvites(userId, profile.email, profile.login);

	return { token, expires, userId, isNewUser };
}

/**
 * The user this GitHub identity already signs in as, if any.
 *
 * By `providerAccountId`, the only stable identifier. Both flows store GitHub's
 * numeric id there, so a user who first signed in through the server-rendered app is
 * found here too.
 */
async function accountOwner(providerAccountId: string): Promise<string | null> {
	const [linked] = await db
		.select({ userId: accounts.userId })
		.from(accounts)
		.where(and(eq(accounts.provider, "github"), eq(accounts.providerAccountId, providerAccountId)))
		.limit(1);
	return linked?.userId ?? null;
}

/**
 * A user with this email and NO GitHub account, which only a half-finished first
 * sign-in leaves behind: the user row was written and the account row was not.
 *
 * An email alone proves nothing about WHICH GitHub account is signing in. An address
 * can leave one account and be verified on another, so linking whoever holds it now
 * to a user who already has a GitHub account would hand that user's family to a
 * stranger. That case is refused; `users.email` is unique, so creating a second user
 * for the address is not an option either.
 */
async function accountlessUser(profile: GitHubProfile): Promise<string | null> {
	if (!profile.email) return null;
	const [byEmail] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, profile.email))
		.limit(1);
	if (!byEmail) return null;

	const [github] = await db
		.select({ userId: accounts.userId })
		.from(accounts)
		.where(and(eq(accounts.userId, byEmail.id), eq(accounts.provider, "github")))
		.limit(1);
	if (github) throw new AccountConflict();
	return byEmail.id;
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
 * The `accounts` row, written once, and the user it belongs to.
 *
 * Inserted with ON CONFLICT DO NOTHING on the provider key instead of checked first,
 * because two first sign-ins can race: both find no account and both create a user.
 * Whichever links first owns the identity, and the other must sign in as THAT user
 * rather than as the account-less one it just made.
 *
 * The access token is deliberately NOT stored. Auth.js keeps it because a provider
 * refresh may need it; nothing in Kinfolk ever calls GitHub on the user's behalf
 * after sign-in, so persisting a live credential would be storing a secret for no
 * reader -- and a database that holds one is a database worth stealing.
 */
async function linkAccount(userId: string, profile: GitHubProfile): Promise<string> {
	const [inserted] = await db
		.insert(accounts)
		.values({
			userId,
			type: "oauth",
			provider: "github",
			providerAccountId: profile.providerAccountId,
			scope: "read:user,user:email",
		})
		.onConflictDoNothing()
		.returning({ userId: accounts.userId });
	if (inserted) return inserted.userId;

	const owner = await accountOwner(profile.providerAccountId);
	if (!owner) throw new Error("The GitHub account link was not recorded.");
	return owner;
}
