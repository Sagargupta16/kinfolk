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
import { Activity, Rows3, Square, SquareDot } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { censusOf } from "@/lib/tree/census";
import { degrees } from "@/lib/tree/density";
import { familyFeed } from "@/lib/tree/feed";
import { displayName, type FlowEdge, type FlowNode, visibleEdges } from "@/lib/tree/graph";
import type { Kinship } from "@/lib/tree/kinship";
import type { Lod } from "@/lib/tree/layout";
import { cn } from "@/lib/utils";
import { EditorPanel, type PickablePerson } from "./EditorPanel";
import { FeedPanel } from "./FeedPanel";
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

const VIEWED_SOURCES_KEY = "kinfolk.viewed-sources";

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

	/**
	 * The durable subject of the workspace.
	 *
	 * This lives above TreeCanvas because changing detail level or arrangement remounts the
	 * React Flow provider. A viewed person is navigation state, not a transient selection,
	 * so cards, search, feed, breadcrumbs, editor and orbit all read this one id.
	 */
	const defaultViewedNode = useMemo(
		() =>
			nodes.find(
				(node) =>
					node.type === "person" &&
					Boolean(selfId && node.data.sources.some((source) => source.id === selfId)),
			) ?? nodes.find((node) => node.type === "person"),
		[nodes, selfId],
	);
	const defaultViewedId = defaultViewedNode?.id ?? null;
	const viewedSources = useRef(
		new Set(
			defaultViewedNode?.type === "person"
				? defaultViewedNode.data.sources.map(({ id }) => id)
				: [],
		),
	);
	const restoredViewedSources = useRef(false);
	const rememberViewed = useCallback((node: FlowNode | undefined) => {
		if (node?.type !== "person") return;
		const ids = node.data.sources.map((source) => source.id);
		viewedSources.current = new Set(ids);
		try {
			sessionStorage.setItem(VIEWED_SOURCES_KEY, JSON.stringify(ids));
		} catch {
			// A private window can reject storage. In-memory durability still works.
		}
	}, []);
	const [viewedId, setViewedId] = useState<string | null>(defaultViewedId);
	const changeViewed = useCallback(
		(id: string) => {
			const node = nodes.find((candidate) => candidate.type === "person" && candidate.id === id);
			rememberViewed(node);
			setViewedId(id);
		},
		[nodes, rememberViewed],
	);
	useEffect(() => {
		let restoring = false;
		if (!restoredViewedSources.current) {
			restoredViewedSources.current = true;
			try {
				const stored: unknown = JSON.parse(sessionStorage.getItem(VIEWED_SOURCES_KEY) ?? "null");
				if (Array.isArray(stored) && stored.every((id): id is string => typeof id === "string")) {
					viewedSources.current = new Set(stored);
					restoring = stored.length > 0;
				}
			} catch {
				// Invalid or unavailable session storage is equivalent to no remembered subject.
			}
		}

		const current = nodes.find((node) => node.type === "person" && node.id === viewedId);
		if (!restoring && current?.type === "person") {
			rememberViewed(current);
			return;
		}

		// A fused person's id is the smallest contributing source id, so changing the
		// visible tree set can rename the same human. Follow an intersecting source before
		// falling back to self; otherwise All trees -> My tree silently changes the subject.
		const remapped = nodes.find(
			(node) =>
				node.type === "person" &&
				node.data.sources.some((source) => viewedSources.current.has(source.id)),
		);
		const next = remapped?.type === "person" ? remapped : defaultViewedNode;
		rememberViewed(next);
		setViewedId(next?.id ?? null);
	}, [defaultViewedNode, nodes, rememberViewed, viewedId]);
	const picked = useMemo(() => {
		const node = nodes.find(
			(candidate) => candidate.type === "person" && candidate.id === viewedId,
		);
		return node?.type === "person" ? { id: node.id, name: displayName(node.data.primary) } : null;
	}, [nodes, viewedId]);
	const [quickAddRequest, setQuickAddRequest] = useState<{
		id: string;
		nonce: number;
	} | null>(null);

	/**
	 * A list, because a merged person can carry a row in more than one graph the viewer
	 * may write to. Today the view names one; the shape is right for when it names
	 * several, and `editTarget` cannot then be the thing that gets it wrong.
	 *
	 * Memoised because the canvas's `openQuickAdd` closes over it and the LAYOUT effect
	 * closes over that: a fresh array literal per render gave `openQuickAdd` a fresh
	 * identity per render, and every click or panel toggle re-ran ELK and re-framed the
	 * viewport for a graph that had not changed.
	 */
	const editableTreeIds = useMemo<string[]>(
		() => (editableTreeId ? [editableTreeId] : []),
		[editableTreeId],
	);

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
	const onGoTo = useCallback(
		(id: string) => {
			changeViewed(id);
			setGoTo({ id });
		},
		[changeViewed],
	);

	/**
	 * Whether the person detail panel is open, reported by the canvas.
	 *
	 * On a desktop that panel is a full-height 22rem rail pinned to the RIGHT -- the
	 * same edge this stage parks the arrangement, detail and legend controls on. The
	 * panel is deliberately non-modal, so leaving the controls underneath it made
	 * them dead while it was open (measured: every click landed on the panel). They
	 * slide left instead of stacking above it, because chrome floating OVER a panel
	 * of text is noise, and a control that moved aside is still where the eye saw it
	 * go.
	 */
	const [detailOpen, setDetailOpen] = useState(false);

	/**
	 * The family feed: the record as a stream, derived from the nodes already in
	 * memory (see lib/tree/feed.ts). It shares the detail panel's rail, so the two
	 * are mutually exclusive by construction -- opening a person closes the feed
	 * rather than stacking two sheets of glass on one edge.
	 */
	const [feedOpen, setFeedOpen] = useState(false);
	const feedEvents = useMemo(() => familyFeed(nodes), [nodes]);
	const feedVisible = feedOpen && !detailOpen;

	/**
	 * Ask the canvas to close the person panel, same nonce contract as `quickAddRequest`.
	 *
	 * The detail panel and the feed share one rail, and `detailId` lives inside the
	 * canvas -- so without this, pressing FEED while a person was open toggled state the
	 * viewer could not see: the button looked dead and `aria-pressed` disagreed with the
	 * screen. Pressing FEED now means "show me the feed", whatever the rail holds.
	 */
	const [closeDetailRequest, setCloseDetailRequest] = useState<{ nonce: number } | null>(null);
	const toggleFeed = useCallback(() => {
		if (feedVisible) {
			setFeedOpen(false);
			return;
		}
		setFeedOpen(true);
		setCloseDetailRequest({ nonce: Date.now() });
	}, [feedVisible]);

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
		<div className="kf-canvas-stage relative size-full">
			<TreeCanvas
				nodes={nodes}
				edges={edges}
				selfId={selfId}
				viewedId={viewedId}
				onViewedChange={changeViewed}
				lod={lod}
				onLodChange={setLod}
				view={view}
				depth={depth}
				canEdit={Boolean(editableTreeId)}
				editableTreeIds={editableTreeIds}
				goTo={goTo}
				onGoToHandled={() => setGoTo(null)}
				degree={degree}
				kinship={kinship}
				showRelations={showRelations}
				onFocusSearch={onFocusSearch}
				onDetailOpenChange={setDetailOpen}
				quickAddRequest={quickAddRequest}
				onQuickAddHandled={() => setQuickAddRequest(null)}
				closeDetailRequest={closeDetailRequest}
				onCloseDetailHandled={() => setCloseDetailRequest(null)}
			/>

			{/* Top-left, opposite the detail control. Capped and NOT full width on a phone:
			    the results drop over the canvas, and a list spanning the screen would hide
			    the tree it is meant to help you read. */}
			<div className="kf-search-dock absolute left-3 top-3 z-20 w-[min(18rem,calc(100%-10rem))]">
				<TreeSearch
					nodes={nodes}
					selfId={selfId}
					degree={degree}
					onGoTo={onGoTo}
					focusRef={focusSearch}
				/>
			</div>

			{/* Top-right on desktop. On a phone it disappears while a reading sheet is
			    open so the selected card can use the whole unobscured strip above it. */}
			<div
				className={cn(
					"kf-command-dock absolute right-3 top-3 z-30 flex flex-col items-end gap-1.5 opacity-100",
					"transition-[transform,opacity] duration-(--duration-base) ease-(--ease-out)",
					(detailOpen || feedVisible) &&
						"invisible pointer-events-none opacity-0 sm:visible sm:pointer-events-auto sm:-translate-x-[22.75rem] sm:opacity-100",
				)}
			>
				<span className="kf-command-dock__label hidden sm:block">View desk</span>
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
					canOrbit={Boolean(viewedId)}
				/>

				{/* A fieldset rather than role="group": same semantics, carried by the native
				    element with no ARIA attribute to keep in sync. The label lives in
				    aria-label because a visible <legend> would cost a line of canvas to say
				    what the three icons already say. */}
				<fieldset
					aria-label="Level of detail"
					className="kf-command-group kf-glass flex overflow-hidden rounded-lg"
				>
					{LEVELS.map(({ value, label, hint, Icon }) => (
						<button
							key={value}
							type="button"
							onClick={() => setLod(value)}
							aria-pressed={lod === value}
							title={hint}
							className={cn(
								// 44px tall AND wide: this is a primary control on a touch screen, and
								// below `sm` the label is hidden so the icon alone carried only 35px.
								"flex min-h-11 min-w-11 items-center justify-center gap-1.5 border-r border-hairline px-2.5 last:border-r-0",
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

				{/*
				 * The feed toggle, at the bottom of the cluster: it opens a reading surface
				 * rather than changing the canvas, so it sits below the controls that do.
				 */}
				<button
					type="button"
					onClick={toggleFeed}
					aria-pressed={feedVisible}
					title={
						feedVisible ? "Close the family feed" : "What changed in this record, newest first"
					}
					className={cn(
						"kf-command-button kf-glass flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5",
						"font-mono text-[0.625rem] uppercase tracking-wider",
						"transition-colors duration-(--duration-fast) ease-(--ease-out)",
						// `accent-ink`, not the raw accent: this is 10px text on glass, and the
						// hue that clears 3:1 as a graphic mark does not clear 4.5:1 as type.
						feedVisible ? "text-accent-ink" : "text-ink-faint hover:text-ink",
					)}
				>
					<Activity aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
					Feed
				</button>
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
				<div className="kf-editor-dock pointer-events-none absolute left-3 top-16 z-20 flex flex-col items-start gap-1.5">
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

			{/*
			 * The feed rail. Travelling from a row opens that person's detail panel,
			 * which takes over the rail; closing it returns to the feed, because
			 * `feedOpen` survives underneath. Browse, peek, come back.
			 */}
			<FeedPanel
				open={feedVisible}
				events={feedEvents}
				kinship={kinship}
				onGoTo={onGoTo}
				onClose={() => setFeedOpen(false)}
			/>
		</div>
	);
}
