import Link from "next/link";
import type { CSSProperties } from "react";
import { enterDemo } from "@/lib/tree/demo-actions";

export default function HomePage() {
	return (
		<main className="relative isolate flex min-h-dvh flex-col justify-center overflow-hidden px-6 py-16">
			{/*
			 * The lattice spotlight, so the page has a centre of gravity.
			 *
			 * Before this the landing page was type on an empty near-black field, which read
			 * as unfinished rather than as restraint. Same pitch as the canvas's own dot
			 * background (24px), so a visitor who lands here and then opens the graph pans
			 * across the SAME texture instead of watching it change under them.
			 *
			 * `isolate` on the main plus no z-index here: the lattice is first in the flow, so
			 * paint order alone puts the content over it. A negative index would work until
			 * something upstream gained a stacking context.
			 */}
			<div aria-hidden className="kf-lattice" />

			{/* Staggered top to bottom, so the page assembles in reading order rather than
			    appearing at once. Delays are inline because they are per-element data, not
			    a design token -- and the 70ms step is under a blink, so this reads as one
			    arrival with a direction rather than four separate events. */}
			<div className="mx-auto w-full max-w-2xl space-y-5">
				{/*
				 * A chip rather than a bare mono line, taken from portfolio-react's section
				 * rhythm (`.badge-pill` then headline). It gives the block somewhere to start
				 * and is the one piece of chrome that says this page was designed.
				 *
				 * The dot is the same living-green the canvas uses for a living person, which
				 * is the one reuse that earns its keep here: it is the colour this product
				 * already means "present" with.
				 */}
				<p className="kf-rise" style={{ "--kf-delay": "0ms" } as CSSProperties}>
					<span className="kf-chip">
						<span aria-hidden className="size-1.5 rounded-full bg-living" />
						Kinfolk
					</span>
				</p>
				<h1
					className="kf-rise text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl"
					style={{ "--kf-delay": "70ms" } as CSSProperties}
				>
					Map your people.
					<br />
					{/*
					 * The second line carries the accent, and only the second line. The whole
					 * product is the JOIN -- two families' records meeting without either being
					 * overwritten -- so the amber lands on the three words that say it, once. A
					 * gradient across both lines was the obvious move and is the wrong one: it
					 * would spend the accent on decoration rather than on meaning, and this
					 * repo's one-accent rule exists because amber has to keep meaning "you" and
					 * "this relation" on the canvas.
					 */}
					<span className="text-accent">Join it to theirs.</span>
				</h1>
				<p
					className="kf-rise max-w-prose text-[0.9375rem] leading-relaxed text-ink-muted"
					style={{ "--kf-delay": "140ms" } as CSSProperties}
				>
					Not a pedigree chart -- a graph. Anyone can be a node: a grandmother, a neighbour, the
					colleague who introduced your parents. Everyone keeps their own records, and when two
					people agree that a person in each of their graphs is the same human, the graphs join at
					that point without either side losing a thing.
				</p>
				{/* Sample data first, sign-in second: there is nothing to show a new visitor
			    yet, and asking them to authorise a GitHub app before they know what this
			    is would be the wrong order. */}
				<div
					className="kf-rise flex flex-col gap-3 pt-3 sm:flex-row"
					style={{ "--kf-delay": "210ms" } as CSSProperties}
				>
					<form action={enterDemo}>
						<button
							type="submit"
							className="flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-canvas transition-transform duration-(--duration-fast) ease-(--ease-out) hover:-translate-y-px active:translate-y-0 sm:w-auto"
						>
							See the sample graph
						</button>
					</form>
					<Link
						href="/signin"
						className="flex min-h-11 items-center justify-center rounded-md border border-hairline px-4 text-sm font-medium text-ink transition-colors duration-(--duration-fast) ease-(--ease-out) hover:border-hairline-strong hover:bg-surface-raised"
					>
						Sign in
					</Link>
				</div>
			</div>
		</main>
	);
}
