/**
 * Where the API is, and the credential sent to it.
 *
 * ## The security trade, stated rather than buried
 *
 * The Next app authenticates with an httpOnly session cookie, which JavaScript
 * cannot read, so an injected script cannot steal it. A static SPA on a different
 * origin cannot use that cookie: it would need `SameSite=None`, which sends the
 * session token on third-party requests and gives up its CSRF protection.
 *
 * So this holds a bearer token in `sessionStorage`, and that IS weaker: any script
 * running on the page can read it. The mitigations are real but partial --
 * `sessionStorage` rather than `localStorage`, so the token dies with the tab
 * instead of persisting; the CSP on the API host; and the token being the same
 * `sessions` row that sign-out deletes, so revocation is immediate and total.
 *
 * This is the same posture as `apps/ledger-sync`, which keeps a bearer token
 * client-side for the same reason. It is the cost of a static frontend, not an
 * oversight, and the server-rendered app at the Vercel origin remains available
 * for anybody who would rather have the cookie.
 */

/**
 * The API origin.
 *
 * Baked in at build time by Vite, exactly like ledger-sync's `VITE_API_BASE_URL`.
 * Empty in dev, where the Vite proxy serves `/api` from the same origin, so no CORS
 * and no absolute URL is involved locally.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

const TOKEN_KEY = "kinfolk.token";

export function getToken(): string | null {
	try {
		return sessionStorage.getItem(TOKEN_KEY);
	} catch {
		// Storage can throw in a private-mode iframe. A missing token is a signed-out
		// visitor, which is a state this app already renders.
		return null;
	}
}

export function setToken(token: string): boolean {
	try {
		sessionStorage.setItem(TOKEN_KEY, token);
		return true;
	} catch {
		return false;
	}
}

export function clearToken(): void {
	try {
		sessionStorage.removeItem(TOKEN_KEY);
	} catch {}
}

/**
 * `Authorization`, when there is a token.
 *
 * Returns a bare object rather than `undefined` so callers can always spread it.
 * Deliberately never sets `credentials: "include"` anywhere in this app -- that is
 * the line that would drag the cookie back into cross-origin requests.
 */
export function authHeaders(): Record<string, string> {
	const token = getToken();
	return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * How long an ordinary read or write may take before it is reported as failed.
 *
 * A fetch has no limit of its own, so a stalled connection -- a phone between masts, a
 * captive portal that accepts the socket and never answers -- spun forever, which reads
 * as a broken app rather than a bad connection. Twenty seconds clears a cold function
 * waking a suspended database with room to spare.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The OAuth callback gets longer. Inside that one request the server exchanges the code
 * with GitHub, reads the account and may create the first graph, and the code can be
 * spent only once, so abandoning a slow exchange early costs the visitor a fresh sign-in.
 */
export const SIGN_IN_TIMEOUT_MS = 45_000;

/**
 * A signal that aborts after `ms`, or as soon as `signal` does.
 *
 * `AbortSignal.any` is the natural way to join the two, but the build targets iOS 16.4
 * and Safari added it in 17.4, where calling it throws before the request is even made.
 * So it is used where it exists and the first abort is forwarded by hand where it does
 * not.
 */
export function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(ms);
	if (!signal) return timeout;
	if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);

	const joined = new AbortController();
	for (const source of [signal, timeout]) {
		if (source.aborted) {
			joined.abort(source.reason);
			break;
		}
		source.addEventListener("abort", () => joined.abort(source.reason), { once: true });
	}
	return joined.signal;
}

/** Whether a rejected request ran out of time, rather than failing outright. */
export function timedOut(error: unknown): boolean {
	return error instanceof DOMException && error.name === "TimeoutError";
}
