/**
 * Kept as a permanent entry point to the sample tree.
 *
 * The demo lives at /tree behind a cookie, so this route's only job is to set
 * that cookie and forward. Preserved rather than deleted because "/demo" is the
 * link that gets shared, and it should not rot.
 *
 * A route handler, not a page: Next only permits writing a cookie from a server
 * action or a route handler, and setting one while rendering a page throws
 * "Cookies can only be modified in a Server Action or Route Handler".
 */
import { type NextRequest, NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/tree/demo";

/**
 * The mount path, which this file has to apply BY HAND.
 *
 * `basePath` rewrites `<Link>` hrefs, asset URLs and `redirect()` from next/navigation,
 * but NOT `NextResponse.redirect(new URL(...))` -- that builds an absolute URL from the
 * request origin and Next leaves it exactly as written. Measured under a `/kinfolk`
 * mount: this handler sent visitors to `http://localhost/tree`, which 404s, so the
 * shared demo link was broken on the deployed site and fine everywhere else.
 *
 * Read from the environment rather than imported from next.config.mjs, because a route
 * handler cannot import the config -- and the value is already public (it is in every
 * asset URL), so `NEXT_PUBLIC_` is honest about that.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export async function GET(request: NextRequest) {
	const response = NextResponse.redirect(new URL(`${BASE_PATH}/tree`, request.url));
	response.cookies.set(DEMO_COOKIE, "1", {
		httpOnly: true,
		sameSite: "lax",
		// Scoped to the mount, so a demo cookie set here cannot be read by another app
		// sharing the domain. On `sagargupta.online` that is not hypothetical: the apex
		// and every project subpath are the same host, and cookies are scoped by host
		// and path only -- never by port or by project.
		path: BASE_PATH || "/",
		secure: process.env.NODE_ENV === "production",
	});
	return response;
}
