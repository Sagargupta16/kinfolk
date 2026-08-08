"use client";

/**
 * Private family-tree access.
 *
 * An invite is addressed to one identity, claimed once, expires after two weeks, and can
 * be withdrawn. That keeps a family record answerable: the owner can always see exactly who
 * has access instead of relying on a link that may have been forwarded.
 */
import {
	AlertCircle,
	AtSign,
	CheckCircle2,
	Clock,
	Loader2,
	Mail,
	ShieldCheck,
	Trash2,
	UserMinus,
	UserPlus,
	UserRound,
	X,
} from "lucide-react";
import { useState, useTransition } from "react";
import type { Result } from "@/lib/tree/edit-actions";
import { invite, removeMember, revokeInvite, type ShareState } from "@/lib/tree/share-actions";
import { cn } from "@/lib/utils";
import { useEscapeClose } from "./escape";

const field = cn(
	"min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink",
	"placeholder:text-ink-faint transition-colors duration-(--duration-fast) ease-(--ease-out)",
	"focus:border-hairline-strong focus:outline-none",
);

const heading = "font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-ink-faint";
const fieldLabel = "mb-1.5 block text-[0.6875rem] font-medium text-ink-muted";

function accessLabel(role: string): string {
	if (role === "owner") return "Owner";
	if (role === "editor") return "Can edit";
	return "Can view";
}

