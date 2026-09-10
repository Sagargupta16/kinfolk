import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { NotAllowedError } from "@/lib/tree/authz";
import { corsHeaders, preflightHeaders } from "@/lib/tree/cors";
import { linkState } from "@/lib/tree/link-actions";

export async function OPTIONS(request: NextRequest) {
	return new NextResponse(null, {
		status: 204,
		headers: preflightHeaders(request.headers.get("origin")),
	});
}

export async function GET(request: NextRequest) {
	const headers = {
		...corsHeaders(request.headers.get("origin")),
		"Cache-Control": "private, no-store",
	};
	try {
		return NextResponse.json(await linkState(), { headers });
	} catch (error) {
		if (error instanceof NotAllowedError) {
			return NextResponse.json({ error: error.message }, { status: 401, headers });
		}
		console.error("[links] read failed");
		return NextResponse.json({ error: "Could not load family links." }, { status: 500, headers });
	}
}
