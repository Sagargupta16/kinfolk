/**
 * Sign-in. Referenced by `pages.signIn` in auth.ts, so Auth.js redirects here
 * whenever an unauthenticated request hits a protected route.
 *
 * Sign-in itself lives on the public site because the GitHub OAuth App has one
 * callback URL. This page keeps that boundary explicit instead of offering a
 * control that would fail with `redirect_uri_mismatch`.
 */
import { redirect } from "next/navigation";
import { sessionOrNull } from "@/auth";
import { BrandFrame } from "@/components/ui/BrandFrame";
import { GitHubIcon } from "@/components/ui/GitHubIcon";
import { enterDemo } from "@/lib/tree/demo-actions";

export const metadata = { title: "Sign in -- Kinfolk" };

export default async function SignInPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	const { error } = await searchParams;
	const session = await sessionOrNull();
	if (session?.user) redirect("/tree");

	return (
		<BrandFrame
			compact
			eyebrow="Secure entry / GitHub identity"
			folio="Access record 001"
			title={
				<>
					Open your family record.
					<span className="kf-brand-accent">Your sources stay yours.</span>
				</>
			}
			lede="Authentication proves who may enter; it does not make a family public. Shared people appear only through invitations and mutual matches."
			actions={
				<>
					<a href="https://sagargupta.online/kinfolk/" className="kf-primary-action">
						<GitHubIcon className="size-4" />
						Continue on sagargupta.online
					</a>
					<form action={enterDemo}>
						<button type="submit" className="kf-secondary-action">
							Explore without an account
						</button>
					</form>
				</>
			}
			notice={
				error ? (
					<p role="alert">That sign-in did not complete. Please try again from the public site.</p>
				) : (
					<p>GitHub is the only identity provider for now. Invited relatives can join later.</p>
				)
			}
		>
			<section className="kf-access-strip" aria-label="Access and privacy summary">
				<div>
					<span>Identity</span>
					<strong>GitHub verified</strong>
				</div>
				<div>
					<span>Record</span>
					<strong>Private by default</strong>
				</div>
				<div>
					<span>Joining</span>
					<strong>Mutual confirmation</strong>
				</div>
			</section>
		</BrandFrame>
	);
}
