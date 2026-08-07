/**
 * The tree as JSON, for a UI served from another origin.
 *
 * This is the read half of the API that lets GitHub Pages host the interface at
 * `sagargupta.online/kinfolk` while the data stays here. It returns the SAME
 * `TreeView` the server-rendered `/tree` page builds, through the same
 * `loadTreeView` and `buildDemoView`, so there is one projection rather than two.
 * A second code path is how a demo drifts into a showreel that proves nothing.
 *
 * Three things this route must not become:
 *
 *   - **The place contact filtering happens.** `lib/tree/visibility.ts` strips
 *     values while the view is assembled, so what arrives here is already
 *     filtered. Re-deciding it would put the same rule in two files, and the copy
 *     that goes stale is the one that leaks.
 *   - **A cookie-authenticated endpoint.** Auth is a bearer token, which is what
 *     keeps the session cookie `SameSite=Lax`. See lib/tree/bearer.ts.
 *   - **Trusting a client-supplied user id.** The only accepted identity is a
 *     token that matches a live `sessions` row.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { userIdFromBearer } from "@/lib/tree/bearer";
import { corsHeaders, preflightHeaders } from "@/lib/tree/cors";
import { buildDemoView, DEMO_COOKIE } from "@/lib/tree/demo";
import { loadTreeView } from "@/lib/tree/load";
import { serialiseTreeView } from "@/lib/tree/serialise";

/**
 * The browser sends this before any request carrying an `Authorization` header,
 * so without it every authenticated call fails before it is made.
 */
export async function OPTIONS(request: NextRequest) {
	return new NextResponse(null, {
		status: 204,
		headers: preflightHeaders(request.headers.get("origin")),
	});
}

export async function GET(request: NextRequest) {
	const cors = corsHeaders(request.headers.get("origin"));
	const params = request.nextUrl.searchParams;

	// Both default on, matching app/tree/page.tsx: the combined view is the
	// product, and a client that omits the flags should get the same graph the
	// page would render rather than a quieter one.
	const options = {
		combined: params.get("combined") !== "0",
		showRelations: params.get("relations") !== "0",
	};

	// Both database calls are wrapped, and the absence of this was a real defect: an
	// unhandled throw here answered 500 with an EMPTY BODY, so a failing query was
	// indistinguishable from a crashed function. The stage marker exists for the same
	// reason it does in the OAuth callback -- two calls, one handler, and from outside
	// they look identical.
	let stage = "session lookup";
	try {
		const userId = await userIdFromBearer(request.headers.get("authorization"));

		if (userId) {
			stage = "load tree";
			const view = await loadTreeView(userId, options);
			// A signed-in user with no tree yet is a new account, not an error. 200 with
			// a null view lets the client render its empty state; a 404 would say the
			// ROUTE was missing, which is a different problem with a different fix.
			return NextResponse.json({ view: view ? serialiseTreeView(view) : null }, { headers: cors });
		}
	} catch (error) {
		// `cause` carries the real Postgres error; drizzle's own message holds only the
		// statement. Reporting the statement without the reason is a symptom without a
		// diagnosis, which cost a full round of investigation on the OAuth callback.
		console.error(`[tree] failed at ${stage}`, error);
		const detail = error instanceof Error ? error.message : "unknown error";
		const cause =
			error instanceof Error && error.cause instanceof Error
				? error.cause.message
				: error instanceof Error && error.cause
					? String(error.cause)
					: null;
		return NextResponse.json(
			{ error: `could not read your graph (${stage}: ${detail})`, cause },
			{ status: 500, headers: cors },
		);
	}

	// No token: the sample tree, if the caller asked for it the same way the page
	// does. Demo mode reads no session and no database, so it is the one path that
	// works for a visitor who has never signed in.
	const wantsDemo = params.get("demo") === "1" || request.cookies.get(DEMO_COOKIE)?.value === "1";
	if (wantsDemo) {
		return NextResponse.json(
			{ view: serialiseTreeView(buildDemoView(options)) },
			{ headers: cors },
		);
	}

	// 401 rather than an empty view, because "you are not signed in" and "you have
	// no data" need different handling in the client and must not look alike.
	return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: cors });
}
