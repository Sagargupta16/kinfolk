/**
 * The share panel's state, for the static frontend.
 *
 * Its own route rather than an entry on the action dispatcher, because
 * `shareState(treeId)` takes a string and returns a `ShareState` -- not
 * `(FormData) => Result` like the seventeen writes. Coercing it into that shape would
 * mean inventing a form for it to ignore and a `Result` for it to pretend to be.
 *
 * A GET, because it reads. The dispatcher is POST-only on purpose, so this could not
 * have lived there even with a matching signature.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { corsHeaders, preflightHeaders } from "@/lib/tree/cors";
import { requestUserId } from "@/lib/tree/request-user";
import { shareState } from "@/lib/tree/share-actions";

export async function OPTIONS(request: NextRequest) {
	return new NextResponse(null, {
		status: 204,
		headers: preflightHeaders(request.headers.get("origin")),
	});
}

export async function GET(request: NextRequest) {
	const cors = {
		...corsHeaders(request.headers.get("origin")),
		"Cache-Control": "private, no-store",
	};

	const treeId = request.nextUrl.searchParams.get("treeId");
	if (!treeId) {
		return NextResponse.json({ error: "treeId is required" }, { status: 400, headers: cors });
	}

	try {
		// 401 for a missing or expired session, so the SPA can say so and drop its token;
		// folded into an empty list it read as "nobody has access", which is a different
		// and false answer.
		if (!(await requestUserId())) {
			return NextResponse.json(
				{ error: "Sign in to see who has access." },
				{ status: 401, headers: cors },
			);
		}
		// `shareState` then runs its own `sharer()` check and `assertCanEditTree`, so a
		// caller asking about a graph they cannot see is answered inside it rather than
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
