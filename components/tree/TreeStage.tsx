"use client";

/**
 * The canvas plus its chrome: detail level, search, legend, editor.
 *
 * LOD is client state, deliberately unlike the combined and social-links toggles which
 * live in `searchParams`. Those change WHICH DATA is fetched, so a URL round trip is the
 * honest implementation and the resulting view is worth sharing. Detail level changes
 * nothing about the data -- it is how much of each person is drawn -- so a server round
 * trip would buy a shareable link nobody wants at the cost of making a purely visual
 * switch feel like a page load.
 *
 * It lives HERE rather than inside the canvas because the `d` shortcut cycles it and the
 * button group displays it, so the two have to read one value. The canvas is handed the
 * value and a setter.
 */
import { Rows3, Square, SquareDot } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { censusOf } from "@/lib/tree/census";
import { degrees } from "@/lib/tree/density";
import { displayName, type FlowEdge, type FlowNode, visibleEdges } from "@/lib/tree/graph";
import type { Kinship } from "@/lib/tree/kinship";
import type { Lod } from "@/lib/tree/layout";
import { cn } from "@/lib/utils";
import { EditorPanel, type PickablePerson } from "./EditorPanel";
import { TreeCanvas } from "./TreeCanvas";
import { TreeLegend } from "./TreeLegend";
import { TreeSearch } from "./TreeSearch";
import { ViewControls, type ViewMode } from "./ViewControls";

/**
 * Ordered least to most collapsed, which is the direction the control reads.
 *
 * The labels name what you GET, not what is hidden: "cards" / "rows" / "dots" describes
 * the resulting canvas, where "detailed" / "medium" / "low" would describe a setting and
 * leave you to guess the effect.
 */
const LEVELS: { value: Lod; label: string; hint: string; Icon: typeof Square }[] = [
	{ value: "full", label: "Cards", hint: "Full cards: dates, provenance, channels", Icon: Square },
	{ value: "compact", label: "Rows", hint: "Names and dates only", Icon: Rows3 },
	{ value: "dot", label: "Dots", hint: "Shape of the whole graph", Icon: SquareDot },
];

