/**
 * Hand a signed-in browser its own session token, so a static SPA can use it as a
 * bearer credential.
 *
 * This is the bridge the static frontend needs and cannot build for itself. The
 * SPA has no way to run an OAuth flow -- `signIn()` is a server redirect -- so the
 * sign-in journey is: the SPA sends the visitor to this app's `/signin`, Auth.js
 * completes the round trip and sets its httpOnly cookie HERE, and the visitor comes
 * back to the SPA, which calls this route to convert that cookie into a token it
 * can send from another origin.
 *
 * ## Why this is not a credential-leaking hole
 *
 * The rule that makes it safe: **the cookie must be sent, and CORS must not allow
 * it to be sent cross-site.**
 *
 *   - It authenticates via `sessionOrNull()`, so only a browser already holding a
 *     valid session cookie gets an answer. It mints nothing.
 *   - It sends NO CORS headers at all. A cross-origin `fetch` from any site cannot
 *     read the response, because the browser refuses it without
 *     `Access-Control-Allow-Origin` -- and this route deliberately never sets one,
 *     unlike `/api/tree` and `/api/action/*`.
 *   - The session cookie is `SameSite=Lax`, so a cross-site request would not carry
 *     it anyway. Two independent reasons a hostile page gets nothing.
 *
 * That means the SPA must reach this route by NAVIGATING the visitor to it, not by
 * calling it in the background from `sagargupta.online`. The token comes back in
 * the redirect fragment, which never reaches a server log.
 *
 * `no-store` matters more here than on any other route: a cached session token
 * served to the next visitor would be a full account takeover.
 */

import { and, desc, eq, gt } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { sessionOrNull } from "@/auth";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { allowedRedirect } from "@/lib/tree/redirect-allow";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

/**
 * The mount path, applied by hand.
 *
 * `basePath` does not rewrite `NextResponse.redirect(new URL(...))`, which is the
 * trap `app/demo/route.ts` already documents. Same fix, same reason.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export async function GET(request: NextRequest) {
	const session = await sessionOrNull();
	const userId = session?.user?.id;

	// `redirect` is where to send the visitor back to with the token. It is checked
	// against an allow list rather than trusted: an open redirect here would hand a
	// session token to whatever host an attacker put in the query string, which is
	// the one way this route could genuinely leak a credential.
	const target = request.nextUrl.searchParams.get("redirect");
	const safe = allowedRedirect(target);

	if (!userId) {
		// Not signed in. Send them to sign-in and come back here, so the SPA's link
		// works whether or not a session already exists.
		const back = `${BASE_PATH}/api/token${safe ? `?redirect=${encodeURIComponent(safe)}` : ""}`;
		const signin = new URL(`${BASE_PATH}/signin`, request.nextUrl.origin);
		signin.searchParams.set("from", back);
		return NextResponse.redirect(signin, { headers: NO_STORE });
	}

	// The freshest live session for this user. `expires` is filtered in the query so
	// an expired row cannot be handed out, and ordered so a user with several
	// sessions gets the one most likely to be this browser's.
	const rows = await db
		.select({ token: sessions.sessionToken })
		.from(sessions)
		.where(and(eq(sessions.userId, userId), gt(sessions.expires, new Date())))
		.orderBy(desc(sessions.expires))
		.limit(1);

	const token = rows[0]?.token;
	if (!token) {
		// A valid cookie with no session row should not happen, but returning a 200
		// with no token would leave the SPA looping through sign-in forever.
		return NextResponse.json({ error: "no active session" }, { status: 401, headers: NO_STORE });
	}

	if (safe) {
		// In the FRAGMENT, not the query. A fragment is never sent to a server, so the
		// token cannot land in an access log, a proxy log or a Referer header.
		return NextResponse.redirect(`${safe}#token=${encodeURIComponent(token)}`, {
			headers: NO_STORE,
		});
	}

	// No redirect asked for: answer directly. Only reachable by a same-origin caller,
	// since this route sends no CORS headers.
	return NextResponse.json({ token }, { headers: NO_STORE });
}
