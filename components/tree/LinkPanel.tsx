"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useEffect, useId, useState, useTransition } from "react";
import type { Result } from "@/lib/tree/edit-actions";
import { decideLink, linkState, proposeLink } from "@/lib/tree/link-actions";
import type { LinkState } from "@/lib/tree/links";
import { useEscapeClose } from "./escape";

const field = "min-h-11 w-full rounded-md border border-hairline bg-canvas px-2.5 text-sm text-ink";
const button =
	"min-h-11 rounded-md border border-hairline px-3 text-xs text-ink hover:bg-surface-raised disabled:opacity-60";
const consentText =
	"Linking shows both families' trees to their members and shares contact details marked for linked families. Each family keeps its own records. Either owner can unlink later.";

export function LinkPanel({ onClose }: { onClose: () => void }) {
	const id = useId();
	const router = useRouter();
	const [state, setState] = useState<LinkState | null>(null);
	const [fromId, setFromId] = useState("");
	const [toId, setToId] = useState("");
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	const [pending, startTransition] = useTransition();
	useEscapeClose(true, onClose);
	useEffect(() => {
		let active = true;
		void linkState()
			.then((value) => {
				if (active) setState(value);
			})
			.catch(() => {
				if (active) setMessage({ ok: false, text: "Could not load family links. Try again." });
			});
		return () => {
			active = false;
		};
	}, []);

	function submit(action: (form: FormData) => Promise<Result>) {
		return (event: SubmitEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (pending) return;
			const element = event.currentTarget;
			const form = new FormData(element, event.nativeEvent.submitter);
			setMessage(null);
			startTransition(async () => {
				try {
					const result = await action(form);
					if (!result.ok) {
						setMessage({ ok: false, text: result.error });
						return;
					}
					element.reset();
					if (action === proposeLink) setToId("");
					router.refresh();
					try {
						setState(await linkState());
						setMessage({ ok: true, text: "Saved." });
					} catch {
						setState(null);
						setMessage({
							ok: false,
							text: "Your change was saved, but the updated links could not be loaded. Try again to reload them.",
						});
					}
				} catch {
					setMessage({ ok: false, text: "Could not save that. Try again." });
				}
			});
		};
	}
	const source = state?.candidates.find(({ id: personId }) => personId === fromId);
	const targets =
		state?.candidates.filter(({ treeId }) => source && treeId !== source.treeId) ?? [];

	return (
		<aside
			aria-labelledby={id}
			className="kf-sheet flex max-h-[calc(100dvh-6rem)] w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-hairline-strong bg-surface shadow-lg"
		>
			<header className="flex items-center gap-3 border-b border-hairline px-4 py-2">
				<h2 id={id} className="flex-1 text-sm font-medium">
					Link family records
				</h2>
				<button
					type="button"
					className="flex size-11 items-center justify-center text-ink-faint"
					aria-label="Close family links"
					onClick={onClose}
				>
					<X className="size-4" aria-hidden />
				</button>
			</header>
			<div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain p-4">
				<p className="text-xs leading-relaxed text-ink-muted">
					Use a link when two families have recorded the same person. {consentText}
				</p>
				{!state && !message && (
					<p role="status" className="text-sm text-ink-muted">
						Loading links...
					</p>
				)}
				{state && (
					<>
						{state.candidates.some(({ owned }) => owned) ? (
							<form onSubmit={submit(proposeLink)} aria-busy={pending} className="space-y-3">
								<label className="block text-xs" htmlFor={`${id}-from`}>
									Your family's record
								</label>
								<select
									id={`${id}-from`}
									name="fromPersonId"
									className={field}
									required
									disabled={pending}
									value={fromId}
									onChange={(event) => {
										setFromId(event.target.value);
										setToId("");
										setMessage(null);
									}}
								>
									<option value="">Choose a person</option>
									{state.candidates
										.filter(({ owned }) => owned)
										.map((person) => (
											<option key={person.id} value={person.id}>
												{person.name} · {person.treeName}
											</option>
										))}
								</select>
								<label className="block text-xs" htmlFor={`${id}-to`}>
									The same person in another family
								</label>
								<select
									key={fromId}
									id={`${id}-to`}
									name="toPersonId"
									className={field}
									required
									disabled={pending || !source || targets.length === 0}
									value={toId}
									onChange={(event) => {
										setToId(event.target.value);
										setMessage(null);
									}}
								>
									<option value="">Choose their other record</option>
									{targets.map((person) => (
										<option key={person.id} value={person.id}>
											{person.name} · {person.treeName}
										</option>
									))}
								</select>
								{source && targets.length === 0 && (
									<p className="text-xs leading-relaxed text-ink-muted">
										Invite the other family through Family access, or ask them to invite you, so
										both records are visible before proposing a link.
									</p>
								)}
								<label className="block text-xs" htmlFor={`${id}-note`}>
									Why these records describe the same person (optional)
								</label>
								<textarea
									key={`${fromId}:${toId}`}
									id={`${id}-note`}
									name="note"
									className={`${field} py-2`}
									rows={2}
									maxLength={1000}
								/>
								<Consent key={`${fromId}:${toId}`} id={`${id}-propose`} />
								<button
									type="submit"
									className={`${button} w-full`}
									disabled={pending || targets.length === 0}
								>
									Propose link
								</button>
							</form>
						) : (
							<p className="text-sm text-ink-muted">
								Only family owners can propose and approve links.
							</p>
						)}
						<div className="space-y-4 border-t border-hairline pt-4">
							<h3 className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint">
								Proposals and linked records
							</h3>
							{state.proposals.length === 0 && (
								<p className="text-xs text-ink-muted">No proposals yet.</p>
							)}
							{state.proposals.map((proposal) => (
								<section
									key={proposal.id}
									className="space-y-2 rounded-md border border-hairline p-3"
								>
									<p className="text-xs leading-relaxed">
										{proposal.a}
										<br />
										<span className="text-ink-faint">matches</span>
										<br />
										{proposal.b}
									</p>
									<p className="text-xs capitalize text-accent-ink">{proposal.status}</p>
									{proposal.note && (
										<p className="whitespace-pre-wrap break-words text-xs text-ink-muted">
											{proposal.note}
										</p>
									)}
									{proposal.canDecide && (
										<form onSubmit={submit(decideLink)} aria-busy={pending} className="space-y-2">
											<input type="hidden" name="linkId" value={proposal.id} />
											<Consent id={`${id}-${proposal.id}`} />
											<div className="flex flex-wrap gap-2">
												<button
													className={button}
													name="decision"
													value="accept"
													type="submit"
													disabled={pending}
												>
													Accept and link families
												</button>
												<button
													className={button}
													name="decision"
													value="reject"
													type="submit"
													formNoValidate
													disabled={pending}
												>
													Reject
												</button>
											</div>
										</form>
									)}
									{proposal.canRevoke && (
										<RevokeLink
											id={proposal.id}
											accepted={proposal.status === "accepted"}
											pending={pending}
											onSubmit={submit(decideLink)}
										/>
									)}
								</section>
							))}
						</div>
					</>
				)}
				{message && (
					<div className="space-y-3">
						<p
							role={message.ok ? "status" : "alert"}
							className="text-sm leading-relaxed text-ink-muted"
						>
							{message.text}
						</p>
						{!state && (
							<button
								type="button"
								className={button}
								disabled={pending}
								onClick={() => {
									setMessage(null);
									startTransition(async () => {
										try {
											setState(await linkState());
										} catch {
											setMessage({ ok: false, text: "Could not load family links. Try again." });
										}
									});
								}}
							>
								Try again
							</button>
						)}
					</div>
				)}
			</div>
		</aside>
	);
}

