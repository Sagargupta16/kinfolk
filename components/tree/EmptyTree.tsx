"use client";

/**
 * Signed in, no graph at all.
 *
 * This is the UNEXPECTED path, not the first-run one. Every successful sign-in provisions
 * a graph with one node in it (Auth.js's `createUser` and `signIn` in the Next app, the
 * OAuth completion in the SPA), so a normal first sign-in lands on a canvas. This screen
 * is what remains if that provisioning failed -- a database blip during the OAuth
 * callback, which is swallowed there deliberately so a failed convenience never costs
 * somebody their session.
 *
 * So the copy does not say "add your first relative": there is no graph to add them to,
 * and pointing at an action nobody can take is worse than admitting the state. The two
 * actions are the two that work. Signing out, because the next sign-in repairs the
 * missing graph, and the sample graph.
 *
 * Both runtimes render this one component, so the Pages app and the server-rendered app
 * cannot describe the same state differently.
 */
import { useActionState } from "react";
import { Lattice } from "@/components/ui/Lattice";
import { enterDemo } from "@/lib/tree/demo-actions";
import { leave } from "@/lib/tree/share-actions";

export function EmptyTree({ name }: { name: string | null }) {
	const firstName = name?.split(" ")[0];
	const [signOutError, signOutAction, signingOut] = useActionState(leave, null);

	return (
		<main className="relative isolate flex min-h-dvh flex-col justify-center overflow-hidden px-6 py-16">
			{/* Same lattice as the landing, signin and canvas screens. */}
			<Lattice />

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
					<form action={signOutAction}>
						<button
							type="submit"
							disabled={signingOut}
							className="flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-canvas transition-transform duration-(--duration-fast) ease-(--ease-out) hover:-translate-y-px active:translate-y-0 disabled:opacity-60"
						>
							{signingOut ? "Signing out..." : "Sign out"}
						</button>
						{signOutError && (
							<p role="alert" className="mt-2 text-sm text-danger">
								{signOutError}
							</p>
						)}
					</form>
					<form action={enterDemo}>
						<button
							type="submit"
							className="flex min-h-11 w-full items-center justify-center rounded-md border border-hairline px-4 text-sm font-medium text-ink-muted transition-colors duration-(--duration-fast) ease-(--ease-out) hover:border-hairline-strong hover:text-ink"
						>
							See a sample graph instead
						</button>
					</form>
					<p className="text-xs leading-relaxed text-ink-faint">
						Once your graph exists you add relatives from the + handles on a person's card. The
						sample graph shows what the combined view does when two families join up.
					</p>
				</div>
			</div>
		</main>
	);
}
