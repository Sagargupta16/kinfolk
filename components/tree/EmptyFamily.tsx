"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { addPerson } from "@/lib/tree/edit-actions";
import { splitName } from "@/lib/tree/kin-plan";

export function EmptyFamily({ treeId }: { treeId: string | null }) {
	const router = useRouter();
	const id = useId();
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();
	/**
	 * Saved, and waiting for the view to change -- which unmounts this screen.
	 *
	 * In Next the refresh is part of the transition, so `pending` covers it. In the SPA
	 * `router.refresh()` only asks for a re-read and returns at once, so without this the
	 * button came back with the name still typed and a second tap added the same person
	 * twice.
	 */
	const [added, setAdded] = useState(false);
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
							aria-busy={pending || added}
							onSubmit={(event) => {
								event.preventDefault();
								if (pending || added) return;
								const form = new FormData(event.currentTarget);
								// The two columns too, which is all the previous API version reads while the
								// app and the API are mid-deploy; the current one lets `name` win.
								const columns = splitName(String(form.get("name") ?? ""));
								if (columns.givenName) form.set("givenName", columns.givenName);
								if (columns.familyName) form.set("familyName", columns.familyName);
								setError("");
								startTransition(async () => {
									try {
										const result = await addPerson(form);
										if (result.ok) {
											setAdded(true);
											router.refresh();
										} else setError(result.error);
									} catch {
										setError("Could not add that person. Try again.");
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
								disabled={pending || added}
								className="min-h-11 w-full rounded-md bg-ink px-4 text-sm text-canvas disabled:opacity-60"
							>
								{pending ? "Adding..." : added ? "Added" : "Add the first person"}
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