function Consent({ id }: { id: string }) {
	return (
		<label
			htmlFor={id}
			className="flex min-h-11 items-start gap-2 text-xs leading-relaxed text-ink-muted"
		>
			<input
				id={id}
				name="consent"
				value="true"
				type="checkbox"
				required
				className="mt-1 size-4 shrink-0 accent-accent"
			/>
			I understand what linking shares and agree to connect these family records.
		</label>
	);
}

function RevokeLink({
	id,
	accepted,
	pending,
	onSubmit,
}: {
	id: string;
	accepted: boolean;
	pending: boolean;
	onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
}) {
	const [confirming, setConfirming] = useState(false);
	if (!confirming)
		return (
			<button
				type="button"
				className={button}
				disabled={pending}
				onClick={() => setConfirming(true)}
			>
				{accepted ? "Unlink families" : "Withdraw proposal"}
			</button>
		);
	return (
		<form onSubmit={onSubmit} aria-busy={pending} className="space-y-2">
			<input type="hidden" name="linkId" value={id} />
			<input type="hidden" name="decision" value="revoke" />
			<p className="text-xs leading-relaxed text-ink-muted">
				Both families keep their records. Access through this link will end; separate invitations
				and other accepted links still apply.
			</p>
			<div className="flex gap-2">
				<button type="submit" className={button} disabled={pending}>
					{accepted ? "Confirm unlink" : "Confirm withdrawal"}
				</button>
				<button
					type="button"
					className={button}
					onClick={() => setConfirming(false)}
					disabled={pending}
				>
					Cancel
				</button>
			</div>
		</form>
	);
}
