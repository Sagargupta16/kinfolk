"use client";

/**
 * What the canvas shows when it has nothing to draw.
 *
 * Four states, and they are separate components rather than one with a `variant` prop
 * because they answer four different questions: "is it working?", "did it break?", "is
 * there anybody here?", "did my search miss?". A single component would take a union of
 * every prop each needs and read as a switch statement wearing a costume.
 *
 * All four keep the canvas's own texture (`.kf-lattice`) so an empty state still looks
 * like this app rather than like a framework default.
 */
import { CloudOff, RotateCw, type Search, TriangleAlert, UserPlus } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Shared shell: centred, textured, and announced. */
function State({
	title,
	body,
	Icon,
	tone = "quiet",
	children,
	live,
}: {
	title: string;
	body: string;
	Icon: typeof Search;
	tone?: "quiet" | "warn";
	children?: React.ReactNode;
	/**
	 * Announce this state when it appears.
	 *
	 * `polite` rather than `assertive` even for the error: the canvas is not going
	 * anywhere, and interrupting whatever a screen reader is mid-sentence on to say a
	 * graph failed to load is louder than the news deserves.
	 */
	live?: boolean;
}) {
	return (
		<div
			className="kf-lattice flex size-full flex-col items-center justify-center gap-3 px-6 text-center"
			{...(live ? { role: "status", "aria-live": "polite" } : {})}
		>
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
				className="flex flex-col items-center gap-3"
			>
				<span
					className={cn(
						"flex size-11 items-center justify-center rounded-full border",
						tone === "warn"
							? "border-danger/40 bg-danger/10 text-danger"
							: "border-hairline bg-surface text-ink-faint",
					)}
				>
					<Icon className="size-5" strokeWidth={1.5} aria-hidden="true" />
				</span>
				<h2 className="text-base font-medium text-ink">{title}</h2>
				<p className="max-w-xs text-[0.8125rem] leading-relaxed text-ink-muted">{body}</p>
				{children}
			</motion.div>
		</div>
	);
}

/**
 * The graph is laying out.
 *
 * Deliberately NOT a spinner or a skeleton of fake cards. ELK finishes in well under a
 * second on this data, so a spinner would flash and a skeleton would promise a shape
 * that may not match what arrives -- and a card-shaped placeholder that turns into a
 * different card is worse than a line of text that turns into a tree.
 *
 * It also waits before showing anything, so a fast layout produces no flicker at all.
 */
export function TreeLoading({ delayMs = 220 }: { delayMs?: number }) {
	const [shown, setShown] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => setShown(true), delayMs);
		return () => clearTimeout(timer);
	}, [delayMs]);

	if (!shown) return null;

	return (
		<div
			className="kf-lattice flex size-full items-center justify-center"
			role="status"
			aria-live="polite"
		>
			<p className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint">
				Arranging the graph
			</p>
		</div>
	);
}

/**
 * Layout threw.
 *
 * Retry is offered because the realistic cause is transient: ELK is a lazy dynamic
 * import, so a dropped connection on first layout fails here and succeeds on a second
 * try without a reload. The message says what failed rather than "something went wrong",
 * which tells a reader nothing they can act on.
 */
export function TreeError({ onRetry }: { onRetry?: () => void }) {
	return (
		<State
			live
			tone="warn"
			Icon={TriangleAlert}
			title="The graph could not be arranged"
			body="Your records are safe -- this is the layout step, which runs in the browser. Trying again usually works."
		>
			{onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className={cn(
						"mt-1 flex min-h-11 items-center gap-2 rounded-lg border border-hairline",
						"bg-surface px-4 font-mono text-[0.6875rem] uppercase tracking-wider text-ink-muted",
						"transition-colors duration-(--duration-fast) ease-(--ease-out)",
						"hover:border-hairline-strong hover:text-ink",
					)}
				>
					<RotateCw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
					Try again
				</button>
			)}
		</State>
	);
}

/**
 * A signed-in viewer whose graph holds only themselves.
 *
 * Not the same as `EmptyTree` (which is "you have no graph at all"): here provisioning
 * worked and there is one node. So the copy names the next action rather than explaining
 * the product, and the action is the editor that is already on screen.
 */
export function TreeAlone({ canEdit }: { canEdit: boolean }) {
	return (
		<State
			Icon={UserPlus}
			title="Just you, so far"
			body={
				canEdit
					? "Add a parent, a partner or a friend, and the graph starts to take shape. Every person you add can be linked to a relative's own records later."
					: "Nobody else has been added to this graph yet."
			}
		/>
	);
}

/**
 * Search matched nothing.
 *
 * Echoes the query back in the body, because the commonest cause is a typo and a reader
 * cannot spot one they cannot see. Substring matching is also worth naming: "no match"
 * on a name you are sure is there reads as broken until you know the search is not
 * fuzzy.
 */
export function SearchEmpty({ query }: { query: string }) {
	return (
		<div className="px-3 py-4 text-center" role="status" aria-live="polite">
			<p className="text-[0.8125rem] text-ink-muted">
				Nobody matching <span className="text-ink">{query}</span>
			</p>
			<p className="mt-1 text-[0.6875rem] leading-snug text-ink-faint">
				Names, nicknames and birthplaces are searched, by exact spelling.
			</p>
		</div>
	);
}

/**
 * The browser went offline.
 *
 * Worth its own state because of what is true here and not obvious: the graph on screen
 * keeps working. Layout, search, collapse and the detail panel are all client-side over
 * data already loaded, so the honest message is "you can keep reading, you cannot save"
 * -- not a modal blocking a canvas that is still perfectly usable.
 */
export function OfflineNotice() {
	const [offline, setOffline] = useState(false);

	useEffect(() => {
		// Read in an effect, never during render: the server has no `navigator`, and
		// guessing would make the first client paint disagree with the markup.
		setOffline(!navigator.onLine);

		const goOffline = () => setOffline(true);
		const goOnline = () => setOffline(false);
		window.addEventListener("offline", goOffline);
		window.addEventListener("online", goOnline);
		return () => {
			window.removeEventListener("offline", goOffline);
			window.removeEventListener("online", goOnline);
		};
	}, []);

	if (!offline) return null;

	return (
		<motion.div
			initial={{ opacity: 0, y: -8 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -8 }}
			role="status"
			aria-live="polite"
			className={cn(
				"kf-glass absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2",
				"rounded-full px-3 py-1.5 text-[0.75rem] text-ink-muted",
			)}
		>
			<CloudOff
				className="size-3.5 shrink-0 text-ink-faint"
				strokeWidth={1.75}
				aria-hidden="true"
			/>
			Offline. You can still read and explore; changes will not save.
		</motion.div>
	);
}
