import Link from "next/link";
import { enterDemo } from "@/lib/tree/demo-actions";

export default function HomePage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6 py-16">
			<div className="space-y-4">
				<p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-accent">
					Kinfolk
				</p>
				<h1 className="text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl">
					Build your branch.
					<br />
					Connect it to theirs.
				</h1>
				<p className="max-w-prose text-[0.9375rem] leading-relaxed text-ink-muted">
					Everyone keeps their own records. When two relatives agree that a person in each of their
					trees is the same human, the trees join at that point, and both sides keep their copy.
				</p>
			</div>

			{/* Sample data first, sign-in second: there is nothing to show a new visitor
			    yet, and asking them to authorise a GitHub app before they know what this
			    is would be the wrong order. */}
			<div className="flex flex-col gap-3 sm:flex-row">
				<form action={enterDemo}>
					<button
						type="submit"
						className="flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-canvas transition-transform duration-[--duration-fast] ease-[--ease-out] hover:-translate-y-px active:translate-y-0 sm:w-auto"
					>
						See the sample tree
					</button>
				</form>
				<Link
					href="/signin"
					className="flex min-h-11 items-center justify-center rounded-md border border-hairline px-4 text-sm font-medium text-ink transition-colors duration-[--duration-fast] ease-[--ease-out] hover:border-hairline-strong hover:bg-surface-raised"
				>
					Sign in
				</Link>
			</div>
		</main>
	);
}