export function TreeStage({
	nodes,
	edges,
	selfId,
	kinship,
	showRelations = true,
	editableTreeId,
}: {
	nodes: FlowNode[];
	/** Every edge, including hidden relations: layout needs them. See TreeWorkspace. */
	edges: FlowEdge[];
	selfId?: string;
	kinship?: Map<string, Kinship>;
	/** False draws the bare family skeleton, without changing where anyone sits. */
	showRelations?: boolean;
	/**
	 * The graph this viewer may write to, or absent for a read-only canvas.
	 *
	 * Its absence hides the editor entirely -- a disabled Add button would advertise an
	 * action that can never work here. The server re-checks anyway; this only decides
	 * what to draw.
	 */
	editableTreeId?: string | null;
}) {
	const [lod, setLod] = useState<Lod>("full");
	/**
	 * Arrangement and depth, client state for the same reason the detail level is: neither
	 * changes WHICH DATA is fetched, so a URL round trip would make a purely visual switch
	 * feel like a page load.
	 */
	const [view, setView] = useState<ViewMode>("tree");
	const [depth, setDepth] = useState(false);

	/** Filled by TreeSearch, invoked by the `/` shortcut the canvas owns. */
	const focusSearch = useRef<(() => void) | null>(null);
	const onFocusSearch = useCallback(() => focusSearch.current?.(), []);

	/** The card most recently clicked, which pre-fills the editor's "from" field. */
	const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
	const [quickAddRequest, setQuickAddRequest] = useState<{
		id: string;
		nonce: number;
	} | null>(null);

	/**
	 * People the pickers can offer, derived from the nodes already on screen.
	 *
	 * Not a server round trip: these nodes are in memory, carry their names, and are
	 * exactly the set a viewer can see. Only names are needed, never contact values.
	 */
	const pickable = useMemo<PickablePerson[]>(
		() =>
			nodes
				.filter((node) => node.type === "person")
				.map((node) => ({ id: node.id, name: displayName(node.data.primary) }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		[nodes],
	);

	// A fresh object per request, so searching the same name twice still travels. The
	// canvas compares by identity for exactly this reason.
	const [goTo, setGoTo] = useState<{ id: string } | null>(null);
	const onGoTo = useCallback((id: string) => setGoTo({ id }), []);

	/*
	 * Computed here rather than in each consumer: the canvas draws presence rings from it
	 * and search ranks namesakes by it, and doing it twice over 151 nodes on every render
	 * would be the same work for the same answer.
	 *
	 * From the VISIBLE edges, so a ring never claims a connection whose line the viewer
	 * has switched off.
	 */
	const drawn = useMemo(() => visibleEdges(edges, showRelations), [edges, showRelations]);
	const degree = useMemo(() => degrees(nodes, drawn), [nodes, drawn]);

	/*
	 * What the legend is allowed to explain: only encodings this canvas can produce.
	 *
	 * Deliberately the ENABLED set rather than the momentarily-rendered one. Relations are
	 * revealed one person at a time, so a census over what is literally on screen would
	 * empty every relation row the instant the pointer left a card -- a key that blanks
	 * itself while you read it. The counts answer "what is in this graph"; the section's
	 * note answers "when will I see it".
	 */
	const census = useMemo(() => censusOf(nodes, drawn, degree), [nodes, drawn, degree]);

	return (
		<div className="relative size-full">
			<TreeCanvas
				nodes={nodes}
				edges={edges}
				selfId={selfId}
				lod={lod}
				onLodChange={setLod}
				view={view}
				depth={depth}
				canEdit={Boolean(editableTreeId)}
				// A list, because a merged person can carry a row in more than one graph the
				// viewer may write to. Today the view names one; the shape is right for when it
				// names several, and `editTarget` cannot then be the thing that gets it wrong.
				editableTreeIds={editableTreeId ? [editableTreeId] : []}
				goTo={goTo}
				degree={degree}
				kinship={kinship}
				showRelations={showRelations}
				onFocusSearch={onFocusSearch}
				onPick={setPicked}
				quickAddRequest={quickAddRequest}
				onQuickAddHandled={() => setQuickAddRequest(null)}
			/>

			{/* Top-left, opposite the detail control. Capped and NOT full width on a phone:
			    the results drop over the canvas, and a list spanning the screen would hide
			    the tree it is meant to help you read. */}
			<div className="absolute left-3 top-3 z-20 w-[min(15rem,calc(100%-8.5rem))]">
				<TreeSearch
					nodes={nodes}
					selfId={selfId}
					degree={degree}
					onGoTo={onGoTo}
					focusRef={focusSearch}
				/>
			</div>

			{/* Top-right: React Flow puts its own zoom controls bottom-left, and the two must
			    not share an edge on a phone. z-30 beats the search dropdown's z-20 -- both can
			    be open at once on a phone, and the one just clicked has to be on top. */}
			<div className="absolute right-3 top-3 z-30 flex flex-col items-end gap-1.5">
				{/* Arrangement first, because it changes what the detail control is describing:
				    "cards / rows / dots" applies to either view, but the reader picks the shape
				    before they pick how much of each person to draw.

				    Orbit needs a centre. `selfId` is the fallback, so a signed-in viewer can
				    always orbit; a demo visitor with no self node has to pick somebody first. */}
				<ViewControls
					mode={view}
					onMode={setView}
					depth={depth}
					onDepth={setDepth}
					canOrbit={Boolean(selfId || picked)}
				/>

				{/* A fieldset rather than role="group": same semantics, carried by the native
				    element with no ARIA attribute to keep in sync. The label lives in
				    aria-label because a visible <legend> would cost a line of canvas to say
				    what the three icons already say. */}
				<fieldset aria-label="Level of detail" className="kf-glass flex overflow-hidden rounded-lg">
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
								"transition-colors duration-(--duration-fast) ease-(--ease-out)",
								lod === value
									? "bg-surface-raised text-accent-ink"
									: "text-ink-faint hover:bg-surface-raised hover:text-ink",
							)}
						>
							<Icon aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
							{/* The icon carries it on a phone; the word is what makes it unambiguous
							    once there is room. */}
							<span className="hidden sm:inline">{label}</span>
						</button>
					))}
				</fieldset>

				{/* UNDER the detail control, not beside it. A phone's top row already holds
				    search and three detail buttons; a fourth on that line would take its width
				    from the search box, which is the one thing up here that needs typing into.
				    It also has to sit below the control it partly describes: the legend changes
				    with the detail level, since a dot encodes living/dead in its fill where a
				    card uses the rail. */}
				<TreeLegend census={census} lod={lod} hasSelf={Boolean(selfId)} />
			</div>

			{/*
			 * TOP-LEFT, under search, and only when there is something to write to.
			 *
			 * It started bottom-left and that was wrong: it sat beside React Flow's zoom stack,
			 * below the fold of a short viewport, in the corner a reader scans last. Adding a
			 * person is the primary action of an editor, so it belongs where the eye starts --
			 * and it pairs with search, since both answer "which person".
			 *
			 * z-20 matches the search dropdown rather than beating it: results drop DOWN over
			 * this button, and the list you are reading has to win.
			 */}
			{editableTreeId && (
				<div className="pointer-events-none absolute left-3 top-16 z-20 flex flex-col items-start gap-1.5">
					<EditorPanel
						treeId={editableTreeId}
						people={pickable}
						selectedId={picked?.id}
						selectedName={picked?.name}
						onQuickAdd={
							picked ? () => setQuickAddRequest({ id: picked.id, nonce: Date.now() }) : undefined
						}
					/>
				</div>
			)}
		</div>
	);
}
