/**
 * The server actions, as HTTP calls.
 *
 * Aliased over the five server-action modules (`edit-actions`, `share-actions`,
 * `demo-actions`, `link-actions`, `contact-state`) so the components that import
 * `addPerson`, `updatePerson` and the rest keep working with no edits. Each export
 * has the SAME signature as the action it replaces -- `(form: FormData) =>
 * Promise<Result>` -- because React's `<form action={...}>` hands a FormData to
 * whatever it is given, and the whole point is that the forms do not change.
 *
 * `Result` and `ShareState` come from their type-only modules (lib/tree/result.ts,
 * lib/tree/sharing.ts) and are re-exported here, so a component importing either
 * from an aliased module gets the server's own definition. A hand-written copy in
 * this file compiled against nothing, and a new variant on the server would have
 * drifted silently from the client that renders it.
 *
 * What this file must NOT do is make a permission decision. It posts to
 * `/api/action/<name>`, which calls the real action, which starts with its own auth
 * check and goes on to `lib/tree/authz.ts`. A client that lied about its own
 * permissions would simply be refused by the server.
 */

import type { ContactState } from "@/lib/tree/contacts";
import type { LinkState } from "@/lib/tree/links";
import type { Result } from "@/lib/tree/result";
import type { ShareState } from "@/lib/tree/sharing";
import {
	API_BASE,
	authHeaders,
	clearToken,
	REQUEST_TIMEOUT_MS,
	timedOut,
	withTimeout,
} from "../api";
import { signOut } from "../auth";

export type { Result, ShareState };

/**
 * POST a form to one named action.
 *
 * A transport failure is turned into the same `{ ok: false, error }` the actions
 * return, rather than a thrown error. Every caller already renders that shape
 * inline, so a network blip reads as "could not save" in the form the user is
 * looking at instead of an unhandled rejection in the console.
 */
async function call(name: string, form: FormData): Promise<Result> {
	try {
		const response = await fetch(`${API_BASE}/api/action/${name}`, {
			method: "POST",
			headers: authHeaders(),
			body: form,
			signal: withTimeout(REQUEST_TIMEOUT_MS),
		});

		if (!response.ok) {
			if (response.status === 401) clearToken();

			let serverError: string | null = null;
			try {
				const body = (await response.json()) as { error?: unknown } | null;
				if (typeof body?.error === "string" && body.error.trim()) {
					serverError = body.error.trim();
				}
			} catch {}

			// 404 means this build asked for an action the deployed API does not expose,
			// which is a version mismatch rather than something the user did wrong.
			const error =
				response.status === 404
					? "That action is not available on the server."
					: (serverError ?? "Could not save that. Try again.");
			return { ok: false, error };
		}

		return (await response.json()) as Result;
	} catch (error) {
		// A write that ran out of time may still have landed: the request can reach the
		// server and only the answer go missing. "Could not reach the server" would invite
		// a second press, and on an add that is a second person.
		if (timedOut(error)) {
			return {
				ok: false,
				error: "The server did not answer in time. Check whether it saved before trying again.",
			};
		}
		return { ok: false, error: "Could not reach the server. Check your connection." };
	}
}

const action = (name: string) => (form: FormData) => call(name, form);

export const addPerson = action("addPerson");
export const updatePerson = action("updatePerson");
export const deletePerson = action("deletePerson");
export const addRelation = action("addRelation");
export const deleteRelation = action("deleteRelation");
export const addUnion = action("addUnion");
export const addChild = action("addChild");
export const removeChild = action("removeChild");
export const addContact = action("addContact");
export const updateContact = action("updateContact");
export const deleteContact = action("deleteContact");
export const addRelative = action("addRelative");
export const invite = action("invite");
export const revokeInvite = action("revokeInvite");
export const removeMember = action("removeMember");
export const proposeLink = action("proposeLink");
export const decideLink = action("decideLink");

/**
 * The three that are not `(FormData) => Result`, so they are not on the dispatcher.
 *
 * The Vite build is what surfaced these: `AccountMenu` imports `leave` and
 * `DemoBanner` imports the demo pair, and a missing export fails the bundle outright
 * rather than at runtime. Worth noting as the reason to build early -- typecheck
 * alone had passed, because the root tsconfig excludes this package.
 */

