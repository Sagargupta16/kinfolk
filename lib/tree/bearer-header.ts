/**
 * Parsing an `Authorization: Bearer` header. Pure string handling, no imports.
 *
 * Split from [bearer.ts](bearer.ts) so it can be tested without a database. That
 * file imports the Drizzle client, which needs `DATABASE_URL` at module scope, so
 * a test importing the parser through it fails on a fresh clone -- and the parser
 * is the half that most needs asserting, because a lenient parser on the
 * authentication path is a vulnerability rather than a rough edge.
 */

/**
 * The token out of an `Authorization` header, or null.
 *
 * Only the scheme is case-insensitive, because RFC 7235 says the scheme is. The
 * token itself is matched exactly and nothing else is forgiven: no empty token,
 * no second value, no other scheme, no unwrapping of quotes or percent-encoding.
 * A stored session token is an opaque `crypto.randomUUID()`, so any shape we did
 * not issue should not become a database lookup key.
 */
export function bearerToken(header: string | null): string | null {
	if (!header) return null;
	const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
	return match?.[1] ?? null;
}
