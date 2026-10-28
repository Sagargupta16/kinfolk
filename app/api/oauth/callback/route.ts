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
 * Expected client errors are specific enough to recover from. Unexpected failures
 * record only their non-sensitive stage and return one generic message so query text,
 * provider details, and nested database causes never cross the trust boundary.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { corsHeaders, preflightHeaders } from "@/lib/tree/cors";
import { exchangeCode, fetchProfile, SPENT_CODE } from "@/lib/tree/oauth-github";
import { AccountConflict, signInWithGitHub } from "@/lib/tree/oauth-session";
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

	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return NextResponse.json({ error: "expected a JSON body" }, { status: 400, headers: cors });
	}
	// `null`, a string or an array is valid JSON too, and reading a field off `null`
	// would throw before any handler could add the CORS headers.
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return NextResponse.json({ error: "expected a JSON object" }, { status: 400, headers: cors });
	}
	const body = parsed as { code?: unknown; state?: unknown; redirect_uri?: unknown };

	const code = typeof body.code === "string" ? body.code : null;
	const state = typeof body.state === "string" ? body.state : null;
	if (!code) {
		return NextResponse.json({ error: "code is missing" }, { status: 400, headers: cors });
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

	// Track the failing stage for server logs. It is never included in the response.
	let stage = "state";

	try {
		// CSRF. Verified by signature, so any instance can check a state it never issued
		// -- the reason it is an HMAC rather than a remembered nonce. Inside the try
		// because signing needs AUTH_SECRET, and a missing one throws.
		if (!(await verifyState(state))) {
			return NextResponse.json(
				{ error: "this sign-in link has expired or was not started here" },
				{ status: 400, headers: cors },
			);
		}

		stage = "exchange";
		const exchange = await exchangeCode(code, redirectUri);
		if (!exchange.ok) {
			if (exchange.reason === SPENT_CODE) {
				// A spent, forged or expired code. 400 because the caller can recover by
				// starting again, which a 500 would not suggest.
				return NextResponse.json(
					{ error: "GitHub would not accept that code. Try signing in again." },
					{ status: 400, headers: cors },
				);
			}
			// A rejected client secret, a redirect GitHub does not know, or an outage:
			// ours to fix, so it is logged by GitHub's own error code.
			console.error(`[oauth] exchange refused: ${exchange.reason}`);
			return NextResponse.json(
				{ error: "GitHub did not complete the sign-in. Try again in a moment." },
				{ status: 502, headers: cors },
			);
		}

		stage = "profile";
		const profile = await fetchProfile(exchange.accessToken);
		if (!profile) {
			console.error("[oauth] callback failed at profile");
			return NextResponse.json(
				{ error: "could not read your GitHub profile" },
				{ status: 502, headers: cors },
			);
		}

		stage = "session";
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
		if (error instanceof AccountConflict) {
			return NextResponse.json({ error: error.message }, { status: 409, headers: cors });
		}
		// Keep credentials, profile data, SQL, and bound parameters out of platform logs.
		// The stage is enough to route diagnosis without persisting request data.
		console.error(`[oauth] callback failed at ${stage}`);
		// A timeout or a dropped connection to GitHub is an upstream failure, not ours.
		const upstream = stage === "exchange" || stage === "profile";
		return NextResponse.json(
			{
				error: upstream
					? "GitHub did not answer. Try again in a moment."
					: "Could not complete sign-in. Try again.",
			},
			{ status: upstream ? 502 : 500, headers: cors },
		);
	}
}
