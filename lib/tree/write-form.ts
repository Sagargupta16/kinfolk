/**
 * The lifecycle of a form that writes a record, and can delete it after a confirmation.
 *
 * Four forms write a person: the add strip, the edit strip, the profile's edit form and the
 * empty family's first person. Each held this as flags -- `pending`, `confirming` or
 * `confirmDelete`, `added`, an error -- and the combinations had drifted apart. The edit
 * strip left its delete button live while a save was in flight, so a delete could be
 * confirmed under a save the profile form refused to start; one form cleared its error on
 * Keep and the other did not; and the empty family needed an `added` flag bolted on after a
 * second tap added the first person twice, because "saved, waiting for the view to change"
 * was not a state anything could be in.
 *
 * As phases, each of those is a missing transition rather than a flag to remember:
 *
 *   editing  --save-->     saving    --saved--> done
 *                          saving    --refused--> editing, with the error
 *   editing  --askDelete--> confirming --keep--> editing
 *   confirming --delete--> deleting  --saved--> done
 *                          deleting  --refused--> confirming, with the error
 *
 * Every other event is ignored in a phase that has no transition for it: no delete can be
 * asked for while a save is in flight, no save starts while a delete is being confirmed, and
 * a finished form stays finished until it unmounts. A form that closes on success simply
 * unmounts; `done` is for one that waits on screen for the refreshed view.
 *
 * Pure, no React, like the rest of lib/tree.
 */

/** A refusal to show. `at` makes a repeat of the same text a new notice, for the shake. */
export type Notice = { text: string; at: number };

export type WriteForm =
	| { phase: "editing"; error: Notice | null }
	| { phase: "saving" }
	| { phase: "confirming"; error: Notice | null }
	| { phase: "deleting" }
	| { phase: "done" };

export type WriteFormEvent =
	| { type: "save" }
	| { type: "saved" }
	/** The server refused, the write failed, or the form itself refused the input. */
	| { type: "refused"; text: string; at: number }
	| { type: "askDelete" }
	| { type: "keep" }
	| { type: "delete" };

export const freshForm: WriteForm = { phase: "editing", error: null };

/** A write in flight: every control that would start another is disabled. */
export function writing(form: WriteForm): boolean {
	return form.phase === "saving" || form.phase === "deleting";
}

/** The refusal to show, in the phase that shows one. */
export function formError(form: WriteForm): Notice | null {
	return form.phase === "editing" || form.phase === "confirming" ? form.error : null;
}

export function writeForm(form: WriteForm, event: WriteFormEvent): WriteForm {
	switch (form.phase) {
		case "editing":
			if (event.type === "save") return { phase: "saving" };
			if (event.type === "askDelete") return { phase: "confirming", error: null };
			if (event.type === "refused") return { phase: "editing", error: notice(event) };
			return form;
		case "saving":
			if (event.type === "saved") return { phase: "done" };
			if (event.type === "refused") return { phase: "editing", error: notice(event) };
			return form;
		case "confirming":
			if (event.type === "delete") return { phase: "deleting" };
			if (event.type === "keep") return freshForm;
			if (event.type === "refused") return { phase: "confirming", error: notice(event) };
			return form;
		case "deleting":
			if (event.type === "saved") return { phase: "done" };
			if (event.type === "refused") return { phase: "confirming", error: notice(event) };
			return form;
		case "done":
			return form;
	}
}

function notice(event: { text: string; at: number }): Notice {
	return { text: event.text, at: event.at };
}
