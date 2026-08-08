import type { ReactNode } from "react";

type BrandFrameProps = {
	brandHref?: string;
	eyebrow: string;
	title: ReactNode;
	lede: ReactNode;
	actions: ReactNode;
	notice?: ReactNode;
	children?: ReactNode;
	folio?: string;
	compact?: boolean;
};

/**
 * The shared public shell for the Next and Vite front doors.
 *
 * Runtime-specific actions arrive as slots: Next keeps server-action forms and
 * Vite keeps its browser OAuth flow, while the visual structure stays identical.
 */
export function BrandFrame({
	brandHref = "/",
	eyebrow,
	title,
	lede,
	actions,
	notice,
	children,
	folio = "Field record 001",
	compact = false,
}: BrandFrameProps) {
	return (
		<main className={`kf-brand-shell${compact ? " kf-brand-shell--compact" : ""}`}>
			<div aria-hidden="true" className="kf-brand-atmosphere" />

			<div className="kf-brand-frame">
				<header className="kf-brand-masthead">
					<a href={brandHref} className="kf-brand-signature" aria-label="Kinfolk home">
						<span aria-hidden="true" className="kf-brand-seal">
							KF
						</span>
						<span className="kf-brand-wordmark">
							<strong>Kin / Folk</strong>
							<small>Private family atlas</small>
						</span>
					</a>

					<div className="kf-brand-folio">
						<span>{folio}</span>
						<span>Consent · provenance · kinship</span>
					</div>
				</header>

				<section className="kf-brand-hero">
					<div className="kf-brand-copy">
						<p className="kf-brand-eyebrow">
							<span>Filed under</span>
							{eyebrow}
						</p>
						<h1 className="kf-brand-heading">{title}</h1>
						<p className="kf-brand-lede">{lede}</p>
						<div className="kf-brand-actions">{actions}</div>
						{notice ? <div className="kf-brand-notice">{notice}</div> : null}
					</div>

					<RecordVignette />
				</section>

				{children}

				<footer className="kf-brand-footer">
					<span>One person can belong to many stories.</span>
					<span>Kinfolk · a consent-led family graph</span>
				</footer>
			</div>
		</main>
	);
}

/** The product model in one picture: two private records joined at one person. */
function RecordVignette() {
	return (
		<aside aria-hidden="true" className="kf-record-vignette">
			<div className="kf-record-vignette__topline">
				<span>Cross-reference</span>
				<span>KF–02 / verified</span>
			</div>

			<div className="kf-record-map">
				<span className="kf-record-thread kf-record-thread--a" />
				<span className="kf-record-thread kf-record-thread--b" />
				<span className="kf-record-thread kf-record-thread--c" />

				<article className="kf-record-card kf-record-card--a">
					<span>Record A · private</span>
					<strong>Your family</strong>
					<small>Original account retained</small>
				</article>

				<div className="kf-record-match">
					<span>Same person</span>
					<strong>Match agreed</strong>
				</div>

				<article className="kf-record-card kf-record-card--b">
					<span>Record B · private</span>
					<strong>Their family</strong>
					<small>Nothing overwritten</small>
				</article>
			</div>

			<div className="kf-record-vignette__footer">
				<span>Two records</span>
				<span>One human link</span>
			</div>
		</aside>
	);
}

const PRINCIPLES = [
	{
		number: "01",
		title: "Keep the original",
		body: "Each family owns its account. A shared match never replaces the record it came from.",
	},
	{
		number: "02",
		title: "Join by agreement",
		body: "Two entries become one point in the graph only after both sides confirm the human link.",
	},
	{
		number: "03",
		title: "Separate cleanly",
		body: "Remove a match and both records return intact, with their sources and privacy unchanged.",
	},
] as const;

export function ArchiveLedger() {
	return (
		<section className="kf-ledger-grid" aria-label="How Kinfolk joins family records">
			{PRINCIPLES.map((principle) => (
				<article key={principle.number} className="kf-ledger-row">
					<span className="kf-ledger-number">{principle.number}</span>
					<div>
						<h2>{principle.title}</h2>
						<p>{principle.body}</p>
					</div>
				</article>
			))}
		</section>
	);
}
