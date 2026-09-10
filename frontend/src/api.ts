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
