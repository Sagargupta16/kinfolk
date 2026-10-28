/**
 * The Postgres error code behind a failed query, read without touching its message.
 *
 * Drizzle wraps the driver's error, which carries the code, and its own message spells
 * out the query AND its bound parameters -- a phone number, an address, a session token.
 * So callers branch on the code and log the code, never the error.
 */
export function postgresCode(error: unknown): string | null {
	let current = error;
	for (let depth = 0; depth < 3; depth += 1) {
		if (!current || typeof current !== "object") return null;
		const candidate = current as { code?: unknown; cause?: unknown };
		if (typeof candidate.code === "string") return candidate.code;
		current = candidate.cause;
	}
	return null;
}

/** A unique index refused the row. */
export const UNIQUE_VIOLATION = "23505";
