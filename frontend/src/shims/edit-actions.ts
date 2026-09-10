/**
 * The server actions, as HTTP calls.
 *
 * Aliased over `@/lib/tree/edit-actions` so the eight components that import
 * `addPerson`, `updatePerson` and the rest keep working with no edits. Each export
 * has the SAME signature as the action it replaces -- `(form: FormData) =>
 * Promise<Result>` -- because React's `<form action={...}>` hands a FormData to
 * whatever it is given, and the whole point is that the forms do not change.
 *
 * `Result` is re-exported as a type so `SharePanel` and friends can import it from
 * here exactly as they do today.
 *
 * What this file must NOT do is make a permission decision. It posts to
 * `/api/action/<name>`, which calls the real action, which starts with its own auth
 * check and goes on to `lib/tree/authz.ts`. A client that lied about its own
 * permissions would simply be refused by the server.
 */

import type { ContactState } from "@/lib/tree/contacts";
import type { LinkState } from "@/lib/tree/links";
import { API_BASE, authHeaders, clearToken } from "../api";
import { signOut } from "../auth";

export type Result =
	| { ok: true; id?: string }
	| { ok: false; error: string; confirmation?: "additional-relation" };

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
	} catch {
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
 * Returns `void` because React's `<form action={...}>` requires it, and because the
 * real one does too. The frontend typecheck insisted on that, having been the only
 * check that looks at this file.
 */
export async function leave(_form: FormData): Promise<void> {
	try {
		await signOut();
	} catch {
		// Stay on the current screen with the token intact. Submitting again retries the
		// idempotent server revocation instead of turning a network failure into logout.
		return;
	}
	window.location.assign(import.meta.env.BASE_URL);
}

async function readState<T>(path: string): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), cache: "no-store" });
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

export type ShareState = {
	members: { userId: string; name: string; role: string; isOwner: boolean }[];
	invites: { id: string; addressedTo: string; role: string; expiresAt: string }[];
};

/**
 * Who has access to a graph.
 *
 * A GET to its own route, because it reads and because its signature is
 * `(treeId: string) => ShareState` rather than the dispatcher's
 * `(FormData) => Result`.
 *
 * An empty state on failure, matching what the real action does when the viewer
 * cannot see the graph: the panel then shows "nobody yet" instead of an error, which
 * is the truthful reading of "you may not know".
 */
export async function shareState(treeId: string): Promise<ShareState> {
	try {
		const url = new URL(`${API_BASE}/api/share`, window.location.origin);
		url.searchParams.set("treeId", treeId);
		const response = await fetch(url, { headers: authHeaders() });
		if (!response.ok) {
			if (response.status === 401) clearToken();
			return { members: [], invites: [] };
		}
		return (await response.json()) as ShareState;
	} catch {
		return { members: [], invites: [] };
	}
}
