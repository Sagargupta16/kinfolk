import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { NotAllowedError } from "@/lib/tree/authz";
import { contactState } from "@/lib/tree/contact-state";
import { corsHeaders, preflightHeaders } from "@/lib/tree/cors";

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
		return NextResponse.json(
			await contactState(request.nextUrl.searchParams.get("personId") ?? ""),
			{ headers },
		);
	} catch (error) {
		if (error instanceof NotAllowedError) {
			return NextResponse.json(
				{ error: error.message },
				{ status: /^Sign in/.test(error.message) ? 401 : 403, headers },
			);
		}
		console.error("[contacts] read failed");
		return NextResponse.json(
			{ error: "Could not load contact details." },
			{ status: 500, headers },
		);
	}
}
