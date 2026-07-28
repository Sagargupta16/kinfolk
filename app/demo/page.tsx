"use client";

/**
 * Demo route: proves the fusion + layout pipeline end to end without a
 * database. Toggling "combined" is the clearest way to show what the product
 * actually does -- two families' records becoming one graph.
 */
import { useMemo, useState } from "react";
import { TreeCanvas } from "@/components/tree/TreeCanvas";
import { fuseTrees, toFlowGraph } from "@/lib/tree/graph";
import { sampleLinks, samplePrimaryTreeId, sampleSelfId, sampleSlices } from "@/lib/tree/sample";
import { cn } from "@/lib/utils";

export default function DemoPage() {
	const [combined, setCombined] = useState(true);
	const [showRelations, setShowRelations] = useState(true);

	const { nodes, edges, stats } = useMemo(() => {
		// Mine-only mode drops the other tree AND its links, which is exactly what
		// a viewer without a share grant would see.
		const slices = combined
			? sampleSlices
			: sampleSlices.filter((s) => s.treeId === samplePrimaryTreeId);
		const links = combined ? sampleLinks : [];

		const fused = fuseTrees(slices, links, samplePrimaryTreeId);
		const graph = toFlowGraph(fused, { includeRelations: showRelations });

		return {
			...graph,
			stats: {
				people: fused.people.length,
				rows: slices.reduce((n, s) => n + s.people.length, 0),
				merged: fused.people.filter((p) => p.sources.length > 1).length,
				relations: fused.relations.length,
			},
		};
	}, [combined, showRelations]);

	return (
		<main className="flex h-dvh flex-col bg-canvas">
			{/* Two rows on phones, one on desktop: a canvas app cannot spend 18% of a
			    phone screen on chrome. */}
			<header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline px-4 py-2.5 sm:px-6 sm:py-3">
				<div className="mr-auto">
					<h1 className="text-sm font-medium tracking-[-0.01em] text-ink">Kinfolk</h1>
					<p className="hidden font-mono text-[0.6875rem] text-ink-faint sm:block">
						demo data, no database
					</p>
				</div>

				<dl className="flex items-center gap-3 font-mono text-[0.6875rem] text-ink-muted sm:gap-4">
					<div className="flex items-center gap-1.5">
						<dt className="text-ink-faint">people</dt>
						<dd className="tabular text-ink">{stats.people}</dd>
					</div>
					<div className="flex items-center gap-1.5">
						<dt className="text-ink-faint">from rows</dt>
						<dd className="tabular text-ink">{stats.rows}</dd>
					</div>
					<div className="flex items-center gap-1.5">
						<dt className="text-ink-faint">merged</dt>
						<dd className="tabular text-accent">{stats.merged}</dd>
					</div>
					<div className="flex items-center gap-1.5">
						<dt className="text-ink-faint">links</dt>
						<dd className="tabular text-ink">{stats.relations}</dd>
					</div>
				</dl>

				{/* 44px minimum hit targets. */}
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => setShowRelations((value) => !value)}
						aria-pressed={showRelations}
						className={cn(
							"min-h-11 rounded-md border px-3.5 text-xs font-medium transition-colors duration-[--duration-fast] ease-[--ease-out]",
							showRelations
								? "border-hairline-strong bg-surface-raised text-ink"
								: "border-hairline text-ink-muted hover:border-hairline-strong",
						)}
					>
						<span className="sm:hidden">Links</span>
						<span className="hidden sm:inline">Social links</span>
					</button>

					<button
						type="button"
						onClick={() => setCombined((value) => !value)}
						aria-pressed={combined}
						className="min-h-11 rounded-md border border-hairline px-3.5 text-xs font-medium text-ink transition-colors duration-[--duration-fast] ease-[--ease-out] hover:border-hairline-strong hover:bg-surface-raised"
					>
						<span className="sm:hidden">{combined ? "Combined" : "Mine only"}</span>
						<span className="hidden sm:inline">
							{combined ? "Showing combined tree" : "Showing my tree only"}
						</span>
					</button>
				</div>
			</header>

			<div className="min-h-0 flex-1">
				<TreeCanvas nodes={nodes} edges={edges} selfId={sampleSelfId} />
			</div>
		</main>
	);
}
