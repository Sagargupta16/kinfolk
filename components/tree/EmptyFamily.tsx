"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { addPerson } from "@/lib/tree/edit-actions";

export function EmptyFamily({ treeId }: { treeId: string | null }) {
	const router = useRouter();
	const id = useId();
	const [error, setError] = useState("");
	const [pending, startTransition] = useTransition();
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
							aria-busy={pending}
							onSubmit={(event) => {
								event.preventDefault();
								if (pending) return;
								const form = new FormData(event.currentTarget);
								setError("");
								startTransition(async () => {
									try {
										const result = await addPerson(form);
										if (result.ok) router.refresh();
										else setError(result.error);
									} catch {
										setError("Could not add that person. Try again.");
									}
								});
							}}
						>
							<input type="hidden" name="treeId" value={treeId} />
							<label htmlFor={`${id}-given`} className="block text-xs text-ink-muted">
								First name
							</label>
							<input
								id={`${id}-given`}
								name="givenName"
								required
								autoComplete="off"
								maxLength={200}
								className="min-h-11 w-full rounded-md border border-hairline bg-surface px-3 text-sm"
							/>
							<label htmlFor={`${id}-family`} className="block text-xs text-ink-muted">
								Family name <span className="text-ink-faint">(optional)</span>
							</label>
							<input
								id={`${id}-family`}
								name="familyName"
								autoComplete="off"
								maxLength={200}
								className="min-h-11 w-full rounded-md border border-hairline bg-surface px-3 text-sm"
							/>
							<button
								type="submit"
								disabled={pending}
								className="min-h-11 w-full rounded-md bg-ink px-4 text-sm text-canvas disabled:opacity-60"
							>
								{pending ? "Adding..." : "Add the first person"}
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
