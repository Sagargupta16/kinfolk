"use client";

/**
 * Keyboard shortcuts, and the sheet that tells you they exist.
 *
 * A shortcut nobody can discover is a shortcut for the person who wrote it, so the
 * bindings and their documentation are the same array -- add a key here and the help
 * sheet gains a row automatically. The alternative (a handler in one file, a list in
 * another) drifts on the first change, and a help sheet that lies is worse than none.
 *
 * Single letters with no modifier, because this canvas has one text input and it is a
 * search box that swallows its own keys. `?` opens help, which is the convention every
 * canvas app already uses.
 */
import { Keyboard, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useEscapeClose } from "./escape";

export type ShortcutAction =
	| "search"
	| "fit"
	| "self"
	| "zoomIn"
	| "zoomOut"
	| "detail"
	| "generation"
	| "expandAll"
	| "clear"
	| "theme"
	| "help";

/** One binding, and the row that documents it. */
const BINDINGS: { keys: string[]; action: ShortcutAction; label: string }[] = [
	{ keys: ["/"], action: "search", label: "Search for somebody" },
	{ keys: ["f"], action: "fit", label: "Fit the whole graph" },
	{ keys: ["y"], action: "self", label: "Back to yourself" },
	{ keys: ["+", "="], action: "zoomIn", label: "Zoom in" },
	{ keys: ["-"], action: "zoomOut", label: "Zoom out" },
	{ keys: ["d"], action: "detail", label: "Cycle detail: cards, rows, dots" },
	{ keys: ["g"], action: "generation", label: "Fold the selected generation" },
	{ keys: ["e"], action: "expandAll", label: "Expand everything again" },
	{ keys: ["t"], action: "theme", label: "Switch light and dark" },
	{ keys: ["Escape"], action: "clear", label: "Clear selection and close panels" },
	{ keys: ["?"], action: "help", label: "Show this list" },
];

/**
 * Is the event coming from somewhere a letter means a letter?
 *
 * Without this, typing a name into search zooms, fits and cycles the detail level on
 * the way through -- the classic single-letter-shortcut bug. `isContentEditable` is
 * checked as well as the tag, because a rich text field is a div.
 */
function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
}

/**
 * Bind the shortcuts.
 *
 * `onAction` is called with the name rather than each key getting its own callback prop,
 * so adding a binding does not change this hook's signature.
 */
export function useShortcuts(onAction: (action: ShortcutAction) => void): void {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			// A modifier means the browser's own shortcut: Cmd+F is find, Ctrl+D bookmarks.
			// Stealing those to zoom a canvas is the kind of thing people file bugs about.
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			// A floating surface claimed this Escape (see escape.ts): it closed one panel,
			// and treating the same press as "clear the selection" would strip the pin
			// underneath the panel somebody just dismissed.
			if (event.key === "Escape" && event.defaultPrevented) return;
			// Escape has to work FROM the search box -- that is how you get back out of it --
			// so it is exempt from the typing guard that protects every other key.
			if (event.key !== "Escape" && isTyping(event.target)) return;

			const binding = BINDINGS.find((candidate) => candidate.keys.includes(event.key));
			if (!binding) return;

			event.preventDefault();
			onAction(binding.action);
		};

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onAction]);
}

/**
 * The help sheet.
 *
 * `open` is owned by the canvas, because `?` is routed through the same handler as every
 * other key -- a sheet holding its own keyboard listener would be a second place that
 * decides what a keystroke means.
 */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	// In the surface stack like every other overlay: open the help over a panel and
	// Escape closes the help first, not both.
	useEscapeClose(open, onClose);

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.16 }}
					className="absolute inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4"
					// A click anywhere outside closes. The sheet stops its own clicks below, so
					// this cannot fire from inside it.
					onClick={onClose}
				>
					<motion.div
						role="dialog"
						aria-modal="true"
						aria-label="Keyboard shortcuts"
						initial={{ opacity: 0, scale: 0.96, y: 8 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.96, y: 8 }}
						transition={{ type: "spring", stiffness: 380, damping: 32 }}
						onClick={(event) => event.stopPropagation()}
						className="kf-glass w-full max-w-sm rounded-2xl p-5"
					>
						<div className="mb-3 flex items-center gap-2">
							<Keyboard className="size-4 text-ink-faint" strokeWidth={1.75} aria-hidden="true" />
							<h2 className="flex-1 font-mono text-[0.6875rem] uppercase tracking-wider text-ink-muted">
								Keyboard
							</h2>
							<button
								type="button"
								onClick={onClose}
								aria-label="Close"
								className="flex size-8 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-raised hover:text-ink"
							>
								<X className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
							</button>
						</div>

						<dl className="space-y-1">
							{BINDINGS.map((binding) => (
								<div key={binding.action} className="flex items-center gap-3">
									<dt className="flex w-20 shrink-0 gap-1">
										{binding.keys.map((key) => (
											<kbd
												key={key}
												className={cn(
													"rounded border border-hairline bg-surface px-1.5 py-0.5",
													"font-mono text-[0.625rem] text-ink-muted",
												)}
											>
												{key}
											</kbd>
										))}
									</dt>
									<dd className="min-w-0 flex-1 text-[0.8125rem] text-ink-muted">
										{binding.label}
									</dd>
								</div>
							))}
						</dl>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
