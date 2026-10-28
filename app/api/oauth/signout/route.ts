/**
 * Revoke the session behind a bearer token.
 *
 * Without this, signing out of the SPA would only forget the token locally while the
 * row stayed valid for thirty days -- so a copy taken from `sessionStorage` would
 * keep working long after the user believed they had left. That is the difference
 * between clearing a variable and signing out.
 *
 * DELETE on the row rather than an expiry update, matching what the Auth.js
 * `signOut` does through the adapter, so a session ended by either flow leaves the
 * same absence behind.
 */

import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { bearerToken } from "@/lib/tree/bearer-header";
import { corsHeaders, preflightHeaders } from "@/lib/tree/cors";

export async function OPTIONS(request: NextRequest) {
	return new NextResponse(null, {
		status: 204,
		headers: preflightHeaders(request.headers.get("origin")),
	});
}

export async function POST(request: NextRequest) {
	const cors = {
		...corsHeaders(request.headers.get("origin")),
		"Cache-Control": "no-store",
	};

	const token = bearerToken(request.headers.get("authorization"));

	// 200 with no token as well as with one. Sign-out is idempotent by nature, and
	// an error here would leave a client unable to complete a sign-out it has already
	// decided on -- the worst possible time to refuse.
	if (!token) return NextResponse.json({ ok: true }, { headers: cors });

	try {
		// Deleted by exact token, so a caller can only ever end the session it holds.
		// There is no user id in play, which means one token cannot revoke another's.
		await db.delete(sessions).where(eq(sessions.sessionToken, token));
	} catch {
		// Never the error object: a failed query's message carries its bound
		// parameters, which here is the live token the caller is trying to revoke.
		console.error("[oauth] signout failed");
		return NextResponse.json(
			{ error: "Could not sign out. Try again." },
			{ status: 500, headers: cors },
		);
	}

	return NextResponse.json({ ok: true }, { headers: cors });
}
