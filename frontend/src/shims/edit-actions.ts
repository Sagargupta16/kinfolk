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
