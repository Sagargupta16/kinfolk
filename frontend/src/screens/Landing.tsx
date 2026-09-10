import { useState } from "react";
import { ArchiveLedger, BrandFrame } from "@/components/ui/BrandFrame";
import { startSignIn } from "../auth";

/** The Pages front door; auth actions stay local while its frame is shared with Next. */
export function Landing() {
	const [error, setError] = useState<string | null>(null);
	const base = import.meta.env.BASE_URL;

	return (
		<BrandFrame
			brandHref={base}
			eyebrow="A private family atlas"
			title={
				<>
					Your people.
					<br />
					Their stories.
					<span className="kf-brand-accent">One family atlas.</span>
				</>
			}
			lede="A place for the people who make you, you. Build your family tree, keep the details that matter, and discover how your stories connect."
			actions={
				<>
					<button
						type="button"
						className="kf-primary-action"
						onClick={() => {
							setError(null);
							startSignIn().catch((caught: unknown) =>
								setError(caught instanceof Error ? caught.message : "Sign-in is unavailable."),
							);
						}}
					>
						Start with GitHub
					</button>
					<a href={`${base}tree?demo=1`} className="kf-secondary-action">
						Explore the sample family
					</a>
				</>
			}
			notice={error ? <p role="alert">{error}</p> : undefined}
		>
			<ArchiveLedger />
		</BrandFrame>
	);
}
