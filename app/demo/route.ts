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

export async function GET(request: NextRequest) {
	// `?demo=1`, so the sample shows even for somebody signed in: the link names the sample.
	const response = NextResponse.redirect(new URL("/tree?demo=1", request.url));
	response.cookies.set(DEMO_COOKIE, "1", {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		secure: process.env.NODE_ENV === "production",
	});
	return response;
}
