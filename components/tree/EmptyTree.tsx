/**
 * Signed in, no graph at all.
 *
 * This is now the UNEXPECTED path, not the first-run one. `provisionGraph()` runs in
 * Auth.js's `createUser` event and gives every new account a graph with one node in it,
 * so a normal first sign-in lands on a canvas. This screen is what remains if that
 * provisioning failed -- a database blip during the OAuth callback, which is swallowed
 * there deliberately so a failed convenience never costs somebody their session.
 *
 * So the copy does not say "add your first relative": the editor does not exist yet, and
 * pointing at an action nobody can take is worse than admitting the state. The sample
 * graph is the one thing on this screen that does work.
 */
import { enterDemo } from "@/lib/tree/demo-actions";

export function EmptyTree({ name }: { name: string | null }) {
	const firstName = name?.split(" ")[0];

	return (
		<main className="relative isolate flex min-h-dvh flex-col justify-center overflow-hidden px-6 py-16">
			{/* Same lattice as the landing, signin and canvas screens. */}
			<div aria-hidden className="kf-lattice" />

			<div className="mx-auto w-full max-w-md space-y-8">
				<div className="space-y-3">
					<p>
						<span className="kf-chip">
							<span aria-hidden className="size-1.5 rounded-full bg-living" />
							Kinfolk
						</span>
					</p>
					<h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink">
						{firstName ? `Welcome, ${firstName}.` : "Welcome."} Your graph is empty.
					</h1>
					<p className="text-sm leading-relaxed text-ink-muted">
						A new account normally starts with one node -- you -- so if you are seeing this, setting
						that up did not finish. Signing out and back in will try again.
					</p>
				</div>

				<div className="space-y-3">
					<form action={enterDemo}>
						<button
							type="submit"
							className="flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-canvas transition-transform duration-(--duration-fast) ease-(--ease-out) hover:-translate-y-px active:translate-y-0"
						>
							See a sample graph instead
						</button>
					</form>
					{/*
					 * Updated when the editor landed. This used to say "the editor is not built
					 * yet", which was true then and is now the opposite of the truth -- the Add
					 * panel exists, it just has no graph to write into, which is precisely the
					 * state this screen reports.
					 */}
					<p className="text-xs leading-relaxed text-ink-faint">
						Adding people needs a graph to add them to, so the Add panel appears once this is
						sorted. The sample graph shows what the combined view does when two families join up.
					</p>
				</div>
			</div>
		</main>
	);
}
