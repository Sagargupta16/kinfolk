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
import { SESSION_MAX_AGE_SECONDS } from "@/lib/tree/session-lifetime";

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
	session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS },
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
	 * Record that Auth.js failed without serializing its error object. Adapter errors
	 * can contain SQL, bound profile values, and nested provider details; those do not
	 * belong in a platform log. Deliberately NOT `debug: true` for the same reason.
	 */
	logger: {
		error() {
			console.error("[auth] authentication failed");
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
		 * Refresh recurring account state, repair partial provisioning, and claim invites.
		 *
		 * All three belong on `signIn`: a transient first-sign-in failure must be repaired
		 * later, somebody can be invited after account creation, and GitHub handles can
		 * change. The provisioning path is conflict-safe and becomes a read-only lookup
		 * once the person's graph is complete.
		 */
		async signIn({ user, profile }) {
			if (!user.id) return;
			const login = typeof profile?.login === "string" ? profile.login : null;
			if (login) {
				await db.update(users).set({ githubLogin: login }).where(eq(users.id, user.id));
			}
			await provisionGraph(user.id, user.name ?? null);
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
