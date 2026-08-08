"use client";

/**
 * Where you have been, as a trail you can walk back.
 *
 * A graph has no hierarchy to derive a breadcrumb from -- there is no "path" to a
 * cousin, and the same person is reachable a dozen ways -- so this is a HISTORY rather
 * than a location. That distinction drives the whole design: the trail records the
 * people you actually visited, in order, because on a canvas 10760px wide the thing a
 * viewer loses is not their place in a tree but the route they took to get here.
 *
 * Newest LAST, reading left to right, so the trail grows the way a sentence does and
 * the current person sits where the eye already is.
 */
import { ChevronRight, History } from "lucide-react";
import { motion } from "motion/react";
import type { FusedPerson } from "@/lib/tree/graph";
import { displayName } from "@/lib/tree/graph";
import { cn } from "@/lib/utils";

/**
 * How many steps are kept.
 *
 * Six, and the limit is horizontal room rather than memory: the trail sits over the
 * canvas on one line, and a seventh name either wraps -- taking a second line of tree
 * with it -- or truncates every other name to nothing. Older entries are dropped from
 * the FRONT, since the recent ones are what a viewer is retracing.
 */
export const TRAIL_LIMIT = 6;

export function TreeBreadcrumbs({
	trail,
	onGoTo,
	className,
}: {
	/** Visited people, oldest first. The last is the current one. */
	trail: FusedPerson[];
	onGoTo: (personId: string) => void;
	className?: string;
}) {
	if (trail.length === 0) return null;

	return (
		<motion.nav
			aria-label="Current person and recently viewed"
			initial={{ opacity: 0, y: -6 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
			className={cn(
				"kf-glass flex max-w-full items-center gap-0.5 overflow-hidden rounded-lg px-1.5 py-1",
				className,
			)}
		>
			<span className="shrink-0 px-1 font-mono text-[0.5625rem] uppercase tracking-wider text-accent-ink">
				Viewing
			</span>
			{trail.length > 1 && (
				<History
					className="mx-0.5 size-3 shrink-0 text-ink-faint"
					strokeWidth={1.75}
					aria-hidden="true"
				/>
			)}
			<ol className="flex min-w-0 items-center gap-0.5">
				{trail.map((person, index) => {
					const current = index === trail.length - 1;
					return (
						// The id alone is unique here, and `pushTrail` is what guarantees it:
						// revisiting somebody REWINDS the trail to them rather than appending, so
						// no person can appear twice. Adding the index would have hidden that
						// invariant behind a key that works either way.
						<li key={person.id} className="flex min-w-0 items-center gap-0.5">
							{index > 0 && (
								<ChevronRight
									className="size-3 shrink-0 text-ink-faint"
									strokeWidth={1.75}
									aria-hidden="true"
								/>
							)}
							<button
								type="button"
								onClick={() => onGoTo(person.id)}
								// The current person is where you already are, so it is announced rather
								// than offered. Still a button: disabling it would drop it from the tab
								// order mid-trail, which reads as the trail having a hole in it.
								aria-current={current ? "location" : undefined}
								className={cn(
									"max-w-[9rem] truncate rounded px-1.5 py-1 text-[0.75rem]",
									"transition-colors duration-(--duration-fast) ease-(--ease-out)",
									current
										? "font-medium text-ink"
										: "text-ink-faint hover:bg-surface-raised hover:text-ink",
								)}
							>
								{displayName(person.primary)}
							</button>
						</li>
					);
				})}
			</ol>
		</motion.nav>
	);
}

/**
 * Append a visit, collapsing a repeat and capping the length.
 *
 * Pure and exported so the canvas does not hold this logic inline. Revisiting the
 * person you are already on is a no-op rather than a duplicate entry: clicking the same
 * card twice is how the pin is toggled, and it must not push "Sagar > Sagar" onto the
 * trail.
 */
export function pushTrail(trail: string[], personId: string): string[] {
	if (trail[trail.length - 1] === personId) return trail;

	// Walking BACK to somebody already on the trail rewinds to them rather than
	// appending, so retracing your steps shortens the trail instead of growing it into a
	// record of pacing back and forth.
	const seen = trail.lastIndexOf(personId);
	if (seen !== -1) return trail.slice(0, seen + 1);

	return [...trail, personId].slice(-TRAIL_LIMIT);
}
