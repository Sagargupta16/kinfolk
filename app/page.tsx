import Link from "next/link";
import { ArchiveLedger, BrandFrame } from "@/components/ui/BrandFrame";
import { enterDemo } from "@/lib/tree/demo-actions";

export default function HomePage() {
	return (
		<BrandFrame
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
					<form action={enterDemo}>
						<button type="submit" className="kf-primary-action">
							Open the sample archive
						</button>
					</form>
					<Link href="/signin" className="kf-secondary-action">
						Sign in to your record
					</Link>
				</>
			}
		>
			<ArchiveLedger />
		</BrandFrame>
	);
}
