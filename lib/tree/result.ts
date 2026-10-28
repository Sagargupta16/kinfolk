/**
 * What every write action answers.
 *
 * Its own module rather than a type inside `edit-actions.ts`, because the SPA aliases
 * that file to an HTTP shim: a second hand-written copy of this union there would
 * compile against nothing, so a new variant on the server would drift silently from
 * the client that renders it.
 */
export type Result =
	| { ok: true; id?: string }
	| { ok: false; error: string; confirmation?: "additional-relation" };