export function SharePanel({
	treeId,
	state,
	onClose,
	onChanged,
}: {
	treeId: string;
	state: ShareState;
	onClose: () => void;
	/** Re-read access after a successful mutation. */
	onChanged: () => void;
}) {
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	const [method, setMethod] = useState<"email" | "github">("email");
	const [pending, startTransition] = useTransition();

	// Escape closes, through the shared surface stack. Mounted only while open.
	useEscapeClose(true, onClose);

	function run(action: (form: FormData) => Promise<Result>) {
		return (form: FormData) => {
			setMessage(null);
			startTransition(async () => {
				const result = await action(form);
				setMessage(
					result.ok
						? { ok: true, text: result.id ?? "Access updated." }
						: { ok: false, text: result.error },
				);
				if (result.ok) onChanged();
			});
		};
	}

	return (
		<div
			className={cn(
				"flex w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-hidden",
				"max-h-[min(82dvh,38rem)] rounded-lg border border-hairline-strong",
				"bg-surface shadow-(--kf-shadow-panel)",
			)}
		>
			<header className="flex shrink-0 items-center gap-3 border-b border-hairline px-3 py-2.5">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent-ink">
					<ShieldCheck className="size-4" strokeWidth={1.75} aria-hidden="true" />
				</div>
				<div className="min-w-0 flex-1">
					<p className={heading}>Private sharing</p>
					<h2 className="text-sm font-medium text-ink">Family access</h2>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close family access"
					className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-raised hover:text-ink"
				>
					<X aria-hidden className="size-4" strokeWidth={1.5} />
				</button>
			</header>

			<div className="flex shrink-0 items-start gap-2 border-b border-hairline bg-canvas/60 px-3 py-2.5">
				<ShieldCheck
					className="mt-0.5 size-3.5 shrink-0 text-accent-ink"
					strokeWidth={1.75}
					aria-hidden="true"
				/>
				<p className="text-[0.6875rem] leading-relaxed text-ink-muted">
					Only the people listed here can open this family tree.
				</p>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
				<form action={run(invite)} className="space-y-3">
					<input type="hidden" name="treeId" value={treeId} />

					<div>
						<h3 className="text-[0.875rem] font-medium text-ink">Invite a relative</h3>
						<p className="mt-0.5 text-[0.6875rem] leading-relaxed text-ink-faint">
							Their access begins when they first sign in with the same identity.
						</p>
					</div>

					<fieldset>
						<legend className={fieldLabel}>Invite with</legend>
						<div className="grid grid-cols-2 overflow-hidden rounded-lg border border-hairline">
							<button
								type="button"
								onClick={() => setMethod("email")}
								aria-pressed={method === "email"}
								className={cn(
									"flex min-h-11 items-center justify-center gap-2 border-r border-hairline px-2",
									"text-[0.75rem] font-medium transition-colors",
									method === "email"
										? "bg-surface-raised text-accent-ink"
										: "text-ink-muted hover:bg-surface-raised hover:text-ink",
								)}
							>
								<Mail className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
								Email
							</button>
							<button
								type="button"
								onClick={() => setMethod("github")}
								aria-pressed={method === "github"}
								className={cn(
									"flex min-h-11 items-center justify-center gap-2 px-2",
									"text-[0.75rem] font-medium transition-colors",
									method === "github"
										? "bg-surface-raised text-accent-ink"
										: "text-ink-muted hover:bg-surface-raised hover:text-ink",
								)}
							>
								<AtSign className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
								GitHub
							</button>
						</div>
					</fieldset>

					{method === "email" ? (
						<label className="block">
							<span className={fieldLabel}>Email address</span>
							<div className="relative">
								<Mail
									className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
									strokeWidth={1.5}
									aria-hidden="true"
								/>
								<input
									name="email"
									type="email"
									required
									placeholder="relative@example.com"
									className={cn(field, "pl-9")}
									autoComplete="off"
								/>
							</div>
						</label>
					) : (
						<label className="block">
							<span className={fieldLabel}>GitHub username</span>
							<div className="relative">
								<AtSign
									className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
									strokeWidth={1.5}
									aria-hidden="true"
								/>
								<input
									name="githubLogin"
									required
									placeholder="@username"
									className={cn(field, "pl-9")}
									autoComplete="off"
								/>
							</div>
						</label>
					)}

					<fieldset>
						<legend className={fieldLabel}>Access level</legend>
						<div className="grid grid-cols-2 gap-1.5">
							<label className="flex min-h-12 cursor-pointer items-center rounded-lg border border-hairline px-3 py-2 has-checked:border-accent/40 has-checked:bg-accent/8">
								<input type="radio" name="role" value="viewer" defaultChecked className="sr-only" />
								<span>
									<span className="block text-[0.75rem] font-medium text-ink">Can view</span>
									<span className="block text-[0.625rem] text-ink-faint">Read only</span>
								</span>
							</label>
							<label className="flex min-h-12 cursor-pointer items-center rounded-lg border border-hairline px-3 py-2 has-checked:border-accent/40 has-checked:bg-accent/8">
								<input type="radio" name="role" value="editor" className="sr-only" />
								<span>
									<span className="block text-[0.75rem] font-medium text-ink">Can edit</span>
									<span className="block text-[0.625rem] text-ink-faint">Add and update</span>
								</span>
							</label>
						</div>
					</fieldset>

					<button
						type="submit"
						disabled={pending}
						className={cn(
							"flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink px-4",
							"text-sm font-medium text-canvas transition-transform",
							"duration-(--duration-fast) ease-(--ease-out)",
							"hover:-translate-y-px active:translate-y-0 disabled:cursor-wait disabled:opacity-60",
						)}
					>
						{pending ? (
							<Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
						) : (
							<UserPlus className="size-4" strokeWidth={1.75} aria-hidden="true" />
						)}
						{pending ? "Creating invite..." : "Create invite"}
					</button>
				</form>

				{message && (
					<div
						role={message.ok ? "status" : "alert"}
						className={cn(
							"mt-3 flex items-start gap-2 rounded-md border px-3 py-2.5 text-xs leading-relaxed",
							message.ok
								? "border-hairline bg-canvas text-ink-muted"
								: "border-danger/35 bg-danger/5 text-danger",
						)}
					>
						{message.ok ? (
							<CheckCircle2
								className="mt-0.5 size-3.5 shrink-0 text-living"
								strokeWidth={1.75}
								aria-hidden="true"
							/>
						) : (
							<AlertCircle
								className="mt-0.5 size-3.5 shrink-0"
								strokeWidth={1.75}
								aria-hidden="true"
							/>
						)}
						<p>{message.text}</p>
					</div>
				)}

				<section className="mt-5 border-t border-hairline pt-3">
					<div className="mb-1.5 flex items-center justify-between gap-3">
						<h3 className={heading}>People with access</h3>
						<span className="tabular text-[0.625rem] text-ink-faint">{state.members.length}</span>
					</div>
					<ul className="divide-y divide-hairline">
						{state.members.map((member) => (
							<li key={member.userId} className="flex min-h-12 items-center gap-2 py-1">
								<div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-ink-faint">
									<UserRound className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
								</div>
								<div className="min-w-0 flex-1">
									<p className="truncate text-xs font-medium text-ink">{member.name}</p>
									<p className="text-[0.625rem] text-ink-faint">{accessLabel(member.role)}</p>
								</div>
								{!member.isOwner && (
									<form action={run(removeMember)} className="shrink-0">
										<input type="hidden" name="treeId" value={treeId} />
										<input type="hidden" name="userId" value={member.userId} />
										<button
											type="submit"
											disabled={pending}
											aria-label={`Remove ${member.name}`}
											title={`Remove ${member.name}'s access`}
											className="flex size-11 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-raised hover:text-danger disabled:cursor-wait disabled:opacity-40"
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
						<div className="mb-1.5 flex items-center justify-between gap-3">
							<h3 className={heading}>Pending invitations</h3>
							<span className="tabular text-[0.625rem] text-ink-faint">{state.invites.length}</span>
						</div>
						<ul className="divide-y divide-hairline">
							{state.invites.map((row) => (
								<li key={row.id} className="flex min-h-12 items-center gap-2 py-1">
									<div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas text-ink-faint">
										<Clock className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
									</div>
									<div className="min-w-0 flex-1">
										<p className="truncate text-xs font-medium text-ink-muted">{row.addressedTo}</p>
										<p className="tabular truncate text-[0.625rem] text-ink-faint">
											{accessLabel(row.role)}, expires {row.expiresAt}
										</p>
									</div>
									<form action={run(revokeInvite)} className="shrink-0">
										<input type="hidden" name="inviteId" value={row.id} />
										<button
											type="submit"
											disabled={pending}
											aria-label={`Withdraw the invite to ${row.addressedTo}`}
											title={`Withdraw invite to ${row.addressedTo}`}
											className="flex size-11 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-raised hover:text-danger disabled:cursor-wait disabled:opacity-40"
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
