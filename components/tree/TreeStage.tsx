"use client";

/**
 * The canvas plus its chrome: detail level, search, legend, feed.
 *
 * LOD is client state, deliberately unlike the combined toggle, which lives in
 * `searchParams`: that one changes WHICH DATA is fetched, so a URL round trip is the
 * honest implementation and the resulting view is worth sharing. Detail level changes
 * nothing about the data -- it is how much of each person is drawn -- so a server round
 * trip would buy a shareable link nobody wants at the cost of making a purely visual
 * switch feel like a page load. Social links are the same kind of switch, so they are
 * client state too, mirrored into the URL without a navigation.
 *
 * It lives HERE rather than inside the canvas because the `d` shortcut cycles it and the
 * button group displays it, so the two have to read one value. The canvas is handed the
 * value and a setter.
 */
import {
	Activity,
	GitBranch,
	GitMerge,
	Link2,
	Rows3,
	SlidersHorizontal,
	Square,
	SquareDot,
	Users,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { censusOf } from "@/lib/tree/census";
import { degrees } from "@/lib/tree/density";
import { familyFeed } from "@/lib/tree/feed";
import {
	type FlowEdge,
	type FlowNode,
	type UnionWithChildren,
	visibleEdges,
} from "@/lib/tree/graph";
import type { Kinship } from "@/lib/tree/kinship";
import type { Lod } from "@/lib/tree/layout";
import { feedShown, initialWorkspace, workspace } from "@/lib/tree/workspace";
import { useEscapeClose } from "./escape";
import { FeedPanel } from "./FeedPanel";
import { PeopleDirectory } from "./PeopleDirectory";
import { ScopeToggle } from "./ScopeToggle";
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
	isCombined = true,
	isDemo = false,
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
	 * Its absence hides the `+` handles entirely -- a disabled control would advertise an
	 * action that can never work here. The server re-checks anyway; this only decides
	 * what to draw.
	 */
	editableTreeId?: string | null;
	editableTreeIds?: readonly string[];
	editableUnions?: UnionWithChildren[];
	/** Whether the linked families are drawn with this one; mine-only when false. */
	isCombined?: boolean;
	/** The sample family, whose links must keep `?demo=1` for the SPA to stay on it. */
	isDemo?: boolean;
}) {
	const [lod, setLod] = useState<Lod>("full");
	/*
	 * Social links: what is DRAWN, not what is fetched, so client state. The address bar
	 * follows through `replaceState`, so a reload and a shared link still match the screen
	 * without the navigation that used to refetch the tree, rerun ELK, and lose every fold
	 * and the zoom.
	 */
	const [relationsOn, setRelationsOn] = useState(showRelations);
	const toggleRelations = useCallback(() => {
		const next = !relationsOn;
		setRelationsOn(next);
		const url = new URL(window.location.href);
		if (next) url.searchParams.delete("relations");
		else url.searchParams.set("relations", "0");
		window.history.replaceState(window.history.state, "", url);
	}, [relationsOn]);
	// The other scope is a real navigation, carrying this one along.
	const combinedHref = useMemo(() => {
		const params = new URLSearchParams();
		if (isDemo) params.set("demo", "1");
		if (isCombined) params.set("combined", "0");
		if (!relationsOn) params.set("relations", "0");
		const query = params.toString();
		return query ? `/tree?${query}` : "/tree";
	}, [isCombined, isDemo, relationsOn]);
	const [screen, setScreen] = useState<"tree" | "people">("tree");
	const [optionsOpen, setOptionsOpen] = useState(false);
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
	 * so cards, search, feed, breadcrumbs, the `+` handles and orbit all read this one id.
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
	/*
	 * The workspace as one state machine (lib/tree/workspace.ts): the viewed person, the
	 * profile, the feed, the strip and a travel in flight. Held here, above the provider key,
	 * so a detail-level or arrangement switch rebuilds the canvas without dropping any of it --
	 * the reason the folds and the trail are held above the key too.
	 */
	const [space, dispatch] = useReducer(workspace, defaultViewedId, initialWorkspace);
	const viewedId = space.viewed;
	const changeViewed = useCallback(
		(id: string) => {
			const node = nodes.find((candidate) => candidate.type === "person" && candidate.id === id);
			rememberViewed(node);
			dispatch({ type: "view", id });
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
		dispatch({ type: "view", id: next?.id ?? null });
	}, [defaultViewedNode, nodes, rememberViewed, viewedId]);

	// Who is in the graph now. A profile, an edit strip or a travel about anybody else goes,
	// rather than leaving a closed-looking panel that still hides the feed beneath it.
	const personIds = useMemo(
		() => new Set(nodes.flatMap((node) => (node.type === "person" ? [node.id] : []))),
		[nodes],
	);
	useEffect(() => {
		dispatch({ type: "present", ids: personIds });
	}, [personIds]);
	/**
	 * A list, because a merged person can carry a row in more than one graph the viewer
	 * may write to. Today the view names one; the shape is right for when it names
	 * several, and `editTarget` cannot then be the thing that gets it wrong.
	 *
	 * Memoised because the canvas derives its `+` handles from it: a fresh array literal per
	 * render would recompute them on every click or panel toggle for a graph that had not
	 * changed.
	 */
	const editableTreeIds = useMemo<readonly string[]>(
		() => writableTreeIds ?? (editableTreeId ? [editableTreeId] : []),
		[editableTreeId, writableTreeIds],
	);

	/**
	 * Go to somebody. The request waits in the workspace until the canvas reports that it
	 * arrived, so it completes exactly once: an unacknowledged request used to replay on any
	 * re-run of the travel effect and reopen a panel somebody had just closed.
	 */
	const travel = useCallback(
		(id: string, profile: boolean) => {
			rememberViewed(nodes.find((candidate) => candidate.type === "person" && candidate.id === id));
			dispatch({ type: "travel", id, profile });
		},
		[nodes, rememberViewed],
	);
	// The People directory and the feed are for reading about somebody, so arriving from
	// them opens the profile.
	const onGoTo = useCallback((id: string) => travel(id, true), [travel]);
	// Search finds somebody to work on: it travels and selects, and on an editable canvas the
	// card's own handles take it from there. A read-only canvas has no handles, so reading is
	// the only thing a found person offers there, and their profile opens.
	const canEdit = Boolean(editableTreeId);
	const onFind = useCallback((id: string) => travel(id, !canEdit), [travel, canEdit]);

	/**
	 * The family feed: the record as a stream, derived from the nodes already in memory (see
	 * lib/tree/feed.ts). It shares the profile's rail and is a background surface: it waits
	 * under a profile or a strip and comes back when they close, and pressing Recent activity
	 * always shows it -- whatever covered it closes.
	 */
	const feedEvents = useMemo(() => familyFeed(nodes, edges), [nodes, edges]);
	const feedVisible = feedShown(space);
	// Whether a profile is open. It and the feed take the right-hand rail (the bottom half of a
	// phone), and the People directory makes room beside either rather than sitting under it.
	const detailOpen = space.profile !== null;

	/**
	 * A detail level or an arrangement rebuilds the canvas, which closes the strip: its point
	 * belongs to the old layout. Only on a real change, so pressing the level already shown
	 * does not fold a strip away.
	 */
	const changeLod = useCallback(
		(next: Lod) => {
			if (next === lod) return;
			setLod(next);
			dispatch({ type: "rearranged" });
		},
		[lod],
	);
	const changeView = useCallback(
		(next: ViewMode) => {
			if (next === view) return;
			setView(next);
			dispatch({ type: "rearranged" });
		},
		[view],
	);

	/*
	 * Computed here rather than in each consumer: the canvas draws presence rings from it
	 * and search ranks namesakes by it, and doing it twice over 151 nodes on every render
	 * would be the same work for the same answer.
	 *
	 * From the VISIBLE edges, so a ring never claims a connection whose line the viewer
	 * has switched off.
	 */
	const drawn = useMemo(() => visibleEdges(edges, relationsOn), [edges, relationsOn]);
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
								// The directory covers the canvas: a strip left open would float over it,
								// anchored to a card nobody can see, and still accept a save.
								if (value === "people") dispatch({ type: "closeStrip" });
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
							onGoTo={onFind}
							focusRef={focusSearch}
						/>
					)}
				</div>
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
										className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-raised hover:text-ink"
										onClick={() => setOptionsOpen(false)}
									>
										<X className="size-4" strokeWidth={1.75} aria-hidden="true" />
									</button>
								</div>
								<section>
									<h3>Which connections</h3>
									<div className="grid grid-cols-2 gap-2">
										<ScopeToggle
											onToggle={toggleRelations}
											active={relationsOn}
											label="Social links"
											hint={relationsOn ? "Hide social connections" : "Show social connections"}
											Icon={Link2}
										/>
										<ScopeToggle
											href={combinedHref}
											active={isCombined}
											label={isCombined ? "All trees" : "My tree"}
											hint={
												isCombined
													? "Show only your own family tree"
													: "Show every family tree shared with you"
											}
											Icon={GitMerge}
										/>
									</div>
								</section>
								<section>
									<h3>Arrange the tree</h3>
									<ViewControls
										mode={view}
										onMode={(mode) => {
											changeView(mode);
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
													changeLod(value);
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
									<button
										type="button"
										onClick={() => {
											dispatch({ type: "toggleFeed" });
											setOptionsOpen(false);
										}}
										aria-pressed={feedVisible}
									>
										<Activity className="size-4" aria-hidden="true" />
										Recent activity
									</button>
									<TreeLegend census={census} lod={lod} hasSelf={Boolean(selfId)} />
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
					workspace={space}
					dispatch={dispatch}
					onViewedChange={changeViewed}
					onTravel={travel}
					lod={lod}
					onLodChange={changeLod}
					view={view}
					depth={depth}
					canEdit={canEdit}
					editableTreeIds={editableTreeIds}
					editableUnions={editableUnions}
					degree={degree}
					kinship={kinship}
					showRelations={relationsOn}
					onFocusSearch={onFocusSearch}
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
				<FeedPanel
					open={feedVisible}
					events={feedEvents}
					kinship={kinship}
					onGoTo={onGoTo}
					onClose={() => dispatch({ type: "closeFeed" })}
				/>
			</div>
		</div>
	);
}
