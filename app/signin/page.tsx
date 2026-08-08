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
import type { CSSProperties } from "react";
import { sessionOrNull } from "@/auth";
import { GitHubIcon } from "@/components/ui/GitHubIcon";
import { enterDemo } from "@/lib/tree/demo-actions";

export const metadata = { title: "Sign in -- Kinfolk" };

export default async function SignInPage({
	searchParams,
}: {
	// `from` is gone with the sign-in button: it existed to carry a post-sign-in
	// destination into `signIn()`, and sign-in now happens on the public site.
	searchParams: Promise<{ error?: string }>;
}) {
	const { error } = await searchParams;

	// Already signed in: nothing to do here.
	const session = await sessionOrNull();
	if (session?.user) redirect("/tree");

	return (
		<main className="relative isolate flex min-h-dvh flex-col justify-center overflow-hidden px-6 py-16">
			{/* The same lattice as the landing page and the canvas, so the three screens read
			    as one surface rather than three documents. */}
			<div aria-hidden className="kf-lattice" />

			<div className="mx-auto w-full max-w-sm space-y-8">
				{/* The landing page's entrance, at the landing page's rhythm: the two screens
				    are one surface, and only one of them arriving with a stagger would make
				    the other read as a fallback. */}
				<div className="kf-rise space-y-3" style={{ "--kf-delay": "0ms" } as CSSProperties}>
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

				<div className="kf-rise space-y-3" style={{ "--kf-delay": "90ms" } as CSSProperties}>
					{/*
					 * Sign-in happens on the PUBLIC SITE, not here.
					 *
					 * A GitHub OAuth App allows exactly ONE callback URL, and it is registered
					 * to sagargupta.online/kinfolk/auth/callback/github so the browser stays on
					 * the visitor's own domain for the whole flow. That means the Auth.js
					 * callback on this origin is no longer registered, and the button that used
					 * to be here would fail with `redirect_uri_mismatch` -- a control that
					 * cannot work is worse than one that is absent, because the visitor blames
					 * their own account.
					 *
					 * A link rather than a redirect, so somebody who reached this page by an
					 * old bookmark can see where sign-in moved to instead of being bounced.
					 */}
					<a
						href="https://sagargupta.online/kinfolk/"
						className="flex min-h-11 w-full items-center justify-center gap-2.5 rounded-md bg-ink px-4 text-sm font-medium text-canvas transition-transform duration-(--duration-fast) ease-(--ease-out) hover:-translate-y-px active:translate-y-0"
					>
						<GitHubIcon className="size-4" />
						Continue on sagargupta.online
					</a>

					<form action={enterDemo}>
						<button
							type="submit"
							className="flex min-h-11 w-full items-center justify-center rounded-md border border-hairline px-4 text-sm font-medium text-ink transition-colors duration-(--duration-fast) ease-(--ease-out) hover:border-hairline-strong hover:bg-surface-raised"
						>
							Explore with sample data
						</button>
					</form>
				</div>

				<p
					className="kf-rise text-xs leading-relaxed text-ink-faint"
					style={{ "--kf-delay": "180ms" } as CSSProperties}
				>
					GitHub is the only provider for now. Relatives without an account can still be invited by
					email.
				</p>
			</div>
		</main>
	);
}
