"use client";

/**
 * The canvas plus its level-of-detail control.
 *
 * LOD is client state, deliberately unlike the combined and social-links toggles
 * which live in `searchParams`. Those change WHICH DATA is fetched, so a URL
 * round trip is the honest implementation and the resulting view is worth
 * sharing. Detail level changes nothing about the data -- it is how much of each
 * person is drawn -- so a server round trip would buy a shareable link nobody
 * wants at the cost of making a purely visual switch feel like a page load.
 *
 * It sits on the canvas rather than in the header because the header is the
 * scarcest space on a phone, and because this control belongs to the thing it
 * changes.
 */
import { Rows3, Square, SquareDot } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { degrees } from "@/lib/tree/density";
import { type FlowEdge, type FlowNode, visibleEdges } from "@/lib/tree/graph";
import type { Lod } from "@/lib/tree/layout";
import { cn } from "@/lib/utils";
import { TreeCanvas } from "./TreeCanvas";
import { TreeSearch } from "./TreeSearch";

/**
 * Ordered least to most collapsed, which is the direction the control reads.
 *
 * The labels name what you GET, not what is hidden: "cards" / "rows" / "dots"
 * describes the resulting canvas, where "detailed" / "medium" / "low" would
 * describe a setting and leave you to guess the effect.
 */
const LEVELS: { value: Lod; label: string; hint: string; Icon: typeof Square }[] = [
	{ value: "full", label: "Cards", hint: "Full cards: dates, provenance, channels", Icon: Square },
	{ value: "compact", label: "Rows", hint: "Names and dates only", Icon: Rows3 },
	{ value: "dot", label: "Dots", hint: "Shape of the whole family", Icon: SquareDot },
];

export function TreeStage({
	nodes,
	edges,
	selfId,
	showRelations = true,
}: {
	nodes: FlowNode[];
	/** Every edge, including hidden relations: layout needs them. See TreeWorkspace. */
	edges: FlowEdge[];
	selfId?: string;
	/** False draws the bare family skeleton, without changing where anyone sits. */
	showRelations?: boolean;
}) {
	const [lod, setLod] = useState<Lod>("full");

	// A fresh object per request, so searching the same name twice still travels.
	// The canvas compares by identity for exactly this reason.
	const [goTo, setGoTo] = useState<{ id: string } | null>(null);
	const onGoTo = useCallback((id: string) => setGoTo({ id }), []);

	// Computed here rather than in each consumer: the canvas draws presence rings
	// from it and search ranks namesakes by it, and doing it twice over 151 nodes on
	// every render would be the same work for the same answer.
	//
	// From the VISIBLE edges, so a ring never claims a connection whose line the
	// viewer has switched off.
	const degree = useMemo(
		() => degrees(nodes, visibleEdges(edges, showRelations)),
		[nodes, edges, showRelations],
	);

	return (
		<div className="relative size-full">
			<TreeCanvas
				nodes={nodes}
				edges={edges}
				selfId={selfId}
				lod={lod}
				goTo={goTo}
				degree={degree}
				showRelations={showRelations}
			/>

			{/* Top-left, opposite the detail control.
			    Capped at 15rem and NOT full width on a phone: the results drop over the
			    canvas, and a list spanning the screen would hide the tree it is meant to
			    help you read. */}
			<div className="absolute left-3 top-3 z-20 w-[min(15rem,calc(100%-8.5rem))]">
				<TreeSearch nodes={nodes} selfId={selfId} degree={degree} onGoTo={onGoTo} />
			</div>

			{/* Top-right: React Flow puts its own zoom controls bottom-left, and the
			    two must not share an edge on a phone. Above the canvas, so it needs a
			    z-index that clears React Flow's own panes. */}
			{/* A fieldset rather than role="group": same semantics, and the native
			    element carries them without an ARIA attribute to keep in sync. The
			    label lives in aria-label because a visible <legend> would cost a line
			    of canvas to say something the three icons already say. */}
			<fieldset
				aria-label="Level of detail"
				className={cn(
					"absolute right-3 top-3 z-10 flex overflow-hidden rounded-md",
					"border border-hairline bg-surface/90 backdrop-blur-sm",
				)}
			>
				{LEVELS.map(({ value, label, hint, Icon }) => (
					<button
						key={value}
						type="button"
						onClick={() => setLod(value)}
						aria-pressed={lod === value}
						title={hint}
						className={cn(
							// 44px tall: this is a primary control on a touch screen.
							"flex min-h-11 items-center gap-1.5 border-r border-hairline px-2.5 last:border-r-0",
							"font-mono text-[0.625rem] uppercase tracking-wider",
							"transition-colors duration-[--duration-fast] ease-[--ease-out]",
							lod === value
								? "bg-surface-raised text-accent"
								: "text-ink-faint hover:bg-surface-raised hover:text-ink",
						)}
					>
						<Icon aria-hidden className="size-3.5" strokeWidth={1.5} />
						{/* The icon carries it on a phone; the word is what makes it
						    unambiguous once there is room for it. */}
						<span className="hidden sm:inline">{label}</span>
					</button>
				))}
			</fieldset>
		</div>
	);
}
