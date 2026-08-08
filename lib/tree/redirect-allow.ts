/**
 * Which origins may receive a session token.
 *
 * Split out of the route so it can be tested without booting Next. This is the one
 * check standing between a caller-supplied value and a handed-out session token:
 * get it wrong and it leaks a credential to whatever host an attacker names, which
 * is worse than having no token endpoint at all.
 *
 * Used by `/api/oauth/authorize` and `/api/oauth/callback` to check the
 * `redirect_uri` a caller supplies. That value goes into a GitHub authorize URL, so
 * an unchecked one would let somebody point a real Kinfolk sign-in at their own page
 * and collect the code.
 *
 * It first existed for an `/api/token` bridge that has since been deleted. That
 * design sent the visitor to the API host to sign in; ledger-sync does it properly,
 * with the OAuth `redirect_uri` pointing at the FRONTEND, so the browser stays on
 * the visitor's own domain and the SPA posts the code back for exchange.
 */

/**
 * Only the callback route may receive a token. Production accepts one exact URL;
 * local callbacks are added only outside production.
 */
const PRODUCTION_REDIRECT = "https://sagargupta.online/kinfolk/auth/callback/github";
const DEVELOPMENT_REDIRECTS = [
	"http://localhost:5173/auth/callback/github",
	"http://localhost:3007/auth/callback/github",
];

const ALLOWED_REDIRECTS = new Set([
	PRODUCTION_REDIRECT,
	...(process.env.NODE_ENV === "production" ? [] : DEVELOPMENT_REDIRECTS),
]);

/**
 * The target if it is one of ours, else null.
 *
 * Compared as a fully parsed URL, never by string prefix or origin alone. Origin-only
 * validation would let an allowed host choose an arbitrary path to receive the token.
 * A relative path is refused because the caller is on another origin.
 */
export function allowedRedirect(value: string | null): string | null {
	if (!value) return null;

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}

	return ALLOWED_REDIRECTS.has(url.href) ? url.href : null;
}
