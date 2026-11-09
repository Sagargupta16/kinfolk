import { describe, expect, it } from "vitest";
import {
	formError,
	freshForm,
	type WriteForm,
	type WriteFormEvent,
	writeForm,
	writing,
} from "@/lib/tree/write-form";

const refused = (text: string, at = 1): WriteFormEvent => ({ type: "refused", text, at });
const run = (events: WriteFormEvent[], from: WriteForm = freshForm) =>
	events.reduce(writeForm, from);

describe("write form", () => {
	it("saves, and finishes", () => {
		const saving = run([{ type: "save" }]);
		expect(saving).toEqual({ phase: "saving" });
		expect(writing(saving)).toBe(true);
		expect(run([{ type: "save" }, { type: "saved" }])).toEqual({ phase: "done" });
	});

	it("returns to editing with the refusal when a save fails", () => {
		const failed = run([{ type: "save" }, refused("Type their name first.", 5)]);
		expect(failed).toEqual({ phase: "editing", error: { text: "Type their name first.", at: 5 } });
		expect(formError(failed)?.text).toBe("Type their name first.");
		// The next save clears it.
		expect(formError(writeForm(failed, { type: "save" }))).toBeNull();
	});

	it("refuses input without leaving the form", () => {
		expect(run([refused("A person needs a name.")])).toMatchObject({ phase: "editing" });
	});

	it("confirms a delete in place, and Keep goes back without the old error", () => {
		const asked = run([refused("stale"), { type: "askDelete" }]);
		expect(asked).toEqual({ phase: "confirming", error: null });
		expect(writeForm(asked, { type: "keep" })).toEqual(freshForm);
		expect(run([{ type: "delete" }], asked)).toEqual({ phase: "deleting" });
		expect(run([{ type: "delete" }, { type: "saved" }], asked)).toEqual({ phase: "done" });
	});

	it("stays on the confirmation with the refusal when a delete fails", () => {
		const failed = run([{ type: "askDelete" }, { type: "delete" }, refused("Could not delete.")]);
		expect(failed).toMatchObject({ phase: "confirming", error: { text: "Could not delete." } });
	});

	it("starts no second write while one is in flight", () => {
		const saving = run([{ type: "save" }]);
		for (const event of [
			{ type: "save" },
			{ type: "askDelete" },
			{ type: "delete" },
			{ type: "keep" },
		] as const) {
			expect(writeForm(saving, event)).toBe(saving);
		}
		const deleting = run([{ type: "askDelete" }, { type: "delete" }]);
		for (const event of [
			{ type: "save" },
			{ type: "askDelete" },
			{ type: "delete" },
			{ type: "keep" },
		] as const) {
			expect(writeForm(deleting, event)).toBe(deleting);
		}
	});

	it("starts no save while a delete is being confirmed", () => {
		const asked = run([{ type: "askDelete" }]);
		expect(writeForm(asked, { type: "save" })).toBe(asked);
	});

	it("stays finished until it unmounts", () => {
		const done = run([{ type: "save" }, { type: "saved" }]);
		for (const event of [
			{ type: "save" },
			{ type: "askDelete" },
			{ type: "delete" },
			{ type: "keep" },
			refused("late"),
		] satisfies WriteFormEvent[]) {
			expect(writeForm(done, event)).toBe(done);
		}
		expect(writing(done)).toBe(false);
		expect(formError(done)).toBeNull();
	});
});
