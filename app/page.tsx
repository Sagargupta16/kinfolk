import Link from "next/link";
import { ArchiveLedger, BrandFrame } from "@/components/ui/BrandFrame";
import { enterDemo } from "@/lib/tree/demo-actions";

export default function HomePage() {
	return (
		<BrandFrame
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
					<form action={enterDemo}>
						<button type="submit" className="kf-primary-action">
							Explore the sample family
						</button>
					</form>
					<Link href="/signin" className="kf-secondary-action">
						Start your family tree
					</Link>
				</>
			}
		>
			<ArchiveLedger />
		</BrandFrame>
	);
}
