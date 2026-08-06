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
import { API_BASE, authHeaders } from "../api";

export type Result = { ok: true; id?: string } | { ok: false; error: string };

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

		// 404 means this build asked for an action the deployed API does not expose,
		// which is a version mismatch rather than something the user did wrong.
		if (response.status === 404) {
			return { ok: false, error: "That action is not available on the server." };
		}

		// Every other status carries the action's own JSON, including the 401 the
		// route raises for an auth refusal.
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
export const deleteContact = action("deleteContact");
export const addRelative = action("addRelative");
export const invite = action("invite");
export const revokeInvite = action("revokeInvite");
export const removeMember = action("removeMember");

/**
 * The three that are not `(FormData) => Result`, so they are not on the dispatcher.
 *
 * The Vite build is what surfaced these: `AccountMenu` imports `leave` and
 * `DemoBanner` imports the demo pair, and a missing export fails the bundle outright
 * rather than at runtime. Worth noting as the reason to build early -- typecheck
 * alone had passed, because the root tsconfig excludes this package.
 */

/**
 * Leave a shared graph.
 *
 * Returns `void`, not `Result`, and the frontend typecheck is what insisted: React's
 * `<form action={...}>` accepts `(formData) => void | Promise<void>`, so a shim
 * returning a value does not satisfy the prop even though it runs fine. The real
 * `leave()` returns void too, so matching it is also the correct shape.
 *
 * On success it navigates away, which is what the server action achieved with a
 * `redirect()`. A failure is swallowed for the same reason the real one has no error
 * channel: the component renders no place to put one.
 */
export async function leave(form: FormData): Promise<void> {
	const result = await call("leave", form);
	if (result.ok) window.location.assign(import.meta.env.BASE_URL);
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
		if (!response.ok) return { members: [], invites: [] };
		return (await response.json()) as ShareState;
	} catch {
		return { members: [], invites: [] };
	}
}
