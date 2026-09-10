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
import {
	Activity,
	GitBranch,
	Link2,
	Plus,
	Rows3,
	SlidersHorizontal,
	Square,
	SquareDot,
	Users,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { censusOf } from "@/lib/tree/census";
import { degrees } from "@/lib/tree/density";
import { editTarget } from "@/lib/tree/editable";
import { familyFeed } from "@/lib/tree/feed";
import {
	displayName,
	type FlowEdge,
	type FlowNode,
	type UnionWithChildren,
	visibleEdges,
} from "@/lib/tree/graph";
import type { Kinship } from "@/lib/tree/kinship";
import type { Lod } from "@/lib/tree/layout";
import { EditorPanel, type PickablePerson } from "./EditorPanel";
import { useEscapeClose } from "./escape";
import { FeedPanel } from "./FeedPanel";
import { PeopleDirectory } from "./PeopleDirectory";
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
const EMPTY_UNIONS: UnionWithChildren[] = [];

export function TreeStage({
	nodes,
	edges,
	selfId,
	kinship,
	showRelations = true,
	editableTreeId,
	editableTreeIds: writableTreeIds,
	editableUnions = EMPTY_UNIONS,
	scopeControls,
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
	editableTreeIds?: readonly string[];
	editableUnions?: UnionWithChildren[];
	scopeControls?: ReactNode;
}) {
	const [lod, setLod] = useState<Lod>("full");
	const [screen, setScreen] = useState<"tree" | "people">("tree");
	const [optionsOpen, setOptionsOpen] = useState(false);
	const [editorOpen, setEditorOpen] = useState(false);
	const optionsId = useId();
	const optionsRef = useRef<HTMLDivElement>(null);
	useEscapeClose(optionsOpen, () => setOptionsOpen(false));
	useEffect(() => {
		if (!optionsOpen) return;
		const dismiss = (event: PointerEvent) => {
			if (!optionsRef.current?.contains(event.target as Node)) setOptionsOpen(false);
		};
		document.addEventListener("pointerdown", dismiss);
		return () => document.removeEventListener("pointerdown", dismiss);
	}, [optionsOpen]);
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
	const editableTreeIds = useMemo<readonly string[]>(
		() => writableTreeIds ?? (editableTreeId ? [editableTreeId] : []),
		[editableTreeId, writableTreeIds],
	);
	const selectedTarget = useMemo(() => {
		const node = nodes.find((node) => node.type === "person" && node.id === viewedId);
		return node?.type === "person" ? editTarget(node.data, editableTreeIds) : null;
	}, [nodes, viewedId, editableTreeIds]);
	const editorTreeId = selectedTarget?.editable ? selectedTarget.treeId : editableTreeId;

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
				.flatMap((node) => {
					const source = node.data.sources.find((row) => row.treeId === editorTreeId);
					return source ? [{ id: source.id, name: displayName(source) }] : [];
				})
				.sort((a, b) => a.name.localeCompare(b.name)),
		[nodes, editorTreeId],
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
	const feedEvents = useMemo(() => familyFeed(nodes, edges), [nodes, edges]);
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
		<div className="kf-canvas-stage relative flex size-full flex-col">
			<div className="kf-workspace-toolbar">
				<fieldset aria-label="Browse your family" className="kf-workspace-tabs">
					{(
						[
							{ value: "tree", label: "Tree", Icon: GitBranch },
							{ value: "people", label: "People", Icon: Users },
						] as const
					).map(({ value, label, Icon }) => (
						<button
							key={value}
							type="button"
							aria-pressed={screen === value}
							onClick={() => {
								setScreen(value);
								setOptionsOpen(false);
							}}
						>
							<Icon className="size-4" aria-hidden="true" />
							{label}
						</button>
					))}
				</fieldset>
				<div className="kf-toolbar-search">
					{screen === "tree" && (
						<TreeSearch
							nodes={nodes}
							selfId={selfId}
							degree={degree}
							onGoTo={onGoTo}
							focusRef={focusSearch}
						/>
					)}
				</div>
				{picked && selectedTarget?.editable && (
					<button
						type="button"
						className="kf-add-button"
						title={`Add a relative to ${picked.name}`}
						onClick={() => {
							setEditorOpen(false);
							setQuickAddRequest({ id: picked.id, nonce: Date.now() });
						}}
					>
						<Plus className="size-4" aria-hidden="true" />
						Add relative
					</button>
				)}
				<div ref={optionsRef} className="kf-view-options-anchor">
					<button
						type="button"
						aria-label="View options"
						aria-expanded={optionsOpen}
						aria-controls={optionsId}
						className="kf-options-trigger"
						onClick={() => setOptionsOpen(!optionsOpen)}
					>
						<SlidersHorizontal className="size-4" aria-hidden="true" />
						<span>Options</span>
					</button>
					<AnimatePresence>
						{optionsOpen && (
							<motion.div
								id={optionsId}
								initial={{ opacity: 0, y: -6 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -4 }}
								transition={{ duration: 0.18 }}
								className="kf-view-options"
							>
								<div className="flex items-center justify-between">
									<h2>Make yourself at home</h2>
									<button
										type="button"
										aria-label="Close view options"
										className="flex size-11 items-center justify-center text-ink-faint"
										onClick={() => setOptionsOpen(false)}
									>
										<X className="size-4" aria-hidden="true" />
									</button>
								</div>
								{scopeControls && (
									<section>
										<h3>Which connections</h3>
										{scopeControls}
									</section>
								)}
								<section>
									<h3>Arrange the tree</h3>
									<ViewControls
										mode={view}
										onMode={(mode) => {
											setView(mode);
											setScreen("tree");
										}}
										depth={depth}
										onDepth={setDepth}
										canOrbit={Boolean(viewedId)}
									/>
								</section>
								<section>
									<h3>Show each person as</h3>
									<fieldset aria-label="Level of detail" className="kf-options-levels">
										{LEVELS.map(({ value, label, hint, Icon }) => (
											<button
												key={value}
												type="button"
												aria-pressed={lod === value}
												title={hint}
												onClick={() => {
													setLod(value);
													setScreen("tree");
												}}
											>
												<Icon className="size-4" aria-hidden="true" />
												{label}
											</button>
										))}
									</fieldset>
								</section>
								<section className="kf-options-actions">
									{editableTreeId && (
										<button
											type="button"
											onClick={() => {
												setOptionsOpen(false);
												setEditorOpen(true);
											}}
										>
											<Link2 className="size-4" aria-hidden="true" />
											Connect existing people
										</button>
									)}
									<button
										type="button"
										onClick={() => {
											toggleFeed();
											setOptionsOpen(false);
										}}
										aria-pressed={feedVisible}
									>
										<Activity className="size-4" aria-hidden="true" />
										Recent activity
									</button>
									<TreeLegend census={census} lod={lod} hasSelf={Boolean(selfId)} inline />
								</section>
							</motion.div>
						)}
					</AnimatePresence>
				</div>
			</div>
			<div className="relative min-h-0 flex-1">
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
					editableUnions={editableUnions}
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
					directory={
						screen === "people" ? (
							<PeopleDirectory
								nodes={nodes}
								selfId={selfId}
								kinship={kinship}
								selectedId={viewedId}
								detailOpen={detailOpen || feedVisible}
								onSelect={onGoTo}
							/>
						) : undefined
					}
				/>
				<EditorPanel
					key={editorTreeId}
					open={editorOpen}
					onClose={() => setEditorOpen(false)}
					people={pickable}
					unions={editableUnions.filter((union) => union.treeId === editorTreeId)}
					selectedId={selectedTarget?.editable ? selectedTarget.personId : null}
					selectedName={picked?.name}
				/>
				<FeedPanel
					open={feedVisible}
					events={feedEvents}
					kinship={kinship}
					onGoTo={onGoTo}
					onClose={() => setFeedOpen(false)}
				/>
			</div>
		</div>
	);
}
