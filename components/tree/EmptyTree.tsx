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
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-6 py-16">
			<div className="space-y-3">
				<p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-accent">
					Kinfolk
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
				<p className="text-xs leading-relaxed text-ink-faint">
					The editor is not built yet, so there is nowhere to add your own people for the moment.
					The sample graph shows what the combined view does once two families join up.
				</p>
			</div>
		</main>
	);
}
