/**
 * Finish a sign-in for the static frontend.
 *
 * The SPA posts the `code` and `state` it received on its own callback page, and
 * gets back a bearer token. Every step that needs a secret happens here, so the
 * browser only ever holds an opaque code and then a session token.
 *
 * POST rather than GET, and that is not a style choice. A GET carrying a code would
 * be logged by every proxy in the path, kept in browser history and sent as a
 * `Referer` -- and a code is a one-time credential until it is spent. A POST body is
 * none of those things.
 *
 * The failure messages are deliberately plain and DIFFERENT from each other. The
 * server-rendered flow answers every problem with `?error=Configuration`, which
 * cost real time to diagnose because a bad state, a spent code and a missing secret
 * were indistinguishable. Here they are not.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { corsHeaders, preflightHeaders } from "@/lib/tree/cors";
import { exchangeCode, fetchProfile } from "@/lib/tree/oauth-github";
import { signInWithGitHub } from "@/lib/tree/oauth-session";
import { verifyState } from "@/lib/tree/oauth-state";
import { allowedRedirect } from "@/lib/tree/redirect-allow";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

export async function OPTIONS(request: NextRequest) {
	return new NextResponse(null, {
		status: 204,
		headers: preflightHeaders(request.headers.get("origin")),
	});
}

export async function POST(request: NextRequest) {
	const cors = { ...corsHeaders(request.headers.get("origin")), ...NO_STORE };

	let body: { code?: unknown; state?: unknown; redirect_uri?: unknown };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "expected a JSON body" }, { status: 400, headers: cors });
	}

	const code = typeof body.code === "string" ? body.code : null;
	const state = typeof body.state === "string" ? body.state : null;
	if (!code) {
		return NextResponse.json({ error: "code is missing" }, { status: 400, headers: cors });
	}

	// CSRF. Verified by signature, so any instance can check a state it never issued
	// -- the reason it is an HMAC rather than a remembered nonce.
	if (!(await verifyState(state))) {
		return NextResponse.json(
			{ error: "this sign-in link has expired or was not started here" },
			{ status: 400, headers: cors },
		);
	}

	// Must match the value sent to `/authorize`, because GitHub compares it at
	// exchange time. Re-validated rather than trusted: it is a caller-supplied
	// string reaching an outbound request.
	const redirectUri = allowedRedirect(
		typeof body.redirect_uri === "string" ? body.redirect_uri : null,
	);
	if (!redirectUri) {
		return NextResponse.json(
			{ error: "redirect_uri is missing or not allowed" },
			{ status: 400, headers: cors },
		);
	}

	try {
		const accessToken = await exchangeCode(code, redirectUri);
		if (!accessToken) {
			// A spent, forged or expired code. 400 because the caller can recover by
			// starting again, which a 500 would not suggest.
			return NextResponse.json(
				{ error: "GitHub would not accept that code. Try signing in again." },
				{ status: 400, headers: cors },
			);
		}

		const profile = await fetchProfile(accessToken);
		if (!profile) {
			return NextResponse.json(
				{ error: "could not read your GitHub profile" },
				{ status: 502, headers: cors },
			);
		}

		const result = await signInWithGitHub(profile);
		return NextResponse.json(
			{
				token: result.token,
				expires: result.expires.toISOString(),
				isNewUser: result.isNewUser,
				user: { name: profile.name, email: profile.email, image: profile.avatarUrl },
			},
			{ headers: cors },
		);
	} catch (error) {
		// The access token is never logged. `error` here is a database or config
		// failure, and the log line exists so the next one names itself instead of
		// being inferred from a generic page.
		console.error("[oauth] callback failed", error);
		return NextResponse.json(
			{ error: "could not complete sign-in" },
			{ status: 500, headers: cors },
		);
	}
}
