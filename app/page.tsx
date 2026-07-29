import Link from "next/link";
import type { CSSProperties } from "react";
import { enterDemo } from "@/lib/tree/demo-actions";

export default function HomePage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6 py-16">
			{/* Staggered top to bottom, so the page assembles in reading order rather than
			    appearing at once. Delays are inline because they are per-element data, not
			    a design token -- and the 70ms step is under a blink, so this reads as one
			    arrival with a direction rather than four separate events. */}
			<div className="space-y-4">
				<p
					className="kf-rise font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-accent"
					style={{ "--kf-delay": "0ms" } as CSSProperties}
				>
					Kinfolk
				</p>
				<h1
					className="kf-rise text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl"
					style={{ "--kf-delay": "70ms" } as CSSProperties}
				>
					Map your people.
					<br />
					Join it to theirs.
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
			</div>

			{/* Sample data first, sign-in second: there is nothing to show a new visitor
			    yet, and asking them to authorise a GitHub app before they know what this
			    is would be the wrong order. */}
			<div
				className="kf-rise flex flex-col gap-3 sm:flex-row"
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
		</main>
	);
}
