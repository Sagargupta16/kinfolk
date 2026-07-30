/**
 * Sign-in. Referenced by `pages.signIn` in auth.ts, so Auth.js redirects here
 * whenever an unauthenticated request hits a protected route.
 *
 * The demo link is as prominent as the sign-in button on purpose: a graph of your
 * own people has nothing to show a first-time visitor, and asking someone to
 * authorise a GitHub app before they know what they are getting is the wrong order.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { sessionOrNull, signIn } from "@/auth";
import { GitHubIcon } from "@/components/ui/GitHubIcon";
import { enterDemo } from "@/lib/tree/demo-actions";

export const metadata = { title: "Sign in -- Kinfolk" };

export default async function SignInPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string; from?: string }>;
}) {
	const { error, from } = await searchParams;

	// Already signed in: nothing to do here.
	const session = await sessionOrNull();
	if (session?.user) redirect("/tree");

	return (
		<main className="relative isolate flex min-h-dvh flex-col justify-center overflow-hidden px-6 py-16">
			{/* The same lattice as the landing page and the canvas, so the three screens read
			    as one surface rather than three documents. */}
			<div aria-hidden className="kf-lattice" />

			<div className="mx-auto w-full max-w-sm space-y-8">
				<div className="space-y-3">
					<Link href="/" className="kf-chip transition-colors hover:border-hairline-strong">
						<span aria-hidden className="size-1.5 rounded-full bg-living" />
						Kinfolk
					</Link>
					<h1 className="pt-1 text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink">
						Sign in to your graph
					</h1>
					<p className="text-sm leading-relaxed text-ink-muted">
						Your records stay yours. Joining to someone else's graph needs both sides to agree, and
						unjoining puts everything back.
					</p>
				</div>

				{error && (
					<p
						role="alert"
						className="rounded-md border border-hairline bg-surface px-3 py-2.5 text-xs leading-relaxed text-ink-muted"
					>
						That sign-in did not complete. Please try again.
					</p>
				)}

				<div className="space-y-3">
					<form
						action={async () => {
							"use server";
							await signIn("github", { redirectTo: from ?? "/tree" });
						}}
					>
						<button
							type="submit"
							className="flex min-h-11 w-full items-center justify-center gap-2.5 rounded-md bg-ink px-4 text-sm font-medium text-canvas transition-transform duration-(--duration-fast) ease-(--ease-out) hover:-translate-y-px active:translate-y-0"
						>
							<GitHubIcon className="size-4" />
							Continue with GitHub
						</button>
					</form>

					<form action={enterDemo}>
						<button
							type="submit"
							className="flex min-h-11 w-full items-center justify-center rounded-md border border-hairline px-4 text-sm font-medium text-ink transition-colors duration-(--duration-fast) ease-(--ease-out) hover:border-hairline-strong hover:bg-surface-raised"
						>
							Explore with sample data
						</button>
					</form>
				</div>

				<p className="text-xs leading-relaxed text-ink-faint">
					GitHub is the only provider for now. Relatives without an account can still be invited by
					email.
				</p>
			</div>
		</main>
	);
}
