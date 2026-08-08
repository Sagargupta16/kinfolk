"use client";

/**
 * The family feed: the record as a stream, newest first.
 *
 * Reads like the feeds everyone already knows -- avatar, name, verb, a
 * timestamp on the right -- and is scoped like nothing they do: every row is
 * derived from the nodes this viewer already received, so the feed can never
 * show a person the canvas would not. See lib/tree/feed.ts for the derivation
 * and the deliberate absence of an events table.
 *
 * The same shell as the person detail panel (bottom sheet on a phone, right
 * rail on a desktop), because the two are the same KIND of surface and a
 * second geometry would be a second thing to learn.
 */
import { Activity, UserRound, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { type FeedEvent, feedSection, relativeTime } from "@/lib/tree/feed";
import type { Kinship } from "@/lib/tree/kinship";
import { cn } from "@/lib/utils";
import { useEscapeClose } from "./escape";

const SECTIONS = ["This week", "This month", "Earlier"] as const;

/** Verb tint per event kind. One accent stays the rule; these are ink steps. */
const KIND_TONE: Record<FeedEvent["kind"], string> = {
	arrived: "text-ink-muted",
	updated: "text-ink-faint",
	partnership: "text-ink-muted",
};

export function FeedPanel({
	open,
	events,
	kinship,
	onGoTo,
	onClose,
}: {
	open: boolean;
	events: FeedEvent[];
	kinship?: Map<string, Kinship>;
	/** Travel to the person a row is about. The feed stays open: it is a browse surface. */
	onGoTo: (personId: string) => void;
	onClose: () => void;
}) {
	// Escape closes, coordinated with every other floating surface -- see escape.ts.
	useEscapeClose(open, onClose);

	// One clock for the whole render, so two rows written in the same minute cannot
	// disagree about what "now" is. Re-read each time the panel OPENS: the panel is
	// permanently mounted (AnimatePresence needs it), so a single useMemo froze "now"
	// at page load and a tab left open overnight called yesterday "just now".
	const now = useMemo(() => {
		void open;
		return new Date();
	}, [open]);

	const grouped = useMemo(() => {
		const bySection = new Map<(typeof SECTIONS)[number], FeedEvent[]>();
		for (const event of events) {
			const section = feedSection(event.at, now);
			const list = bySection.get(section);
			if (list) list.push(event);
			else bySection.set(section, [event]);
		}
		return bySection;
	}, [events, now]);

	return (
		<AnimatePresence>
			{open && (
				<motion.aside
					aria-label="Family feed"
					initial={{ opacity: 0, x: "100%" }}
					animate={{ opacity: 1, x: 0 }}
					exit={{ opacity: 0, x: "100%" }}
					transition={{ type: "spring", stiffness: 320, damping: 34, mass: 0.9 }}
					className={cn(
						"kf-glass absolute z-40 flex flex-col overflow-hidden",
						// The detail panel's own geometry: sheet on a phone, rail on a desktop.
						"inset-x-0 bottom-0 max-h-[55dvh] rounded-t-2xl",
						"sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[22rem] sm:rounded-none sm:rounded-l-2xl",
					)}
				>
					<header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-3">
						<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-ink">
							<Activity className="size-4" strokeWidth={1.75} aria-hidden="true" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-ink-faint">
								Only people with access see this
							</p>
							<h2 className="text-sm font-medium text-ink">Family feed</h2>
						</div>
						<button
							type="button"
							onClick={onClose}
							aria-label="Close the family feed"
							className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-raised hover:text-ink"
						>
							<X aria-hidden className="size-4" strokeWidth={1.5} />
						</button>
					</header>

					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
						{events.length === 0 && (
							<p className="px-3 py-6 text-center text-[0.75rem] leading-relaxed text-ink-faint">
								Nothing here yet. The feed fills as people are added and records change.
							</p>
						)}

						{SECTIONS.map((section) => {
							const rows = grouped.get(section);
							if (!rows || rows.length === 0) return null;
							return (
								<section key={section} className="mt-3 first:mt-2">
									<h3 className="flex items-baseline justify-between px-2 pb-1 font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-ink-faint">
										{section}
										<span className="tabular normal-case tracking-normal">{rows.length}</span>
									</h3>
									<ul>
										{rows.map((event, index) => (
											<motion.li
												key={event.id}
												// A gentle cascade, capped so a long section arrives as a
												// column and not as a minute of drizzle.
												initial={{ opacity: 0, y: 6 }}
												animate={{ opacity: 1, y: 0 }}
												transition={{
													duration: 0.22,
													delay: Math.min(index, 8) * 0.03,
													ease: [0.16, 1, 0.3, 1],
												}}
											>
												<button
													type="button"
													onClick={() => onGoTo(event.personId)}
													title={`Show ${event.name} on the tree`}
													className={cn(
														"flex min-h-12 w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left",
														"transition-colors duration-(--duration-fast) ease-(--ease-out)",
														"hover:bg-surface-raised",
													)}
												>
													<span
														aria-hidden
														className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-hairline bg-canvas font-mono text-[0.6875rem] uppercase text-ink-muted"
													>
														{event.kind === "partnership" ? (
															<UserRound className="size-3.5" strokeWidth={1.5} />
														) : (
															event.initial
														)}
													</span>
													<span className="min-w-0 flex-1">
														<span className="block truncate text-[0.8125rem] leading-snug">
															<span className="font-medium text-ink">{event.name}</span>{" "}
															<span className={KIND_TONE[event.kind]}>{event.detail}</span>
														</span>
														{kinship?.get(event.personId)?.label && (
															<span className="mt-0.5 block truncate font-mono text-[0.625rem] text-ink-faint">
																{kinship.get(event.personId)?.label}
															</span>
														)}
													</span>
													<span className="tabular mt-0.5 shrink-0 font-mono text-[0.625rem] text-ink-faint">
														{relativeTime(event.at, now)}
													</span>
												</button>
											</motion.li>
										))}
									</ul>
								</section>
							);
						})}
					</div>
				</motion.aside>
			)}
		</AnimatePresence>
	);
}
