"use client";

/**
 * Who you are signed in as, and how to stop being.
 *
 * There was no sign-out anywhere in the app, which is worse than an inconvenience on a
 * shared computer: a database session lasts 30 days by default, so the only way out was
 * clearing cookies by hand. It also meant nothing on screen said WHOSE graph you were
 * looking at, which matters here more than in most apps -- the whole product is several
 * people's records joined together.
 *
 * A menu rather than a bare button, because sign-out should not be one mis-tap away from
 * a 44px target next to the view toggles.
 */
import { ChevronDown, LogOut, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { leave } from "@/lib/tree/share-actions";
import { cn } from "@/lib/utils";

export function AccountMenu({
	name,
	email,
	/** Opens the share panel. Absent when this viewer cannot share anything. */
	onShare,
}: {
	name: string | null;
	email: string | null;
	onShare?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const wrapper = useRef<HTMLDivElement>(null);

	// The label falls back through name, then email, then a generic -- an account with
	// neither is possible (a GitHub profile can hide both) and "Signed in" is still true.
	const label = name?.split(" ")[0] ?? email?.split("@")[0] ?? "Account";

	/**
	 * Close on Escape or on a click anywhere else.
	 *
	 * Pointerdown rather than click: a click fires after mousedown+mouseup on the SAME
	 * element, so a press that starts inside the menu and ends outside it would not close,
	 * and the menu would sit open under the pointer.
	 */
	useEffect(() => {
		if (!open) return;

		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		const onPointer = (event: PointerEvent) => {
			if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
		};

		window.addEventListener("keydown", onKey);
		window.addEventListener("pointerdown", onPointer);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("pointerdown", onPointer);
		};
	}, [open]);

	return (
		<div ref={wrapper} className="relative shrink-0">
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-label={`Account menu for ${label}`}
				aria-expanded={open}
				aria-haspopup="menu"
				className={cn(
					"flex min-h-11 items-center gap-1.5 rounded-md border px-2.5",
					"text-xs font-medium transition-colors duration-(--duration-fast) ease-(--ease-out)",
					open
						? "border-hairline-strong bg-surface-raised text-ink"
						: "border-hairline text-ink-muted hover:border-hairline-strong hover:text-ink",
				)}
			>
				{/* The initial as an avatar stand-in. No image: a GitHub avatar is a network
				    request per render for decoration, and the header is the one place on a
				    phone where every pixel is already spoken for. */}
				<span
					aria-hidden
					className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-raised font-mono text-[0.5625rem] uppercase text-accent"
				>
					{label.charAt(0)}
				</span>
				<span className="hidden max-w-24 truncate sm:inline">{label}</span>
				<ChevronDown aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
			</button>

			{open && (
				<div
					// `role="menu"` on a div rather than a <menu> element: that tag carries list
					// semantics, not menu semantics, so it would need this role anyway.
					role="menu"
					className={cn(
						"absolute right-0 top-[calc(100%+0.375rem)] z-40 w-[min(15rem,calc(100vw-1.5rem))]",
						// Opaque, like the legend: this sits over the canvas and a translucent
						// surface would put a person's name through the middle of the email.
						"overflow-hidden rounded-md border border-hairline-strong bg-surface",
						"shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
					)}
				>
					<div className="border-b border-hairline px-3 py-2.5">
						<p className="truncate text-xs font-medium text-ink">{name ?? "Signed in"}</p>
						{email && <p className="truncate font-mono text-[0.625rem] text-ink-faint">{email}</p>}
					</div>

					{onShare && (
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setOpen(false);
								onShare();
							}}
							className={cn(
								"flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs text-ink-muted",
								"transition-colors duration-(--duration-fast) ease-(--ease-out)",
								"hover:bg-surface-raised hover:text-ink",
							)}
						>
							<Share2 aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
							Family access
						</button>
					)}

					{/*
					 * A form posting to a server action, not an onClick fetch. Sign-out has to
					 * delete a database row and clear an httpOnly cookie, neither of which the
					 * client can do -- and as a form it still works if JS has not hydrated.
					 */}
					<form action={leave} className="border-t border-hairline">
						<button
							type="submit"
							role="menuitem"
							className={cn(
								"flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs text-ink-muted",
								"transition-colors duration-(--duration-fast) ease-(--ease-out)",
								"hover:bg-surface-raised hover:text-ink",
							)}
						>
							<LogOut aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
							Sign out
						</button>
					</form>
				</div>
			)}
		</div>
	);
}
