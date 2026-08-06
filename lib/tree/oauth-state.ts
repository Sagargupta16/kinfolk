/**
 * A CSRF state token that survives serverless, ported from the pattern in
 * `apps/ledger-sync` (`backend/src/ledger_sync/api/oauth.py`).
 *
 * The SPA starts an OAuth flow and GitHub returns the visitor to the SPA, so the
 * `state` parameter has to be verifiable by whichever instance happens to handle
 * the exchange. Two approaches fail here:
 *
 *   - An in-memory set of issued nonces is per-process, so it is empty on a cold
 *     start and different on each concurrent instance. Every sign-in becomes a coin
 *     flip -- the same trap as counting a rate limit in a Map.
 *   - A database row would work but costs a write and a read on the auth path for a
 *     value that lives ten minutes.
 *
 * So the token carries its own proof: `<nonce>.<expiry>.<hmac>`, signed with
 * `AUTH_SECRET`. Any instance can verify it, none has to remember it, and it cannot
 * be forged without the secret.
 *
 * Web Crypto rather than `node:crypto`, so this runs unchanged if a route ever
 * moves to the edge runtime.
 */

/** Ten minutes. Long enough to authorise, short enough that a leaked state is stale. */
const STATE_TTL_MS = 10 * 60 * 1000;

function secret(): string {
	const value = process.env.AUTH_SECRET;
	if (!value) {
		// Loud. Signing with a fallback would produce tokens that verify against a
		// key an attacker could guess, which is worse than refusing to sign at all.
		throw new Error("AUTH_SECRET is required to sign an OAuth state token.");
	}
	return value;
}

function base64url(bytes: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

async function sign(payload: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret()),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

/** A fresh state token for an authorize URL. */
export async function issueState(now = Date.now()): Promise<string> {
	const nonce = crypto.randomUUID();
	const expiry = String(now + STATE_TTL_MS);
	const payload = `${nonce}.${expiry}`;
	return `${payload}.${await sign(payload)}`;
}

/**
 * Whether a returned state is one we issued and still current.
 *
 * The signature is compared in CONSTANT TIME. A plain `===` on an HMAC leaks its
 * bytes through timing, which is the whole reason the comparison is worth writing
 * out rather than inlining.
 *
 * Order matters: the signature is checked BEFORE the expiry, so an unsigned token
 * cannot learn anything from how the expiry was parsed.
 */
export async function verifyState(state: string | null, now = Date.now()): Promise<boolean> {
	if (!state) return false;

	const parts = state.split(".");
	if (parts.length !== 3) return false;
	const [nonce, expiry, signature] = parts as [string, string, string];
	if (!nonce || !expiry || !signature) return false;

	const expected = await sign(`${nonce}.${expiry}`);
	if (!constantTimeEqual(signature, expected)) return false;

	const at = Number(expiry);
	if (!Number.isFinite(at)) return false;
	return at > now;
}

function constantTimeEqual(a: string, b: string): boolean {
	// Length is not secret -- both are fixed-width base64url of a SHA-256 -- but a
	// mismatch must still not short-circuit the loop below.
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}
