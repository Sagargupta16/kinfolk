/**
 * The workspace around the canvas: identity, stats, view toggles, demo banner.
 *
 * A server component wrapping the client canvas, so the toggles are plain links
 * that change `searchParams`. That keeps the view shareable and survivable across
 * a reload, and it means switching to mine-only genuinely re-fetches a smaller
 * dataset rather than hiding nodes the browser already received.
 */
import { GitMerge, Link2 } from "lucide-react";
import Link from "next/link";
import type { TreeView } from "@/lib/tree/view";
import { cn } from "@/lib/utils";
import { AccountBar } from "./AccountBar";
import { DemoBanner } from "./DemoBanner";
import { ThemeControls } from "./ThemeControls";
import { TreeStage } from "./TreeStage";

function Toggle({
	href,
	active,
	label,
	hint,
	Icon,
}: {
	href: string;
	active: boolean;
	label: string;
	hint: string;
	Icon: typeof Link2;
}) {
	return (
		<Link
			href={href}
			scroll={false}
			aria-pressed={active}
			aria-label={label}
			title={hint}
			className={cn(
				"kf-header-control flex size-11 items-center justify-center gap-2 rounded-md border text-xs font-medium",
				"xl:w-auto xl:px-3",
				"transition-colors duration-(--duration-fast) ease-(--ease-out)",
				active
					? "border-hairline-strong bg-surface-raised text-accent-ink"
					: "border-hairline text-ink-muted hover:border-hairline-strong hover:text-ink",
			)}
		>
			<Icon className="size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
			<span className="hidden xl:inline">{label}</span>
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
	const context = view.isDemo
		? `${stats.people} people, sample family`
		: view.isCombined && stats.trees > 1
			? `${stats.people} people, ${stats.trees} family trees together`
			: `${stats.people} people, private family record`;

	return (
		<main className="kf-workspace flex h-dvh flex-col bg-canvas">
			{/* The family name and one plain-language summary carry the context. Detailed
			    counts belong in the canvas key, not in the scarcest row on a phone. */}
			<header className="kf-workspace-masthead flex shrink-0 items-center gap-3 border-b border-hairline px-3 py-2.5 sm:px-5 sm:py-3">
				<div className="kf-workspace-identity min-w-0 flex-1">
					<span aria-hidden="true" className="kf-workspace-seal">
						KF
					</span>
					<div className="min-w-0">
						<p className="kf-workspace-eyebrow">Family field record</p>
						<h1 className="truncate text-sm font-medium text-ink">
							{view.treeNames[0] ?? "Your family tree"}
						</h1>
						<p className="tabular truncate text-[0.6875rem] text-ink-faint">{context}</p>
					</div>
				</div>

				<div className="kf-workspace-tools flex shrink-0 items-center gap-1.5 sm:gap-2">
					<Toggle
						href={relationsHref}
						active={view.showRelations}
						label="Connections"
						hint={view.showRelations ? "Hide social connections" : "Show social connections"}
						Icon={Link2}
					/>
					<Toggle
						href={combinedHref}
						active={view.isCombined}
						label={view.isCombined ? "All trees" : "My tree"}
						hint={
							view.isCombined
								? "Show only your own family tree"
								: "Show every family tree shared with you"
						}
						Icon={GitMerge}
					/>

					{/* Theme and motion. Hidden below `lg` because a compact header cannot hold
					    four more 44px targets beside the tree's own name -- and both are
					    reachable there anyway: `t` switches the theme, and the motion switch is
					    the one control a phone visitor is least likely to want mid-pan. */}
					<ThemeControls className="hidden lg:flex" />

					{/* Only for a real session. In demo mode there is nobody to sign out and
					    nothing to share, so the control is absent rather than disabled. */}
					{view.viewer && (
						<AccountBar
							name={view.viewer.name}
							email={view.viewer.email}
							editableTreeId={view.editableTreeId}
						/>
					)}
				</div>
			</header>

			{view.isDemo && <DemoBanner />}

			<div className="kf-workspace-canvas min-h-0 flex-1">
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
					editableTreeId={view.editableTreeId}
				/>
			</div>
		</main>
	);
}
