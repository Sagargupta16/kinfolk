"use client";

import { useRouter } from "next/navigation";
import { useId, useReducer, useTransition } from "react";
import { addPerson } from "@/lib/tree/edit-actions";
import { splitName } from "@/lib/tree/kin-plan";
import { formError, freshForm, writeForm } from "@/lib/tree/write-form";

export function EmptyFamily({ treeId }: { treeId: string | null }) {
	const router = useRouter();
	const id = useId();
	const [, startTransition] = useTransition();
	/**
	 * The write lifecycle (lib/tree/write-form.ts), ending in `done`: saved, and waiting for
	 * the view to change -- which unmounts this screen.
	 *
	 * That wait is a state of its own because the two runtimes differ. In Next the refresh is
	 * part of the transition; in the SPA `router.refresh()` only asks for a re-read and returns
	 * at once, so a form that went back to editing came back with the name still typed, and a
	 * second tap added the same person twice.
	 */
	const [form, dispatch] = useReducer(writeForm, freshForm);
	const error = formError(form)?.text;
	return (
		<div className="flex h-full items-center justify-center overflow-y-auto px-4 py-8">
			<div className="w-full max-w-sm space-y-4">
				<h2 className="text-xl font-medium text-ink">This family has no people yet.</h2>
				{treeId ? (
					<>
						<p className="text-sm leading-relaxed text-ink-muted">
							Start with one person, then add relatives from their card.
						</p>
						<form
							className="space-y-3"
							aria-busy={form.phase !== "editing"}
							onSubmit={(event) => {
								event.preventDefault();
								if (form.phase !== "editing") return;
								const data = new FormData(event.currentTarget);
								// The two columns too, which is all the previous API version reads while the
								// app and the API are mid-deploy; the current one lets `name` win.
								const columns = splitName(String(data.get("name") ?? ""));
								if (columns.givenName) data.set("givenName", columns.givenName);
								if (columns.familyName) data.set("familyName", columns.familyName);
								dispatch({ type: "save" });
								startTransition(async () => {
									try {
										const result = await addPerson(data);
										if (result.ok) {
											dispatch({ type: "saved" });
											router.refresh();
										} else dispatch({ type: "refused", text: result.error, at: Date.now() });
									} catch {
										dispatch({
											type: "refused",
											text: "Could not add that person. Try again.",
											at: Date.now(),
										});
									}
								});
							}}
						>
							<input type="hidden" name="treeId" value={treeId} />
							{/* One name field, split on its last word by the server, like the canvas `+`. */}
							<label htmlFor={`${id}-name`} className="block text-xs text-ink-muted">
								Name
							</label>
							<input
								id={`${id}-name`}
								name="name"
								required
								autoComplete="off"
								autoCapitalize="words"
								maxLength={120}
								placeholder="Full name"
								className="min-h-11 w-full rounded-md border border-hairline bg-surface px-3 text-base"
							/>
							<button
								type="submit"
								disabled={form.phase !== "editing"}
								className="min-h-11 w-full rounded-md bg-ink px-4 text-sm text-canvas disabled:opacity-60"
							>
								{form.phase === "saving"
									? "Adding..."
									: form.phase === "done"
										? "Added"
										: "Add the first person"}
							</button>
						</form>
						{error && (
							<p role="alert" className="text-sm text-danger">
								{error}
							</p>
						)}
					</>
				) : (
					<p className="text-sm leading-relaxed text-ink-muted">
						A family editor can add the first person.
					</p>
				)}
			</div>
		</div>
	);
}
