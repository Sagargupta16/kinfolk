/**
 * CORS for the JSON API.
 *
 * The UI is served from GitHub Pages on `sagargupta.online` and the API from
 * Vercel, so every call is cross-origin and the browser will refuse it without
 * these headers.
 *
 * Two decisions worth keeping:
 *
 * 1. **The origin is an ALLOW LIST, never `*` and never reflected.** Reflecting
 *    `Origin` back is the same as `*` with extra steps -- any site could call the
 *    API and read the response. The list is short because it is exactly the two
 *    places the UI is served from.
 *
 * 2. **`Access-Control-Allow-Credentials` is deliberately ABSENT.** Auth is a
 *    bearer token in a header (see [bearer.ts](bearer.ts)), so no cookie needs to
 *    cross origins, so the session cookie stays `SameSite=Lax` and keeps its CSRF
 *    protection. Adding this header would be the first step of undoing that.
 *
 * `*` would also be forbidden anyway once credentials were involved, which is the
 * spec pointing at the same conclusion.
 */

/**
 * Origins the API answers to.
 *
 * `sagargupta.online` is where Pages serves the UI. The apex has no port and no
 * path because an Origin never carries one. Localhost is included for `pnpm dev`
 * against a deployed API, on the port [.claude/launch.json](../../.claude/launch.json)
 * uses -- a different port is a different origin, so 3000 would not match.
 */
const ALLOWED_ORIGINS = new Set([
	"https://sagargupta.online",
	"http://localhost:3007",
	"https://localhost:3007",
]);

/**
 * CORS headers for a request, or the bare minimum when the origin is not allowed.
 *
 * An unknown origin gets NO `Allow-Origin` rather than a 403: the browser is the
 * thing being told, and omitting the header is exactly how it is told. Returning
 * an error body instead would still be a response the caller could read.
 *
 * `Vary: Origin` is not optional. Without it a CDN can cache the response for one
 * allowed origin and serve it to another, which either leaks a response across
 * origins or blocks a legitimate one depending on which got cached first.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
	const headers: Record<string, string> = { Vary: "Origin" };
	if (origin && ALLOWED_ORIGINS.has(origin)) {
		headers["Access-Control-Allow-Origin"] = origin;
	}
	return headers;
}

/**
 * Headers for a preflight, which the browser sends before any request carrying an
 * `Authorization` header. Without a 204 here, every authenticated call fails
 * before it is made.
 */
export function preflightHeaders(origin: string | null): Record<string, string> {
	return {
		...corsHeaders(origin),
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Authorization, Content-Type",
		// A day. The preflight answer only changes when this file does, and a short
		// max-age doubles the request count on a graph that fetches per interaction.
		"Access-Control-Max-Age": "86400",
	};
}

export function isAllowedOrigin(origin: string | null): boolean {
	return !!origin && ALLOWED_ORIGINS.has(origin);
}
