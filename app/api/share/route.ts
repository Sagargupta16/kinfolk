/**
 * The share panel's state, for the static frontend.
 *
 * Its own route rather than an entry on the action dispatcher, because
 * `shareState(treeId)` takes a string and returns a `ShareState` -- not
 * `(FormData) => Result` like the fourteen writes. Coercing it into that shape would
 * mean inventing a form for it to ignore and a `Result` for it to pretend to be.
 *
 * A GET, because it reads. The dispatcher is POST-only on purpose, so this could not
 * have lived there even with a matching signature.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { corsHeaders, preflightHeaders } from "@/lib/tree/cors";
import { shareState } from "@/lib/tree/share-actions";

export async function OPTIONS(request: NextRequest) {
	return new NextResponse(null, {
		status: 204,
		headers: preflightHeaders(request.headers.get("origin")),
	});
}

export async function GET(request: NextRequest) {
	const cors = corsHeaders(request.headers.get("origin"));

	const treeId = request.nextUrl.searchParams.get("treeId");
	if (!treeId) {
		return NextResponse.json({ error: "treeId is required" }, { status: 400, headers: cors });
	}

	try {
		// `shareState` runs its own `sharer()` check and then `assertCanEditTree`, so a
		// caller asking about a graph they cannot see is refused inside it rather than
		// here. This route decides nothing about permission.
		return NextResponse.json(await shareState(treeId), { headers: cors });
	} catch {
		// Database errors may carry bound values; log the operation, not the object.
		console.error("[share] state failed");
		return NextResponse.json(
			{ error: "could not read the sharing state" },
			{ status: 500, headers: cors },
		);
	}
}
