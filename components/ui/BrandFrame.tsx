import { ArrowUpRight, GitBranch, Link2, LockKeyhole, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { AppearanceMenu } from "./AppearanceMenu";

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
	folio = "Private by default",
	compact = false,
}: BrandFrameProps) {
	return (
		<main className={`kf-brand-shell${compact ? " kf-brand-shell--compact" : ""}`}>
			<div className="kf-brand-frame">
				<header className="kf-brand-masthead">
					<a href={brandHref} className="kf-brand-signature" aria-label="Kinfolk home">
						<span aria-hidden="true" className="kf-brand-seal">
							KF
						</span>
						<span className="kf-brand-wordmark">
							<strong>kinfolk</strong>
							<small>Your family atlas</small>
						</span>
					</a>

					<nav className="kf-brand-navigation" aria-label="Kinfolk">
						<span className="kf-brand-folio">
							<LockKeyhole size={13} aria-hidden="true" />
							{folio}
						</span>
						<a className="kf-brand-source" href="https://github.com/Sagargupta16/kinfolk">
							Source <ArrowUpRight size={14} aria-hidden="true" />
						</a>
						<AppearanceMenu />
					</nav>
				</header>

				<section className="kf-brand-hero">
					<div className="kf-brand-copy">
						<p className="kf-brand-eyebrow">
							<GitBranch size={14} aria-hidden="true" />
							{eyebrow}
						</p>
						<h1 className="kf-brand-heading">{title}</h1>
						<p className="kf-brand-lede">{lede}</p>
						<div className="kf-brand-actions">{actions}</div>
						{notice ? <div className="kf-brand-notice">{notice}</div> : null}
					</div>

					<AtlasPreview />
				</section>

				{children}

				<footer className="kf-brand-footer">
					<div>
						<strong>kinfolk</strong>
						<span>Every branch has a story.</span>
					</div>
					<a href="https://github.com/Sagargupta16/kinfolk">
						Open source. Built with care.
						<ArrowUpRight size={14} aria-hidden="true" />
					</a>
				</footer>
			</div>
		</main>
	);
}

/** The product model in one picture: two private records joined at one person. */
function AtlasPreview() {
	return (
		<aside aria-hidden="true" className="kf-atlas-preview">
			<div className="kf-atlas-preview__heading">
				<span>
					<GitBranch size={15} />A little more connected.
				</span>
				<span>Illustration</span>
			</div>
			<div className="kf-atlas-map">
				<div className="kf-atlas-generation">
					<span>01</span>
					<span>Every family starts somewhere</span>
				</div>
				<div className="kf-atlas-pair">
					<div className="kf-atlas-person">
						<span className="kf-atlas-initial">A</span>
						<div>
							<strong>Alex</strong>
							<span>Your family record</span>
						</div>
					</div>
					<div className="kf-atlas-person">
						<span className="kf-atlas-initial">R</span>
						<div>
							<strong>Robin</strong>
							<span>Their family record</span>
						</div>
					</div>
				</div>
				<div className="kf-atlas-connector" />
				<div className="kf-atlas-generation">
					<span>02</span>
					<span>Find the people you share</span>
				</div>
				<div className="kf-atlas-person kf-atlas-person--shared">
					<span className="kf-atlas-initial">S</span>
					<div>
						<strong>Sam</strong>
						<span>One person. Two family stories.</span>
					</div>
					<Link2 size={16} />
				</div>
				<div className="kf-atlas-match">
					<ShieldCheck size={14} />
					Linked when both families agree
				</div>
			</div>
			<div className="kf-atlas-preview__footer">
				<LockKeyhole size={14} />
				<span>Original records always stay with their families.</span>
			</div>
		</aside>
	);
}

const PRINCIPLES = [
	{
		number: "01",
		title: "Make room for everyone.",
		body: "Parents, partners, chosen family. Map the relationships that matter, with the details you know.",
	},
	{
		number: "02",
		title: "Connect on your terms.",
		body: "Invite relatives into your tree. Join matching records only when both families agree.",
	},
	{
		number: "03",
		title: "Keep every perspective.",
		body: "See where a detail came from. Unlink a match whenever needed; both original records stay intact.",
	},
] as const;

export function ArchiveLedger() {
	return (
		<section className="kf-ledger-grid" aria-label="A place for your whole family">
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
