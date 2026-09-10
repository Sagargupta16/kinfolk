"use client";

import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { contactState } from "@/lib/tree/contact-state";
import { CONTACT_KINDS, CONTACT_VISIBILITY, type ContactState } from "@/lib/tree/contacts";
import { addContact, deleteContact, type Result, updateContact } from "@/lib/tree/edit-actions";
import { AppearanceMenu } from "../ui/AppearanceMenu";

const field = "min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink";
const button =
	"inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-hairline px-3 text-sm text-ink hover:bg-surface-raised disabled:opacity-60";

type ContactWorkspaceProps = {
	personId: string;
	initialState?: ContactState;
	initialError?: string;
};

export function ContactWorkspace(props: ContactWorkspaceProps) {
	return <ContactRecord key={props.personId} {...props} />;
}

function ContactRecord({ personId, initialState, initialError }: ContactWorkspaceProps) {
	const [state, setState] = useState(initialState);
	const [error, setError] = useState(initialError ?? "");
	const [editing, setEditing] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	const [pending, startTransition] = useTransition();
	const reload = useCallback(async () => {
		try {
			setState(await contactState(personId));
			setError("");
		} catch {
			setState(undefined);
			setError("These details could not be loaded. Check your access and try again.");
		}
	}, [personId]);

	useEffect(() => {
		if (!initialState && !initialError) void reload();
	}, [initialState, initialError, reload]);

	function save(action: (form: FormData) => Promise<Result>, form: FormData) {
		if (pending) return;
		setMessage(null);
		startTransition(async () => {
			try {
				const result = await action(form);
				if (!result.ok) {
					setMessage({ ok: false, text: result.error });
					return;
				}
				setEditing(null);
				setDeleting(null);
				await reload();
				setMessage({
					ok: true,
					text: action === deleteContact ? "Contact detail removed." : "Saved.",
				});
			} catch {
				setMessage({
					ok: false,
					text:
						action === deleteContact
							? "Could not remove that detail. Try again."
							: "Could not save that. Try again.",
				});
			}
		});
	}

	return (
		<main className="min-h-dvh bg-canvas text-ink">
			<header className="flex items-center justify-between border-b border-hairline px-4 py-3 sm:px-8">
				<Link href="/tree" className={button}>
					<ArrowLeft className="size-4" aria-hidden />
					Family tree
				</Link>
				<AppearanceMenu />
			</header>
			<div className="mx-auto max-w-2xl px-4 py-8 sm:px-8">
				<p className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint">
					Private family record
				</p>
				<h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
					Contact details{state ? ` for ${state.name}` : ""}
				</h1>
				<p className="mt-3 text-sm leading-relaxed text-ink-muted">
					Values appear on this page only. Each detail has its own audience; new details are visible
					to this family's members.
				</p>
				{error ? (
					<div className="mt-6 space-y-3">
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
						<button type="button" className={button} onClick={() => void reload()}>
							Try again
						</button>
					</div>
				) : !state ? (
					<p role="status" className="mt-6 text-sm text-ink-muted">
						Loading details...
					</p>
				) : (
					<>
						<div className="mt-6 divide-y divide-hairline rounded-2xl border border-hairline bg-surface px-5">
							{state.contacts.length === 0 && (
								<p className="py-5 text-sm text-ink-muted">No contact details are available.</p>
							)}
							{state.contacts.map((contact) => (
								<section key={contact.id} className="py-5">
									{editing === contact.id ? (
										<ContactForm
											contact={contact}
											personId={personId}
											pending={pending}
											onSubmit={(form) => save(updateContact, form)}
											onCancel={() => setEditing(null)}
										/>
									) : (
										<>
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													<h2 className="text-sm font-medium">
														{CONTACT_KINDS.find(({ value }) => value === contact.kind)?.label}
														{contact.label ? ` · ${contact.label}` : ""}
													</h2>
													<p className="mt-2 whitespace-pre-wrap break-words text-base">
														{contact.value}
													</p>
													<p className="mt-2 text-xs leading-relaxed text-ink-faint">
														{
															CONTACT_VISIBILITY.find(({ value }) => value === contact.visibility)
																?.label
														}
													</p>
												</div>
												{state.editable && (
													<button
														type="button"
														className={button}
														disabled={pending}
														aria-label={`Edit ${contact.label ?? contact.kind}`}
														onClick={() => {
															setEditing(contact.id);
															setDeleting(null);
															setMessage(null);
														}}
													>
														<Pencil className="size-4" aria-hidden />
													</button>
												)}
											</div>
											{state.editable && (
												<div className="mt-3">
													{deleting === contact.id ? (
														<div className="flex flex-wrap items-center gap-2">
															<p className="w-full text-sm text-ink-muted">
																Remove this contact detail?
															</p>
															<button
																type="button"
																className={`${button} text-danger`}
																disabled={pending}
																onClick={() => {
																	const form = new FormData();
																	form.set("contactId", contact.id);
																	save(deleteContact, form);
																}}
															>
																Remove detail
															</button>
															<button
																type="button"
																className={button}
																disabled={pending}
																onClick={() => setDeleting(null)}
															>
																Keep it
															</button>
														</div>
													) : (
														<button
															type="button"
															className={button}
															disabled={pending}
															onClick={() => {
																setDeleting(contact.id);
																setEditing(null);
																setMessage(null);
															}}
														>
															<Trash2 className="size-4" aria-hidden />
															Remove
														</button>
													)}
												</div>
											)}
										</>
									)}
								</section>
							))}
						</div>
						{state.editable && (
							<div className="mt-6">
								{editing === "new" ? (
									<ContactForm
										personId={personId}
										pending={pending}
										onSubmit={(form) => save(addContact, form)}
										onCancel={() => setEditing(null)}
									/>
								) : (
									<button
										type="button"
										className="kf-primary-action"
										disabled={pending}
										onClick={() => {
											setEditing("new");
											setDeleting(null);
											setMessage(null);
										}}
									>
										<Plus className="size-4" aria-hidden />
										Add contact detail
									</button>
								)}
							</div>
						)}
					</>
				)}
				{message && (
					<p
						role={message.ok ? "status" : "alert"}
						className="mt-4 text-sm leading-relaxed text-ink-muted"
					>
						{message.text}
					</p>
				)}
			</div>
		</main>
	);
}

