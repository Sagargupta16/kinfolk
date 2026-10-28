/**
 * Whether a client-supplied id can be a row id at all.
 *
 * Checked before any query, because Postgres refuses a malformed uuid with an error
 * (22P02) rather than an empty result: without this, a mistyped or forged id turns a
 * plain "no such person" into a 500.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
	return UUID.test(value);
}
