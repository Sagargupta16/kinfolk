/**
 * Which redirect targets `/api/token` may send a session token to.
 *
 * Split out of the route so it can be tested without booting Next. This is the one
 * check standing between a query parameter and a handed-out session token: get it
 * wrong and the route becomes an open redirect that leaks a credential to whatever
 * host an attacker names, which is worse than having no token endpoint at all.
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
