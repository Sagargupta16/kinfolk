/**
 * The workspace around the canvas: identity, stats, demo banner.
 *
 * A server component wrapping the client canvas. The view toggles live in the stage's
 * Options panel (see ScopeToggle.tsx): mine-only is still a link that changes
 * `searchParams`, because it genuinely re-fetches a smaller dataset rather than hiding
 * nodes the browser already received, while social links only change what is drawn.
 */
import Link from "next/link";
import { AppearanceMenu } from "@/components/ui/AppearanceMenu";
import type { TreeView } from "@/lib/tree/view";
import { AccountBar } from "./AccountBar";
import { DemoBanner } from "./DemoBanner";
import { EmptyFamily } from "./EmptyFamily";
import { TreeStage } from "./TreeStage";

export function TreeWorkspace({ view }: { view: TreeView }) {
	const { stats } = view;

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
					<Link href="/" className="kf-workspace-seal" aria-label="Kinfolk home">
						KF
					</Link>
					<div className="min-w-0">
						<p className="kf-workspace-eyebrow">Kinfolk / Family atlas</p>
						<h1 className="truncate text-sm font-medium text-ink">
							{view.treeNames[0] ?? "Your family tree"}
						</h1>
						<p className="tabular truncate text-[0.6875rem] text-ink-faint">{context}</p>
					</div>
				</div>

				<div className="kf-workspace-tools flex shrink-0 items-center gap-1.5 sm:gap-2">
					<AppearanceMenu />

					{/* Only for a real session. In demo mode there is nobody to sign out and
					    nothing to share, so the control is absent rather than disabled. */}
					{view.viewer && (
						<AccountBar
							name={view.viewer.name}
							email={view.viewer.email}
							editableTreeId={view.editableTreeId}
							editableTrees={view.editableTrees}
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
				{view.nodes.length === 0 ? (
					<EmptyFamily treeId={view.editableTreeId} />
				) : (
					<TreeStage
						nodes={view.nodes}
						edges={view.edges}
						selfId={view.selfId}
						kinship={view.kinship}
						showRelations={view.showRelations}
						editableTreeId={view.editableTreeId}
						editableTreeIds={view.editableTreeIds}
						editableUnions={view.editableUnions}
						isCombined={view.isCombined}
						isDemo={view.isDemo}
					/>
				)}
			</div>
		</main>
	);
}
