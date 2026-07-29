/**
 * Auth.js v5 with GitHub OAuth.
 *
 * GitHub is the only provider: the sharing model is "invite a relative", and a
 * GitHub handle is a stable, guessable identifier that people already share.
 * The trade-off is real (non-technical relatives may not have an account), so
 * invites also accept a plain email address.
 */
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Session } from "next-auth";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { db, hasDatabase } from "@/lib/db/client";
import { accounts, sessions, users } from "@/lib/db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
	adapter: DrizzleAdapter(db, {
		usersTable: users,
		accountsTable: accounts,
		sessionsTable: sessions,
	}),
	providers: [GitHub],
	session: { strategy: "database" },
	callbacks: {
		async session({ session, user }) {
			// Expose the user id so server actions can authorise without a second
			// lookup on every request.
			if (session.user) session.user.id = user.id;
			return session;
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