/**
 * SIGN OUT, despite the name.
 *
 * `leave` in `share-actions.ts` clears the demo cookie and calls Auth.js `signOut`
 * -- it does not leave a shared graph, and `AccountMenu` renders it behind a button
 * labelled "Sign out". The name misleads, and reading it as "leave a tree" was a
 * real bug in the first version of this shim: it posted to the action dispatcher,
 * which has no `leave` entry, so signing out would have 404'd silently.
 *
 * Here it revokes the session row through `/api/oauth/signout` and drops the local
 * token, which is the same outcome by the only means available cross-origin.
 *
 * The `useActionState` shape, like the real one: the previous answer and the form in,
 * a sentence out when it fails. A failure used to return nothing, so the button did
 * nothing visible and a visitor on a shared computer could walk away believing they
 * had signed out.
 */
export async function leave(_previous: string | null, _form: FormData): Promise<string | null> {
	try {
		await signOut();
	} catch {
		// Stay on the current screen with the token intact. Submitting again retries the
		// idempotent server revocation instead of turning a network failure into logout.
		return "Could not sign out. Try again.";
	}
	window.location.assign(import.meta.env.BASE_URL);
	return null;
}

async function readState<T>(path: string): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, {
		headers: authHeaders(),
		cache: "no-store",
		signal: withTimeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		if (response.status === 401) clearToken();
		const body = (await response.json().catch(() => null)) as { error?: string } | null;
		throw new Error(body?.error ?? "Could not load this page. Try again.");
	}
	return response.json() as Promise<T>;
}

export function contactState(personId: string): Promise<ContactState> {
	return readState(`/api/contacts?personId=${encodeURIComponent(personId)}`);
}

export function linkState(): Promise<LinkState> {
	return readState("/api/links");
}

/**
 * Demo mode, which is a URL here rather than a cookie.
 *
 * The server actions set an httpOnly cookie on the API host, and a cookie set there
 * is not one this origin can send. `/api/tree?demo=1` needs no cookie at all, so the
 * SPA carries the flag in its own URL instead -- same outcome, no cross-origin
 * cookie, and a demo link that survives being shared.
 */
export async function enterDemo(): Promise<void> {
	window.location.assign(`${import.meta.env.BASE_URL}tree?demo=1`);
}

export async function exitDemo(): Promise<void> {
	window.location.assign(import.meta.env.BASE_URL);
}

const SHARE_UNAVAILABLE = "Family access could not be loaded. Try again.";

/**
 * Who has access to a graph.
 *
 * A GET to its own route, because it reads and because its signature is
 * `(treeId: string) => ShareState` rather than the dispatcher's
 * `(FormData) => Result`.
 *
 * Failures THROW. An empty state used to stand in for every one of them, so a server
 * error showed the panel saying nobody had access -- a false statement about who can
 * see somebody's family, delivered as fact. The route itself answers an empty state
 * when this viewer may not see the list, so an empty list here is now always true.
 * The two messages are the ones the account bar shows.
 */
export async function shareState(treeId: string): Promise<ShareState> {
	const url = new URL(`${API_BASE}/api/share`, window.location.origin);
	url.searchParams.set("treeId", treeId);

	const response = await fetch(url, {
		headers: authHeaders(),
		cache: "no-store",
		signal: withTimeout(REQUEST_TIMEOUT_MS),
	}).catch(() => null);
	if (response?.status === 401) {
		clearToken();
		throw new Error("Your session has expired. Sign in again.");
	}
	if (!response?.ok) throw new Error(SHARE_UNAVAILABLE);

	const body = (await response.json().catch(() => null)) as ShareState | null;
	// The two lists are what the panel maps over; without them it would crash in render.
	if (!body || !Array.isArray(body.members) || !Array.isArray(body.invites)) {
		throw new Error(SHARE_UNAVAILABLE);
	}
	// Pages can serve this build minutes before Vercel serves the API that sends
	// `canManage`. The previous API let everybody who could read the list change it, so a
	// missing flag means exactly that, rather than showing the owner a read-only panel
	// until the API catches up.
	return { ...body, canManage: typeof body.canManage === "boolean" ? body.canManage : true };
}
