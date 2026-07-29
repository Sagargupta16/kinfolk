/**
 * The workspace around the canvas: identity, stats, view toggles, demo banner.
 *
 * A server component wrapping the client canvas, so the toggles are plain links
 * that change `searchParams`. That keeps the view shareable and survivable across
 * a reload, and it means switching to mine-only genuinely re-fetches a smaller
 * dataset rather than hiding nodes the browser already received.
 */
import Link from "next/link";
import type { TreeView } from "@/lib/tree/view";
import { cn } from "@/lib/utils";
import { DemoBanner } from "./DemoBanner";
import { TreeStage } from "./TreeStage";

/** Mono stat, `tabular-nums` so digits do not jitter between values. */
function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
	return (
		<div className="flex items-center gap-1.5">
			<dt className="text-ink-faint">{label}</dt>
			<dd className={cn("tabular", accent ? "text-accent" : "text-ink")}>{value}</dd>
		</div>
	);
}

function Toggle({
	href,
	active,
	short,
	long,
}: {
	href: string;
	active: boolean;
	short: string;
	long: string;
}) {
	return (
		<Link
			href={href}
			scroll={false}
			aria-pressed={active}
			className={cn(
				"flex min-h-11 items-center rounded-md border px-3.5 text-xs font-medium",
				"transition-colors duration-(--duration-fast) ease-(--ease-out)",
				active
					? "border-hairline-strong bg-surface-raised text-ink"
					: "border-hairline text-ink-muted hover:border-hairline-strong hover:text-ink",
			)}
		>
			<span className="sm:hidden">{short}</span>
			<span className="hidden sm:inline">{long}</span>
		</Link>
	);
}

export function TreeWorkspace({ view }: { view: TreeView }) {
	const { stats } = view;

	// Toggles are URL state, so each link is the current view with one flag flipped.
	const combinedHref = view.isCombined ? "/tree?combined=0" : "/tree";
	const relationsHref = view.showRelations
		? `/tree?relations=0${view.isCombined ? "" : "&combined=0"}`
		: `/tree${view.isCombined ? "" : "?combined=0"}`;

	return (
		<main className="flex h-dvh flex-col bg-canvas">
			{/* One row on a phone, not three. A canvas app cannot spend half a phone
			    screen on chrome, so the stats drop to the two that matter and the
			    toggles shorten rather than wrapping onto their own line. */}
			<header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5 sm:gap-6 sm:px-6 sm:py-3">
				<div className="min-w-0 flex-1">
					<h1 className="truncate text-sm font-medium tracking-[-0.01em] text-ink">
						{view.treeNames[0] ?? "Your tree"}
					</h1>
					<p className="truncate font-mono text-[0.6875rem] text-ink-faint">
						{view.isDemo
							? "sample data, no database"
							: stats.trees > 1
								? `${stats.trees} trees joined`
								: "your records"}
					</p>
				</div>

				{/* On a phone only `merged` survives: it is the one number you cannot get
				    by looking at the canvas, and every stat kept here is width taken from
				    the tree's own name. */}
				<dl className="flex shrink-0 items-center gap-3 font-mono text-[0.6875rem] text-ink-muted sm:gap-4">
					<div className="hidden sm:contents">
						<Stat label="people" value={stats.people} />
						<Stat label="from rows" value={stats.rows} />
					</div>
					<Stat label="merged" value={stats.merged} accent />
					<div className="hidden sm:contents">
						<Stat label="links" value={stats.relations} />
					</div>
				</dl>

				<div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
					<Toggle
						href={relationsHref}
						active={view.showRelations}
						short="Links"
						long="Social links"
					/>
					<Toggle
						href={combinedHref}
						active={view.isCombined}
						short={view.isCombined ? "Both" : "Mine"}
						long={view.isCombined ? "Showing combined tree" : "Showing my tree only"}
					/>
				</div>
			</header>

			{view.isDemo && <DemoBanner />}

			<div className="min-h-0 flex-1">
				{/* Every edge is handed down, including the relations this viewer has
				    switched off: the layout engine needs them to place a person who has
				    no family, and dropping them earlier put those people in a phantom
				    generation above the grandparents. The stage decides what is drawn. */}
				<TreeStage
					nodes={view.nodes}
					edges={view.edges}
					selfId={view.selfId}
					kinship={view.kinship}
					showRelations={view.showRelations}
				/>
			</div>
		</main>
	);
}