function ContactForm({
	personId,
	contact,
	pending,
	onSubmit,
	onCancel,
}: {
	personId: string;
	contact?: ContactState["contacts"][number];
	pending: boolean;
	onSubmit: (form: FormData) => void;
	onCancel: () => void;
}) {
	const id = useId();
	const valueRef = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		valueRef.current?.focus();
	}, []);
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (!pending) onSubmit(new FormData(event.currentTarget));
			}}
			aria-busy={pending}
			className="space-y-4"
		>
			<input type="hidden" name="personId" value={personId} />
			{contact && <input type="hidden" name="contactId" value={contact.id} />}
			<div>
				<label htmlFor={`${id}-kind`} className="mb-1 block text-sm">
					Channel
				</label>
				<select
					id={`${id}-kind`}
					name="kind"
					className={field}
					defaultValue={contact?.kind ?? "phone"}
				>
					{CONTACT_KINDS.map(({ value, label }) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</select>
			</div>
			<div>
				<label htmlFor={`${id}-value`} className="mb-1 block text-sm">
					Value
				</label>
				<textarea
					ref={valueRef}
					id={`${id}-value`}
					name="value"
					required
					maxLength={2000}
					rows={2}
					defaultValue={contact?.value ?? ""}
					className={`${field} py-2`}
					autoComplete="off"
				/>
			</div>
			<div>
				<label htmlFor={`${id}-label`} className="mb-1 block text-sm">
					Label <span className="text-ink-faint">(optional)</span>
				</label>
				<input
					id={`${id}-label`}
					name="label"
					maxLength={100}
					defaultValue={contact?.label ?? ""}
					className={field}
					placeholder="Home, work, old number..."
				/>
			</div>
			<div>
				<label htmlFor={`${id}-visibility`} className="mb-1 block text-sm">
					Who can see this
				</label>
				<select
					id={`${id}-visibility`}
					name="visibility"
					className={field}
					defaultValue={contact?.visibility ?? "tree"}
				>
					{CONTACT_VISIBILITY.map(({ value, label }) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</select>
			</div>
			<div className="flex flex-wrap gap-2">
				<button type="submit" className={`${button} bg-ink text-canvas`} disabled={pending}>
					{pending ? "Saving..." : "Save detail"}
				</button>
				<button type="button" className={button} disabled={pending} onClick={onCancel}>
					Cancel
				</button>
			</div>
		</form>
	);
}
