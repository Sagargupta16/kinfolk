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
 * Origins the token may be delivered to.
 *
 * `sagargupta.online` is where Pages serves the SPA. `localhost:5173` is Vite's dev
 * server and `localhost:3007` the Next app, so the flow can be exercised locally.
 */
const ALLOWED_ORIGINS = new Set([
	"https://sagargupta.online",
	"http://localhost:5173",
	"http://localhost:3007",
]);

/**
 * The target if it is one of ours, else null.
 *
 * Compared by parsed ORIGIN, never by string prefix: `startsWith` would accept
 * `https://sagargupta.online.evil.example`, a different host that merely begins
 * with the right characters. A relative path is refused too -- the caller is on
 * another origin, so a bare path is either a mistake or an attempt to have this
 * route resolve it against its own host.
 */
export function allowedRedirect(value: string | null): string | null {
	if (!value) return null;

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}

	if (!ALLOWED_ORIGINS.has(url.origin)) return null;

	// Any fragment the caller supplied is dropped, because one is about to be
	// appended and two would make the token unparseable.
	url.hash = "";
	return url.toString();
}
