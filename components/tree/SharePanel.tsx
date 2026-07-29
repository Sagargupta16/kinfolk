"use client";

/**
 * Sharing a graph with a relative.
 *
 * An INVITE, not a copyable link, and that is the whole design. A family graph holds
 * children's names, addresses and phone numbers; a URL that grants access to whoever
 * holds it cannot be un-shared once forwarded, and it makes "who can see my grandmother's
 * address" unanswerable. An invite is addressed to a person, claimed once, expires after
 * two weeks, and can be revoked before it is used.
 *
 * Addressed by email OR GitHub username because the relative usually has no account yet.
 * That is also why the panel says access arrives on their first sign-in rather than
 * claiming an email was sent -- there is no mail sender yet, and a false "sent" costs
 * somebody a week of waiting for a message that never existed.
 */
import { Clock, Trash2, UserMinus, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import type { Result } from "@/lib/tree/edit-actions";
import { invite, removeMember, revokeInvite, type ShareState } from "@/lib/tree/share-actions";
import { cn } from "@/lib/utils";

const field = cn(
	"min-h-11 w-full rounded-md border border-hairline bg-canvas px-2.5 text-sm text-ink",
	"transition-colors duration-(--duration-fast) ease-(--ease-out)",
	"focus:border-hairline-strong focus:outline-none",
);

const heading = "mb-2 font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-ink-faint";

export function SharePanel({
	treeId,
	state,
	onClose,
	/** Re-reads who has access, so the lists reflect what just happened. */
	onChanged,
}: {
	treeId: string;
	state: ShareState;
	onClose: () => void;
	onChanged: () => void;
}) {
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	const [pending, startTransition] = useTransition();

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	function run(action: (form: FormData) => Promise<Result>) {
		return (form: FormData) => {
			setMessage(null);
			startTransition(async () => {
				const result = await action(form);
				setMessage(
					result.ok
						? // `id` carries the explanatory text for a successful invite, since
							// "Saved" would not tell somebody that no email was sent.
							{ ok: true, text: result.id ?? "Done." }
						: { ok: false, text: result.error },
				);
				if (result.ok) onChanged();
			});
		};
	}

	return (
		<div
			className={cn(
				"flex w-[min(22rem,calc(100vw-1.5rem))] flex-col",
				"max-h-[min(80vh,34rem)] overflow-hidden rounded-md border border-hairline-strong",
				"bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
			)}
		>
			<header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
				<h2 className="flex-1 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
					Share this graph
				</h2>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close sharing"
					className="flex size-7 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
				>
					<X aria-hidden className="size-4" strokeWidth={1.5} />
				</button>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
				<form action={run(invite)} className="space-y-3">
					<input type="hidden" name="treeId" value={treeId} />

					<div>
						<h3 className={heading}>Invite by email</h3>
						<input
							name="email"
							type="email"
							placeholder="relative@example.com"
							className={field}
							autoComplete="off"
						/>
					</div>

					<div>
						<h3 className={heading}>Or by GitHub username</h3>
						<input
							name="githubLogin"
							placeholder="@username"
							className={field}
							autoComplete="off"
						/>
						<p className="mt-1 text-[0.625rem] leading-snug text-ink-faint">
							Either one is enough. They do not need an account yet -- access arrives the first time
							they sign in with that address or username.
						</p>
					</div>

					<div>
						<h3 className={heading}>They can</h3>
						{/* Viewer is the default, deliberately. Seeing a family graph is already a
						    lot, and edit rights should be a second decision rather than what
						    happens when nobody thought about it. */}
						<select name="role" className={field} defaultValue="viewer">
							<option value="viewer">Look, but not change anything</option>
							<option value="editor">Add and edit people</option>
						</select>
					</div>

					<button
						type="submit"
						disabled={pending}
						className={cn(
							"flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4",
							"text-sm font-medium text-canvas transition-transform",
							"duration-(--duration-fast) ease-(--ease-out)",
							"hover:-translate-y-px active:translate-y-0 disabled:opacity-60",
						)}
					>
						{pending ? "Saving..." : "Send invite"}
					</button>
				</form>

				{message && (
					<p
						role="status"
						className={cn(
							"mt-3 rounded-md border px-2.5 py-2 text-xs leading-relaxed",
							message.ok
								? "border-hairline bg-canvas text-ink-muted"
								: "border-accent-dim bg-canvas text-ink",
						)}
					>
						{message.text}
					</p>
				)}

				{/* Who can see it, including the owner -- who has no member row, so omitting
				    them would make this list shorter than the truth. */}
				<section className="mt-4 border-t border-hairline pt-3">
					<h3 className={heading}>Who can see this</h3>
					<ul className="space-y-1.5">
						{state.members.map((member) => (
							<li key={member.userId} className="flex items-center gap-2">
								<span className="min-w-0 flex-1 truncate text-xs text-ink">{member.name}</span>
								<span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-wider text-ink-faint">
									{member.role}
								</span>
								{/* The owner is not removable: a graph with nobody who can invite,
								    revoke or delete it is a graph nobody can administer. */}
								{!member.isOwner && (
									<form action={run(removeMember)} className="shrink-0">
										<input type="hidden" name="treeId" value={treeId} />
										<input type="hidden" name="userId" value={member.userId} />
										<button
											type="submit"
											aria-label={`Remove ${member.name}`}
											className="flex size-7 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
										>
											<UserMinus aria-hidden className="size-3.5" strokeWidth={1.5} />
										</button>
									</form>
								)}
							</li>
						))}
					</ul>
				</section>

				{state.invites.length > 0 && (
					<section className="mt-4 border-t border-hairline pt-3">
						<h3 className={heading}>Waiting to be claimed</h3>
						<ul className="space-y-1.5">
							{state.invites.map((row) => (
								<li key={row.id} className="flex items-center gap-2">
									<Clock aria-hidden className="size-3 shrink-0 text-ink-faint" strokeWidth={1.5} />
									<span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
										{row.addressedTo}
									</span>
									<span className="tabular shrink-0 font-mono text-[0.5625rem] text-ink-faint">
										{row.expiresAt}
									</span>
									<form action={run(revokeInvite)} className="shrink-0">
										<input type="hidden" name="inviteId" value={row.id} />
										<button
											type="submit"
											aria-label={`Withdraw the invite to ${row.addressedTo}`}
											className="flex size-7 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
										>
											<Trash2 aria-hidden className="size-3.5" strokeWidth={1.5} />
										</button>
									</form>
								</li>
							))}
						</ul>
					</section>
				)}
			</div>
		</div>
	);
}
