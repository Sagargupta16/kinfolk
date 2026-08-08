/**
 * Every write, reachable from another origin.
 *
 * One route rather than fourteen, because each of these actions already takes a
 * single `FormData` and returns the same `Result`. Fourteen hand-written endpoints
 * would be fourteen places for the auth line, the parse and the error shape to
 * drift out of agreement.
 *
 * The actions are NOT re-implemented here and must never be. Each one starts with
 * its own `editor()` or `sharer()` check and goes on to `lib/tree/authz.ts`, so
 * this file is a transport: it decides which function to call and nothing about
 * whether the caller may call it. That is why a dispatcher is safe here -- there is
 * no permission decision for it to get wrong.
 *
 * The action set is an explicit ALLOW LIST, keyed by name. Looking a function up
 * from a module by a client-supplied string would expose every export the module
 * happens to have, including helpers that were never meant to be callable, and it
 * would grow silently as the module grows. A missing name is a 404 rather than a
 * 500 because "there is no such action" is a fact about the API, not a failure.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { corsHeaders, preflightHeaders } from "@/lib/tree/cors";
import {
	addChild,
	addContact,
	addPerson,
	addRelation,
	addRelative,
	addUnion,
	deleteContact,
	deletePerson,
	deleteRelation,
	type Result,
	removeChild,
	updatePerson,
} from "@/lib/tree/edit-actions";
import { invite, removeMember, revokeInvite } from "@/lib/tree/share-actions";

/**
 * The callable set: every action taking one `FormData` and returning a `Result`.
 *
 * That shared signature is what makes one route safe rather than lazy, and it is
 * checked rather than assumed -- the first version of this file listed all
 * nineteen and typecheck rejected three of them, which is exactly the kind of
 * mismatch a `Record<string, Function>` would have swallowed into a runtime crash.
 *
 * Deliberately excluded, each for its own reason:
 *
 *   - `enterDemo` / `exitDemo` set and clear an httpOnly cookie on THIS origin,
 *     and a cookie set on the API host is not one the Pages UI can send back. The
 *     demo is reached through `/api/tree?demo=1`, which needs no cookie.
 *   - `editablePeople()` and `leave()` take no form, and `shareState(treeId)`
 *     takes a string and returns a `ShareState` rather than a `Result`. Coercing
 *     them into this shape would mean inventing a form for them to ignore; they
 *     get their own routes when the UI needs them.
 */
const ACTIONS: Record<string, (form: FormData) => Promise<Result>> = {
	addPerson,
	updatePerson,
	deletePerson,
	addRelation,
	deleteRelation,
	addUnion,
	addChild,
	removeChild,
	addContact,
	deleteContact,
	addRelative,
	invite,
	revokeInvite,
	removeMember,
};

export async function OPTIONS(request: NextRequest) {
	return new NextResponse(null, {
		status: 204,
		headers: preflightHeaders(request.headers.get("origin")),
	});
}

export async function POST(request: NextRequest, context: { params: Promise<{ name: string }> }) {
	const cors = corsHeaders(request.headers.get("origin"));
	const { name } = await context.params;

	// `Object.hasOwn`, not a truthiness check on the lookup: a bare object literal
	// still inherits from Object.prototype, so a name like "constructor" or
	// "toString" resolves to a real function that is not an action.
	//
	// The function is then bound to a local, because `hasOwn` narrows nothing for
	// the type checker -- an index signature stays possibly-undefined however it was
	// guarded, so calling through the index would be an unchecked call.
	const action = Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : undefined;
	if (!action) {
		return NextResponse.json(
			{ ok: false, error: "No such action." },
			{ status: 404, headers: cors },
		);
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		// A malformed or absent body. 400 rather than letting the action read an
		// empty form and refuse with a message about a missing field, which would
		// blame the data for a transport problem.
		return NextResponse.json(
			{ ok: false, error: "Expected form data." },
			{ status: 400, headers: cors },
		);
	}

	let result: Result;
	try {
		result = await action(form);
	} catch {
		// A thrown error -- a dropped database connection, a bug -- would otherwise
		// bubble into Next's own 500, which carries NO CORS headers: the SPA reads
		// that as an opaque network failure rather than an answer. Keep both the body
		// and platform log free of SQL, bound values, and record data.
		console.error(`action ${name} failed`);
		return NextResponse.json(
			{ ok: false, error: "Something went wrong saving that. Try again." },
			{ status: 500, headers: cors },
		);
	}

	// The action's own refusal is a 200 carrying `ok: false`, not a 4xx. These are
	// expected outcomes the UI renders inline -- "Which graph?", "Sign in to make
	// changes" -- and a status code would make an ordinary validation message
	// indistinguishable from a broken request. The one exception is auth, which the
	// client has to be able to detect in order to prompt a fresh sign-in.
	const status = !result.ok && /^Sign in/.test(result.error) ? 401 : 200;
	return NextResponse.json(result, { status, headers: cors });
}
