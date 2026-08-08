/**
 * Start a sign-in for the static frontend.
 *
 * The SPA calls this, gets a URL, and sends the visitor to it. GitHub then returns
 * them to the SPA's own callback page, which is the whole point: the browser stays
 * on `sagargupta.online` and never visits the API host.
 *
 * Two things are returned rather than one. The `url` is what the browser follows.
 * The `state` is handed back so the SPA can stash it and compare on return -- the
 * server verifies it too, by signature, but a client-side comparison catches a
 * mismatched tab before a network round trip.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { corsHeaders, preflightHeaders } from "@/lib/tree/cors";
import { authorizeUrl } from "@/lib/tree/oauth-github";
import { issueState } from "@/lib/tree/oauth-state";
import { allowedRedirect } from "@/lib/tree/redirect-allow";

export async function OPTIONS(request: NextRequest) {
	return new NextResponse(null, {
		status: 204,
		headers: preflightHeaders(request.headers.get("origin")),
	});
}

export async function GET(request: NextRequest) {
	const cors = corsHeaders(request.headers.get("origin"));

	// Where GitHub should return the visitor. Validated against the same origin
	// allow list the token bridge used: this value ends up in an authorize URL, so
	// an unchecked one would let somebody point a real Kinfolk sign-in at their own
	// page and collect the code.
	const requested = request.nextUrl.searchParams.get("redirect_uri");
	const redirectUri = allowedRedirect(requested);
	if (!redirectUri) {
		return NextResponse.json(
			{ error: "redirect_uri is missing or not allowed" },
			{ status: 400, headers: cors },
		);
	}

	try {
		const state = await issueState();
		return NextResponse.json(
			{ url: authorizeUrl(state, redirectUri), state },
			// Never cached: a reused state would let one authorize URL be replayed,
			// which is exactly what state exists to prevent.
			{ headers: { ...cors, "Cache-Control": "no-store" } },
		);
	} catch {
		// Usually a missing OAuth setting. Keep the diagnostic categorical so a
		// provider error cannot persist request details or credentials in platform logs.
		console.error("[oauth] authorize failed");
		return NextResponse.json(
			{ error: "sign-in is not configured" },
			{ status: 500, headers: cors },
		);
	}
}
