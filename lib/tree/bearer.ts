/**
 * Resolving an `Authorization: Bearer` header to a user id.
 *
 * This exists so the API can be called from another ORIGIN without turning the
 * session cookie into a cross-site one. That distinction is the whole point, and
 * it is a security decision rather than a plumbing one:
 *
 *   - A cookie-authenticated API needs `SameSite=None` to be reachable from a
 *     different origin, and `credentials: "include"` on every fetch. That sends
 *     the session token on third-party requests to the API host and gives up the
 *     CSRF protection `SameSite=Lax` was providing for free.
 *   - A bearer token is sent only when this app's own code chooses to send it.
 *     There is no ambient credential for another site to trigger, so CORS needs
 *     no `Allow-Credentials` and the cookie stays `Lax`.
 *
 * No new token store was introduced, deliberately. With `strategy: "database"`
 * Auth.js already writes an opaque `crypto.randomUUID()` into `sessions` with an
 * expiry, which is exactly what a bearer token is. Minting a second kind of
 * credential would mean two things to revoke on sign-out, and the one somebody
 * forgets is the one that outlives the session.
 *
 * The trade-off worth stating: a bearer token in a client-readable place is
 * exposed to XSS in a way an httpOnly cookie is not. That is why this module
 * only READS the header -- where the token is kept on the client is a separate
 * decision, and the same-origin UI should keep using the cookie and never hold
 * a copy of the token at all.
 */
import { and, eq, gt } from "drizzle-orm";
import { db, hasDatabase } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { bearerToken } from "./bearer-header";

export { bearerToken };

/**
 * The user this token belongs to, or null.
 *
 * Null covers every failure identically -- absent header, wrong scheme, unknown
 * token, expired token -- because distinguishing them for the caller would let a
 * caller distinguish them too, and "this token existed but expired" is more than
 * an unauthenticated request needs to be told.
 */
export async function userIdFromBearer(header: string | null): Promise<string | null> {
	const token = bearerToken(header);
	if (!token) return null;
	// Without a database there is nothing to look a session up in, and Auth.js
	// would log a config error rather than return a useful answer.
	if (!hasDatabase()) return null;

	const rows = await db
		.select({ userId: sessions.userId })
		.from(sessions)
		.where(
			and(
				eq(sessions.sessionToken, token),
				// Expiry is enforced in the QUERY, not after the fetch. A row read and
				// then compared in application code is a row that exists for a moment
				// in a shape the caller might use; letting Postgres refuse it means an
				// expired session simply has no answer.
				gt(sessions.expires, new Date()),
			),
		)
		.limit(1);

	return rows[0]?.userId ?? null;
}
