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
					Your family is more than a tree.
					<span className="kf-brand-accent">Map the whole living record.</span>
				</>
			}
			lede="Kinfolk keeps every family's account intact, then joins matching people only when both sides agree. Trace relatives, chosen family, neighbours, and the relationships that explain how everyone fits."
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
						Sign in with GitHub
					</button>
					<a href={`${base}tree?demo=1`} className="kf-secondary-action">
						Open the sample archive
					</a>
					<a href="https://github.com/Sagargupta16/kinfolk" className="kf-text-action">
						View source
					</a>
				</>
			}
			notice={error ? <p role="alert">{error}</p> : undefined}
		>
			<ArchiveLedger />
		</BrandFrame>
	);
}
