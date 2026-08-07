/**
 * The front door, now served from the app itself.
 *
 * This replaces `docs/index.html`, which was a hand-maintained copy of the same
 * words in a separate file with its own colour values. That copy drifted, which is
 * the failure a duplicate always reaches -- and the visitor reading it is the last
 * to know. Here the tokens come from `app/globals.css`, so the page cannot disagree
 * with the canvas it leads into.
 *
 * The three facts and the accent-on-the-second-line headline are kept deliberately:
 * the product is the JOIN, so the amber lands once, on the three words that say it.
 */
import { useState } from "react";
import { startSignIn } from "../auth";

export function Landing() {
	const [error, setError] = useState<string | null>(null);
	const base = import.meta.env.BASE_URL;

	return (
		<div className="kf-lattice min-h-dvh bg-canvas px-5 py-12">
			<main className="mx-auto max-w-xl text-center">
				<p className="kf-chip">
					<span className="size-1.5 rounded-full bg-living" aria-hidden="true" />
					Family graph
				</p>

				<h1 className="mt-6 text-[clamp(2rem,7vw,3rem)] font-semibold leading-[1.1] tracking-[-0.02em] text-ink">
					Everyone keeps their own tree.
					<br />
					<span className="text-accent">Then they join up.</span>
				</h1>

				<p className="mx-auto mt-5 max-w-md leading-relaxed text-ink-muted">
					Two people who have never met can both record the same grandparent. Kinfolk merges those
					records without either side losing their own, so the combined graph shows how several
					families actually connect.
				</p>

				<div className="mt-8 flex flex-wrap justify-center gap-2.5">
					<button
						type="button"
						onClick={() => {
							setError(null);
							startSignIn().catch((caught: unknown) =>
								setError(caught instanceof Error ? caught.message : "Sign-in is unavailable."),
							);
						}}
						className="inline-flex min-h-11 items-center rounded-xl border border-accent/40 bg-accent/10 px-4.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/20"
					>
						Sign in with GitHub
					</button>

					<a
						href={`${base}tree?demo=1`}
						className="inline-flex min-h-11 items-center rounded-xl border border-hairline bg-surface px-4.5 text-sm text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink"
					>
						See the sample tree
					</a>

					<a
						href="https://github.com/Sagargupta16/kinfolk"
						className="inline-flex min-h-11 items-center rounded-xl border border-hairline bg-surface px-4.5 text-sm text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink"
					>
						Source
					</a>
				</div>

				{error ? <p className="mt-4 text-sm text-ink-faint">{error}</p> : null}

				<div className="mx-auto mt-11 grid max-w-md gap-2 text-left">
					<Fact n="01" title="A tree is not a tree">
						It is a graph. Remarriages, half-siblings, single parents and adoption all fall out of
						the model instead of each needing a special case.
					</Fact>
					<Fact n="02" title="Merging never overwrites">
						Agreeing that two records describe the same person is a consent-gated link, so unlinking
						restores both families' own views intact.
					</Fact>
					<Fact n="03" title="A contact graph too">
						Anyone can be a node -- a friend, a colleague, a neighbour -- and a friendship carries
						no generation, so it never distorts the family layout.
					</Fact>
				</div>

				<footer className="mt-10 font-mono text-[0.6875rem] text-ink-faint">
					Built by{" "}
					<a href="https://sagargupta.online/" className="text-ink-muted underline">
						Sagar Gupta
					</a>
				</footer>
			</main>
		</div>
	);
}

function Fact({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
	return (
		<div className="flex gap-3 rounded-xl border border-hairline bg-surface/60 px-4 py-3.5">
			<span className="pt-0.5 font-mono text-xs text-accent" aria-hidden="true">
				{n}
			</span>
			<div>
				<b className="font-medium text-ink">{title}</b>
				<p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-faint">{children}</p>
			</div>
		</div>
	);
}
