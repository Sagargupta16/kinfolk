/**
 * Auth.js v5 with GitHub OAuth.
 *
 * GitHub is the only provider: the sharing model is "invite a relative", and a
 * GitHub handle is a stable, guessable identifier that people already share.
 * The trade-off is real (non-technical relatives may not have an account), so
 * invites also accept a plain email address.
 */
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { db, hasDatabase } from "@/lib/db/client";
import { accounts, sessions, users } from "@/lib/db/schema";
import { claimInvites, provisionGraph } from "@/lib/tree/provision";

/**
 * Our own cookie name, and it is a bug fix rather than a preference.
 *
 * Auth.js defaults to `authjs.session-token`, and cookies are scoped by HOST, never
 * by port -- so every Auth.js app on localhost writes and reads the same name. Any
 * other one of them signing in leaves a cookie that Kinfolk then presents to its own
 * adapter as a session token.
 *
 * That fails loudly rather than quietly, because the two strategies mint different
 * things. Database sessions are `crypto.randomUUID()` (@auth/core lib/init.js), so a
 * JWT-strategy app's 627-character JWE arrives where a 36-character uuid belongs, and
 * the lookup surfaces as an AdapterError on a page the visitor never signed in to.
 * Namespacing the cookie means a neighbour's session is simply not ours to read.
 */
const SESSION_COOKIE = "kinfolk.session-token";

export const { handlers, auth, signIn, signOut } = NextAuth({
	adapter: DrizzleAdapter(db, {
		usersTable: users,
		accountsTable: accounts,
		sessionsTable: sessions,
	}),
	providers: [GitHub],
	session: { strategy: "database" },
	// Merged over the defaults by @auth/core, so naming one cookie leaves the callback,
	// csrf and pkce cookies at their own defaults. Only the session token can be
	// mistaken for another app's, because it is the only one we hand to a database.
	cookies: {
		sessionToken: {
			name: SESSION_COOKIE,
			options: {
				httpOnly: true,
				sameSite: "lax",
				path: "/",
				// Derived, not hardcoded false. This was `false` unconditionally, which is
				// correct for `http://localhost` and wrong the moment the app is deployed:
				// a session token without `Secure` is sent over plain HTTP, so anything
				// that can downgrade a request can read it. Production is HTTPS-only.
				secure: process.env.NODE_ENV === "production",
			},
		},
	},
	/**
	 * Make a failed sign-in say WHY, in the server log.
	 *
	 * Auth.js answers every callback failure with `?error=Configuration` and a page
	 * reading "There is a problem with the server configuration". That string is
	 * generic to the point of being misleading: a nonexistent provider, a rejected
	 * database insert and a genuinely absent secret all produce it, so a failure
	 * cannot be told apart from outside. Diagnosing one meant probing endpoints and
	 * inferring, because the only real error never left the process.
	 *
	 * `logger.error` writes the underlying cause to the platform log, where it is
	 * one search away. Deliberately NOT `debug: true`: that logs every callback and
	 * token exchange at info level, which on an auth route means access tokens and
	 * profile payloads sitting in a log nobody intended as a secret store.
	 */
	logger: {
		error(error) {
			console.error("[auth]", error.name, error.message, error.cause ?? "");
		},
	},
	callbacks: {
		async session({ session, user }) {
			// Expose the user id so server actions can authorise without a second
			// lookup on every request.
			if (session.user) session.user.id = user.id;
			return session;
		},
	},
	events: {
		/**
		 * Give a brand new account something to look at.
		 *
		 * Without this, first sign-in lands on an empty state with no way forward: the
		 * editor does not exist yet, so "add your first relative" is not an action
		 * anybody can take, and the one screen a new user sees would be a dead end.
		 *
		 * In `createUser` rather than in the page, and that placement is what keeps it
		 * correct. It fires exactly once in the account's lifetime, inside Auth.js's own
		 * sign-in flow -- where provisioning from a page render would run on every visit
		 * and have to re-derive "is this the first one" from the data each time.
		 */
		async createUser({ user }) {
			if (!user.id) return;
			await provisionGraph(user.id, user.name ?? null);
		},
		/**
		 * Cache the GitHub handle, and turn any invites addressed to this person into
		 * access.
		 *
		 * On `signIn` rather than `createUser`, because both jobs recur. Somebody can be
		 * invited long after their first sign-in, so a claim that only ran at account
		 * creation would silently never arrive for anybody but brand new users -- and the
		 * owner would see a pending invite they had definitely sent.
		 *
		 * The handle is stored because invites are addressed by GitHub login, and the
		 * OAuth profile is the only place it appears. Without caching it, an invite sent
		 * to `@someone` could never be matched to the account that owns that name.
		 */
		async signIn({ user, profile }) {
			if (!user.id) return;
			const login = typeof profile?.login === "string" ? profile.login : null;
			if (login) {
				await db.update(users).set({ githubLogin: login }).where(eq(users.id, user.id));
			}
			await claimInvites(user.id, user.email ?? null, login);
		},
	},
	pages: {
		signIn: "/signin",
	},
});

/**
 * The session, or null when there cannot be one.
 *
 * Sessions are stored in the database, so with no DATABASE_URL there is nothing
 * to look one up in -- and calling `auth()` anyway logs an Auth.js config error
 * on every render of every page. Reading the demo tree does not need auth, so
 * this is the entry point pages should use.
 */
export async function sessionOrNull(): Promise<Session | null> {
	if (!hasDatabase()) return null;
	return auth();
}
