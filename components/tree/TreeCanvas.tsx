"use client";

/**
 * The canvas. Owns layout-on-data-change, focus, collapse and framing; all graph maths
 * lives in lib/tree so it stays testable without a browser.
 *
 * ## The one architectural rule in this file
 *
 * The layout effect depends on `familyFlowEdges`, and ELK is expensive. So anything that
 * changes on HOVER must never reach that memo. Three separate mechanisms exist purely to
 * honour that:
 *
 *   - Focus is applied in its own effect that rewrites `className` and nothing else.
 *   - The edge array is SPLIT: family edges are state written once per layout, revealed
 *     relations are a memo, and what React Flow renders is a third memo merging them.
 *   - Framing keys off `layoutEpoch`, a counter bumped once per completed layout, rather
 *     than off `nodes` -- whose identity changes on every mouse move.
 *
 * Break any of those and the symptom is the same: ELK re-runs for the whole graph as the
 * pointer crosses a card.
 */
import {
	Background,
	BackgroundVariant,
	Controls,
	type Edge,
	type Node,
	Panel,
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesInitialized,
	useNodesState,
	useReactFlow,
	useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Crosshair, Maximize2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyScheme, resolveScheme, THEME_ATTR, THEME_KEY } from "@/lib/theme";
import {
	type Collapsed,
	collapseGeneration,
	foldable,
	hiddenCounts,
	isCollapsed,
	NOTHING_COLLAPSED,
	toggleCollapse,
	visibleAfterCollapse,
} from "@/lib/tree/collapse";
import type { Degree } from "@/lib/tree/density";
import { editTarget } from "@/lib/tree/editable";
import {
	displayName,
	type FlowEdge,
	type FlowNode,
	type FusedPerson,
	lifespan,
	type UnionWithChildren,
	visibleEdges,
} from "@/lib/tree/graph";
import type { Kinship } from "@/lib/tree/kinship";
import {
	type Box,
	type GenerationBand,
	type Lod,
	layoutGraph,
	NODE_METRICS,
} from "@/lib/tree/layout";
import { neighbourhood } from "@/lib/tree/neighbourhood";
import { type OverviewNode, overviewNodes } from "@/lib/tree/overview";
import { collapseUnionEdges, radialLayout } from "@/lib/tree/radial";
import { indexRelatives } from "@/lib/tree/relatives";
import { type SiblingBar, siblingBars } from "@/lib/tree/siblings";
import { cn } from "@/lib/utils";
import { FamilyEdge } from "./FamilyEdge";
import { GenerationRails } from "./GenerationRails";
import { PersonDetail } from "./PersonDetail";
import { PersonNode, UnionNode } from "./PersonNode";
import { QuickAddSheet } from "./QuickAdd";
import { pushTrail, TreeBreadcrumbs } from "./TreeBreadcrumbs";
import { TreeMinimap } from "./TreeMinimap";
import { type ShortcutAction, ShortcutSheet, useShortcuts } from "./TreeShortcuts";
import { OfflineNotice, TreeError, TreeLoading } from "./TreeStates";
import type { ViewMode } from "./ViewControls";

const nodeTypes = { person: PersonNode, union: UnionNode };
const edgeTypes = { family: FamilyEdge };

/**
 * Per-generation entrance delay.
 *
 * Cards fade in oldest row first, so the tree assembles downwards the way it is read.
 * Staggering by generation rather than by node index is what makes it look like
 * structure appearing instead of a list loading.
 */
const ROW_STAGGER_MS = 70;
/** Ceiling on the stagger: a deep tree must not take a second to appear. */
const MAX_STAGGER_MS = 420;

/**
 * Zoom below which each level of detail stops being worth reading.
 *
 * Framing refuses to fit the whole tree under this floor: a whole tree rendered too
 * small to read is strictly worse than the part of one you can.
 *
 * The floor VARIES because what "legible" means varies. A card's 11px metadata dies
 * around 0.55. A dot has no text at all, so the only question is whether it is still a
 * visible mark -- and at 0.18 a 16px node is a ~3px dot, exactly the density a
 * 117-person overview needs. Holding dots to the card's floor would refuse to ever fit
 * the tree they exist to show.
 */
const LEGIBLE_ZOOM: Record<Lod, number> = {
	full: 0.55,
	compact: 0.45,
	/*
	 * 0.42, raised from 0.18, because a dot now carries a name.
	 *
	 * 0.18 was correct while this level was a bare mark: the only question was whether a 16px
	 * node was still a visible dot, and at 0.18 it is ~3px, which is exactly the density a
	 * 117-person overview wants. A 9px label at 0.18 is 1.6px of text -- present in the DOM and
	 * unreadable, which is worse than no label because it looks like a rendering fault. At 0.42
	 * the label is ~3.8px, small but resolvable, and the whole sample tree still fits.
	 */
	dot: 0.42,
};

/** Named, because the legibility guard has to use the same numbers the canvas does. */
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 1.8;

/** Breathing room round a fit, as React Flow's own fraction-of-viewport padding. */
const FIT_PADDING = 0.2;
/** More, for a household: a few cards centred in a bare viewport reads as an error. */
const HOUSEHOLD_PADDING = 0.3;

/** Detail levels, in the order `d` cycles them. */
const LOD_CYCLE: Lod[] = ["full", "compact", "dot"];

/**
 * How much viewport a fit actually gets, once padding is taken out.
 *
 * Reproduces `parsePadding` from @xyflow/system exactly, including the floor and the
 * doubling for both sides. Without it the legibility guard divides by the RAW viewport
 * while `fitView` divides by the padded one, so the guard overestimates the zoom by the
 * padding factor -- 1.2x here -- and waves through fits that render below the floor it
 * exists to enforce. Worst on a phone, where padding is the largest share.
 */
function usable(viewport: number, padding: number): number {
	return viewport - Math.floor((viewport - viewport / (1 + padding)) * 0.5) * 2;
}

/**
 * Which generation a y coordinate belongs to, for the entrance stagger.
 *
 * NEAREST band rather than exact match, because a union dot sits between two rows and
 * belongs to neither. Keying on equality would give every dot delay 0, and they would
 * all pop in ahead of the couples they join.
 */
function rowFor(y: number, bands: GenerationBand[]): number {
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const [index, band] of bands.entries()) {
		const distance = Math.abs(band.top - y);
		if (distance < bestDistance) {
			best = index;
			bestDistance = distance;
		}
	}

	return best;
}

/**
 * Is the pointer a finger?
 *
 * Read in an effect rather than during render: the server has no `matchMedia`, and
 * guessing would make the first client paint disagree with the markup it hydrates.
 * Starting false is the safe default -- a mouse gets the richer behaviour, and a phone
 * loses it for one frame.
 */
function useCoarsePointer(): boolean {
	const [coarse, setCoarse] = useState(false);

	useEffect(() => {
		const query = window.matchMedia("(pointer: coarse)");
		setCoarse(query.matches);
		// Subscribed, not sampled once: a tablet with a keyboard attached switches pointer
		// type without a reload.
		const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	return coarse;
}

/**
 * The unions in a projected graph, for the sibling-bar pass.
 *
 * Read back off the union NODES rather than passed alongside them: a union node already
 * carries its own row, so a second prop would be the same data arriving twice with no
 * guarantee the two agree.
 */
function unionsOf(nodes: FlowNode[]): UnionWithChildren[] {
	return nodes.filter((node) => node.type === "union").map((node) => node.data.union);
}

/** Add or remove one class, preserving whatever else is on the element. */
function withFlag(flag: string, className: string | undefined, on: boolean): string {
	const classes = (className ?? "").split(" ").filter((c) => c && c !== flag);
	if (on) classes.push(flag);
	return classes.join(" ");
}

type Props = {
	nodes: FlowNode[];
	/**
	 * EVERY edge, including relations the viewer has switched off.
	 *
	 * Layout needs them even when they are not drawn: `anchorFamilylessNodes()` finds a
	 * person with no family by following who they know, so filtering them out here would
	 * put those people in ELK's first layer and invent a generation above the oldest
	 * ancestor. `showRelations` decides what is DRAWN, nothing more.
	 */
	edges: FlowEdge[];
	showRelations?: boolean;
	selfId?: string;
	lod?: Lod;
	/** Cycled by the `d` shortcut, so the control lives in the parent but the key is here. */
	onLodChange?: (lod: Lod) => void;
	/**
	 * Which arrangement to lay the graph out in.
	 *
	 * `tree` is ELK's layered pedigree; `orbit` puts one person at the centre with everybody
	 * else on rings by hop distance. Both consume the same nodes and edges, so switching is a
	 * relayout rather than a different canvas.
	 */
	view?: ViewMode;
	/** Tilts the CARDS into depth. Never the pane -- see the `.kf-depth` rules. */
	depth?: boolean;
	/**
	 * Whether this viewer may write, which decides if the per-card `+` is drawn at all.
	 *
	 * A rendering hint only: `addRelative` re-checks permission server-side, because a value
	 * that reached the client is a value the client can change.
	 */
	canEdit?: boolean;
	/**
	 * Trees this viewer may WRITE to, in preference order.
	 *
	 * A list rather than the view's single `editableTreeId`, because a merged person can carry
	 * a row in more than one graph a viewer holds a grant on -- and `editTarget` needs to pick
	 * the right source row rather than the fused id, which is the smallest member id and lands
	 * on the far family's row about half the time.
	 */
	editableTreeIds?: readonly string[];
	/**
	 * A person to travel to, set by search. An object rather than a bare id so asking for
	 * the SAME person twice still moves: after panning away, searching the name you just
	 * searched has to bring you back, and a plain string would compare equal.
	 */
	goTo?: { id: string } | null;
	/** How connected each person is. Passed in because search ranks by it too. */
	degree: Map<string, Degree>;
	/** What each person is to the viewer. Computed server-side: it needs the whole graph. */
	kinship?: Map<string, Kinship>;
	/** Focus the search box, for the `/` shortcut. */
	onFocusSearch?: () => void;
	/** Called with the clicked person, so the editor can pre-fill its "from" field. */
	onPick?: (person: { id: string; name: string } | null) => void;
	/** Opens relationship-first add for a selected fused person. */
	quickAddRequest?: { id: string; nonce: number } | null;
	/** Clears the request after the canvas has resolved its editable source row. */
	onQuickAddHandled?: () => void;
};

function Canvas({
	nodes: sourceNodes,
	edges: sourceEdges,
	showRelations = true,
	selfId,
	lod = "full",
	onLodChange,
	view = "tree",
	depth = false,
	canEdit = false,
	editableTreeIds = [],
	goTo,
	degree,
	kinship,
	onFocusSearch,
	onPick,
	quickAddRequest,
	onQuickAddHandled,
}: Props) {
	const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
	/**
	 * The laid-out family skeleton, written once per layout.
	 *
	 * Held apart from the revealed relations because the two change on completely
	 * different clocks: this one when the DATA or the detail level changes (which re-runs
	 * ELK), the relations on every hover. One array for both would mean either re-running
	 * layout on mouse move or rebuilding 150 skeleton edges to add three.
	 */
	const [familyEdges, setFamilyEdges, onEdgesChange] = useEdgesState<Edge>([]);
	const [bands, setBands] = useState<GenerationBand[]>([]);
	/**
	 * The box the laid-out tree occupies, for the minimap to shape itself to.
	 *
	 * From the layout rather than `getNodesBounds`: this has to be right on the FIRST
	 * render of the panel, and React Flow's bounds are only correct once every node has
	 * been measured -- which is the frame after.
	 */
	const [extent, setExtent] = useState<Box>({
		x: 0,
		y: 0,
		width: 0,
		height: 0,
	});
	const [overview, setOverview] = useState<OverviewNode[]>([]);
	/**
	 * Bumped once per completed layout, and the only thing framing keys off.
	 *
	 * Deliberately not `nodes`: focus rewrites className via setNodes, so that array gets
	 * a new identity on every mouse move. Framing on it refits mid-hover, throwing away
	 * the zoom the viewer chose -- and the resulting pan slides the card out from under
	 * the cursor, firing mouseleave and cancelling the focus that caused it.
	 */
	const [layoutEpoch, setLayoutEpoch] = useState(0);
	const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
	/** Bumped by the retry button, to re-run a layout that threw. */
	const [attempt, setAttempt] = useState(0);
	/**
	 * The epoch already framed, so each layout is framed exactly once.
	 *
	 * The dependency array cannot express this alone. Framing needs the viewport size and
	 * `frameSelf` closes over it, so BOTH the raw dimensions and the callback's identity
	 * change on every resize -- and on a phone the URL bar collapsing is a resize,
	 * mid-gesture. Measured: zoomed to 0.95, changed height by 22px, and the viewport
	 * snapped back to the opening 0.66.
	 */
	const framedEpoch = useRef(0);
	// `getNodesBounds` from the hook, not the standalone export: the bare function has no
	// node lookup, cannot handle sub-flows, and warns on every call.
	const { fitView, getNodesBounds, getNodes, setCenter, getZoom, zoomIn, zoomOut } = useReactFlow();

	// True only once React Flow has measured every node, which it cannot do while the
	// container is 0x0 (hidden tab, pane not yet laid out). Framing on rAF instead would
	// silently no-op in that window and never retry.
	const measured = useNodesInitialized();

	// Container size from the store rather than measured here: framing has to know whether
	// the tree fits BEFORE deciding how to frame, and subscribing means a rotated phone
	// reframes.
	const viewportWidth = useStore((state) => state.width);
	const viewportHeight = useStore((state) => state.height);

	/**
	 * The live zoom, published to CSS as `--kf-zoom` on the pane.
	 *
	 * Every node is inside the scaled viewport, so a control sized in CSS pixels is NOT
	 * that size on screen: a `size-11` (44px) fold button measured 35px at 0.785 zoom and
	 * would be 7px at the 0.15 floor. A touch target has to clear 44 SCREEN pixels, so the
	 * only honest way to size one inside a transformed layer is to divide by the scale it
	 * is about to be multiplied by -- which means CSS needs the number.
	 *
	 * Written as a custom property rather than passed as a prop, for the reason the pointer
	 * wash is: a prop would re-render all 117 nodes on every wheel tick, and React Flow
	 * answers a render by re-measuring.
	 */
	const zoom = useStore((state) => state.transform[2]);

	useEffect(() => {
		// On the viewport itself, which is the element the nodes live inside, so the value is
		// in scope for every card without threading a ref through ReactFlow (which does not
		// forward one).
		const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
		viewport?.style.setProperty("--kf-zoom", String(zoom));
	}, [zoom]);

	/**
	 * The person whose relations are lit. Relation edges cannot be hovered themselves:
	 * they render above the cards so their labels stay readable, which means they must not
	 * intercept pointer events.
	 */
	const [focusedId, setFocusedId] = useState<string | null>(null);
	/**
	 * The person whose relations are PINNED, set by clicking a card.
	 *
	 * Separate from `focusedId` because hover is a glance and a click is a decision: a
	 * hover reveal vanishes the moment you move towards the line you wanted to read,
	 * which on a canvas this wide makes a long relation impossible to follow. On a phone
	 * there is no hover at all, so this is the ONLY way relations appear.
	 */
	const [pinnedId, setPinnedId] = useState<string | null>(null);
	/** Whose detail panel is open. Separate from the pin: closing the panel keeps the pin. */
	const [detailId, setDetailId] = useState<string | null>(null);
	const [trail, setTrail] = useState<string[]>([]);
	const [helpOpen, setHelpOpen] = useState(false);
	/**
	 * Whose quick-add sheet is open.
	 *
	 * Holds the NAME as well as the id so the sheet can say whose relative it is adding
	 * without looking the person back up -- a form headed "Add father" with no name attached
	 * is how a father gets recorded against the wrong person.
	 */
	const [quickAdd, setQuickAdd] = useState<{ id: string; name: string } | null>(null);
	/** Set when a `+` is pressed on a person no source row of which the viewer may edit. */
	const [quickAddRefusal, setQuickAddRefusal] = useState<string | null>(null);
	// Refreshing the server route after a write is what keeps fusion, kinship and the layout
	// derived from the database rather than from a client-side guess about what changed.
	const router = useRouter();
	const [collapsed, setCollapsed] = useState<Collapsed>(NOTHING_COLLAPSED);

	// Cards are draggable with a mouse and not with a finger. On a phone a card is most of
	// the screen, so a swipe that starts on one has to pan the canvas.
	const coarsePointer = useCoarsePointer();

	/**
	 * The viewer's immediate family, for framing when the tree cannot fit legibly.
	 *
	 * FAMILY edges only. Traversing social edges too would drag in a friend of a friend on
	 * the far side of the canvas, and the "immediate family" box would span the whole tree
	 * -- the very thing this fallback exists to avoid.
	 */
	const homeIds = useMemo(() => {
		if (!selfId) return null;
		const unionIds = new Set(sourceNodes.filter((n) => n.type === "union").map((n) => n.id));
		const family = sourceEdges.filter((edge) => edge.layout);
		return neighbourhood(family, selfId, (id) => unionIds.has(id)).nodeIds;
	}, [selfId, sourceNodes, sourceEdges]);

	/**
	 * The edges the viewer has ENABLED, which is neither what layout gets nor what is
	 * drawn. `layoutGraph` keeps reading `sourceEdges`, so toggling the overlay changes
	 * what you see without moving a single card.
	 */
	const enabledEdges = useMemo(
		() => visibleEdges(sourceEdges, showRelations),
		[sourceEdges, showRelations],
	);

	/**
	 * Which people survive the current folds.
	 *
	 * The viewer and every collapsed node are anchors, so a fold can never strand the
	 * canvas: collapsing your own ancestors must leave you on screen rather than emptying
	 * the graph. See lib/tree/collapse.ts for why this is reachability and not
	 * subtraction.
	 */
	const visibleIds = useMemo(
		() =>
			visibleAfterCollapse(sourceNodes, sourceEdges, collapsed, [
				...(selfId ? [selfId] : []),
				...collapsed.descendants,
				...collapsed.ancestors,
			]),
		[sourceNodes, sourceEdges, collapsed, selfId],
	);

	/** The graph actually laid out: everything, unless something is folded. */
	const laidOutNodes = useMemo(
		() => (isCollapsed(collapsed) ? sourceNodes.filter((n) => visibleIds.has(n.id)) : sourceNodes),
		[sourceNodes, collapsed, visibleIds],
	);

	const foldedEdges = useMemo(
		() =>
			isCollapsed(collapsed)
				? sourceEdges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
				: sourceEdges,
		[sourceEdges, collapsed, visibleIds],
	);

	/**
	 * The edges the arrangement gets.
	 *
	 * In orbit the junctions are not drawn, so `partner` and `child` edges pointing at them
	 * would dangle -- they are rewritten person-to-person instead. The tree keeps the junction
	 * form, because there the dot IS the shape that makes siblings read as one family.
	 */
	const laidOutEdges = useMemo(
		() => (view === "orbit" ? collapseUnionEdges(laidOutNodes, foldedEdges) : foldedEdges),
		[view, laidOutNodes, foldedEdges],
	);

	/**
	 * Who the orbit is centred on: the PINNED person, else the viewer.
	 *
	 * Pinned rather than hovered, deliberately. Hover would re-centre the entire arrangement
	 * as the pointer crossed the canvas -- every card flying to a new ring on each mouse move
	 * -- and re-running the layout on hover is the exact trap the split edge arrays exist to
	 * avoid. A click is a decision, which is what choosing a centre should be.
	 *
	 * Collapsed to NULL outside orbit mode, and that is load-bearing rather than tidy. The
	 * layout effect lists this in its dependencies, and a dependency array re-runs on a new
	 * VALUE regardless of which branch reads it -- so a live `pinnedId` here would re-run ELK
	 * for the whole graph on every card click in tree mode. Gating the value rather than the
	 * read is what keeps clicking a card cheap.
	 */
	const orbitFocusId = view === "orbit" ? (pinnedId ?? selfId ?? null) : null;

	const folds = useMemo(() => foldable(sourceEdges), [sourceEdges]);
	const hidden = useMemo(
		() => hiddenCounts(sourceNodes, sourceEdges, collapsed),
		[sourceNodes, sourceEdges, collapsed],
	);

	/** For the detail panel, which needs roles rather than a highlight set. */
	const relativeIndex = useMemo(
		() => indexRelatives(sourceNodes, enabledEdges),
		[sourceNodes, enabledEdges],
	);

	const people = useMemo(() => {
		const byId = new Map<string, FusedPerson>();
		for (const node of sourceNodes) if (node.type === "person") byId.set(node.id, node.data);
		return byId;
	}, [sourceNodes]);

	/** Whose relations are revealed: the pinned person, else the hovered one. */
	const revealedId = pinnedId ?? focusedId;

	const fold = useCallback((personId: string, direction: "descendants" | "ancestors") => {
		setCollapsed((current) => toggleCollapse(current, personId, direction));
	}, []);

	/**
	 * Open quick-add against the SOURCE row this viewer may write to.
	 *
	 * The `+` used to pass the fused id, which is the same defect the edit form had: the fused
	 * id is the smallest member id, so on a person recorded by two families it belongs to the
	 * other family about half the time -- and `addRelative` would refuse with "you do not have
	 * permission to change this graph" about somebody's own grandmother. `editTarget` resolves
	 * it; a genuine refusal is surfaced instead of a sheet that cannot save.
	 */
	const openQuickAdd = useCallback(
		(person: FusedPerson) => {
			const target = editTarget(person, editableTreeIds);
			if (!target.editable) {
				setQuickAddRefusal(target.reason);
				return;
			}
			setQuickAddRefusal(null);
			setQuickAdd({ id: target.personId, name: displayName(person.primary) });
		},
		[editableTreeIds],
	);

	useEffect(() => {
		if (!quickAddRequest) return;
		const person = people.get(quickAddRequest.id);
		if (person) openQuickAdd(person);
		onQuickAddHandled?.();
	}, [quickAddRequest, people, openQuickAdd, onQuickAddHandled]);

	/**
	 * The relation edges to actually DRAW -- only those touching the revealed person.
	 *
	 * Measured on the sample graph before this: the 52 relation edges were 73% of all edge
	 * ink at a median span of 2214px, against the family skeleton's median of 69px -- 32x.
	 * And the data is sparse: the median person has ONE relation and 56 of 120 have none.
	 * Fifty-two lines crossing the canvas was the haze the cards sat in, and no colour or
	 * weight could fix it, because the problem was that they were drawn at all,
	 * permanently, for a property almost nobody has.
	 */
	const revealedRelations = useMemo(() => {
		if (!revealedId) return [];
		// From `enabledEdges`, so the overlay toggle is honoured by construction rather than
		// by a second boolean in the predicate -- and intersected with the folded set, since
		// a relation to somebody who is not currently drawn has no far end to reach.
		return enabledEdges.filter(
			(edge) =>
				edge.kind === "relation" &&
				(edge.source === revealedId || edge.target === revealedId) &&
				visibleIds.has(edge.source) &&
				visibleIds.has(edge.target),
		);
	}, [enabledEdges, revealedId, visibleIds]);

	/**
	 * The FAMILY skeleton as React Flow edges, and the only edge memo layout may depend on.
	 *
	 * From the enabled set, NOT the revealed one: the latter narrows with the hovered
	 * person, so depending on it here would give this memo a new identity on every mouse
	 * move -- and ELK would re-run for the entire graph each time the pointer crossed a
	 * card.
	 */
	const familyFlowEdges = useMemo<Edge[]>(
		() =>
			laidOutEdges
				.filter((edge) => edge.kind !== "relation")
				.map((edge) => ({
					id: edge.id,
					source: edge.source,
					target: edge.target,
					// Our own type, purely so the path can carry pathLength={1} for the draw-on
					// animation. Same route smoothstep produces.
					type: "family",
					className: edge.kind === "partner" ? "is-partner" : undefined,
				})),
		[laidOutEdges],
	);

	/** The revealed relations as React Flow edges: at most a handful, not the overlay. */
	const relationFlowEdges = useMemo<Edge[]>(
		() =>
			revealedRelations.map((edge) => ({
				id: edge.id,
				source: edge.source,
				target: edge.target,
				// "default" IS React Flow's bezier renderer -- there is no edge type named
				// "bezier", and asking for one silently falls back to this same renderer while
				// logging a warning on every edge.
				type: "default",
				label: edge.label,
				// Otherwise React Flow announces the literal "Edge from <id> to <id>", reading
				// fused ids aloud. The label is the fact.
				ariaLabel: edge.label,
				className: [
					"is-relation",
					`is-${edge.relationKind}`,
					`is-close-${edge.closeness ?? 1}`,
					edge.ended ? "is-ended" : "",
					// Direction is a TAPERED stroke, not an arrowhead. A class rather than a
					// `markerEnd` so the state stays in the cascade with the edge's other five.
					edge.directed ? "is-directed" : "",
					"kf-reveal",
				]
					.filter(Boolean)
					.join(" "),
				// Above the cards, because a label pinned to a curve's midpoint otherwise gets
				// painted over by whatever card it passes behind.
				zIndex: 1001,
			})),
		[revealedRelations],
	);

	useEffect(() => {
		let cancelled = false;
		setPhase((current) => (current === "error" ? "loading" : current));

		// `attempt` is read here for its VALUE ONLY so the retry button can re-run a layout
		// whose inputs have not changed. Biome flags it as an unnecessary dependency, which
		// is correct about the data flow and wrong about the intent: without it a failed
		// layout can never be retried, since every other dependency is identical the second
		// time. Reading it in the body is what makes the dependency honest rather than a
		// lint suppression on the array.
		void attempt;

		/*
		 * One of two arrangements, producing the same shape.
		 *
		 * Orbit is synchronous (it is trigonometry, not a solver) but is wrapped in a resolved
		 * promise so this effect has ONE code path -- the alternative is duplicating the
		 * ~80 lines of node/edge construction below per mode, which is how the two would drift.
		 *
		 * It emits no generation bands, and that is correct rather than missing: a ring is not
		 * a generation, so drawing the rails over an orbit would label circles with numerals
		 * that mean nothing.
		 */
		const arranged =
			view === "orbit" && orbitFocusId
				? Promise.resolve({
						...radialLayout(laidOutNodes, laidOutEdges, orbitFocusId, lod),
						bands: [] as GenerationBand[],
					})
				: layoutGraph(laidOutNodes, laidOutEdges, lod);

		// ELK is async and imported lazily, so a fast second data change can resolve out of
		// order. The flag drops stale layouts.
		arranged
			.then(({ nodes: positioned, bands: rows, extent: box }) => {
				if (cancelled) return;

				/** Entrance delay per node id, reused below to time the edges. */
				const delays = new Map<string, number>();
				for (const node of positioned) {
					delays.set(
						node.id,
						Math.min(rowFor(node.position.y, rows) * ROW_STAGGER_MS, MAX_STAGGER_MS),
					);
				}

				/**
				 * What the arrangement actually placed.
				 *
				 * The layered layout places every node it is handed, so this is the whole set. The
				 * orbit does not: it cuts past `MAX_RINGS` and drops anyone with no path to the
				 * focus, so an edge to one of those would render as a line reaching off to a node
				 * that is not there. Filtering on the RESULT rather than on the input is what keeps
				 * the two arrangements substitutable.
				 */
				const placedIds = new Set(positioned.map((node) => node.id));

				setNodes(
					positioned.map((node) => ({
						id: node.id,
						type: node.type,
						position: node.position,
						data:
							node.type === "person"
								? {
										...node.data,
										isSelf: node.data.sources.some((s) => s.id === selfId),
										degree: degree.get(node.id),
										kinship: kinship?.get(node.id),
										lod,
										folds: folds.get(node.id),
										collapsed: {
											down: collapsed.descendants.has(node.id),
											up: collapsed.ancestors.has(node.id),
										},
										hidden: hidden.get(node.id),
										onFold: fold,
										// Absent on a read-only canvas, which is what hides the `+` entirely
										// rather than drawing one that cannot do anything.
										onQuickAdd: canEdit ? openQuickAdd : undefined,
									}
								: node.data,
						// Name, relationship and dates, which is what the card shows. Never a
						// contact value: an accessible name is MORE exposed than the visible card,
						// so it must not become the back door PersonNode refuses to be.
						...(node.type === "person"
							? {
									ariaLabel: [
										displayName(node.data.primary),
										kinship?.get(node.id)?.label,
										lifespan(node.data.primary),
									]
										.filter(Boolean)
										.join(", "),
								}
							: // A junction is not a destination, so it is not a tab stop.
								{ focusable: false }),
						// Union dots are structural; dragging them would desync the layout from the
						// data. Nothing is draggable by finger, so a swipe from anywhere pans.
						draggable: node.type === "person" && !coarsePointer,
						// The animation itself is CSS (see globals.css); React Flow owns the node's
						// transform, so a JS-driven entrance would fight it.
						// `kf-depth` tilts the CARD, never the pane: React Flow owns the wrapper's
						// transform for positioning, so a pane-level rotateX would leave the layout
						// and the picture disagreeing about where every node is.
						className: depth ? "kf-enter kf-depth" : "kf-enter",
						style: {
							"--kf-delay": `${delays.get(node.id) ?? 0}ms`,
						} as CSSProperties,
					})),
				);

				/**
				 * Sibling bars, and which child edge of each family draws the horizontal run.
				 *
				 * Skipped entirely in orbit mode: a bar is a horizontal bracket in a generation
				 * gap, and an orbit has neither. Computing them anyway would hand every edge bar
				 * coordinates from a coordinate space the nodes are no longer in.
				 *
				 * The election is by lowest edge id rather than by position, so it is stable
				 * across relayouts: picking the leftmost child would hand the bar to a different
				 * edge whenever ELK reorders siblings, restarting the draw-on animation on an
				 * edge that had not changed.
				 */
				const orbiting = view === "orbit" && Boolean(orbitFocusId);
				const bars: Map<string, SiblingBar> = orbiting
					? new Map()
					: siblingBars(unionsOf(laidOutNodes), positioned);

				/**
				 * The centre of every union dot, for edges to terminate on.
				 *
				 * React Flow hands an edge its HANDLE positions, and it offsets handles outward from
				 * the node box -- so on a 12x12 junction a partner edge stopped 9px above the dot and
				 * the child edge began 9px below it, leaving an 18px gap with the dot floating in the
				 * middle (measured: 173 and 191 against a centre of 182). The edge cannot fix that
				 * from inside, because by then its coordinates ARE the handle positions.
				 */
				const hubs = new Map<string, { x: number; y: number }>();
				for (const node of positioned) {
					if (node.type !== "union") continue;
					hubs.set(node.id, {
						x: node.position.x + node.width / 2,
						y: node.position.y + node.height / 2,
					});
				}

				const barDrawer = new Map<string, string>();
				for (const edge of familyFlowEdges) {
					if (!bars.has(edge.source)) continue;
					const current = barDrawer.get(edge.source);
					if (!current || edge.id < current) barDrawer.set(edge.source, edge.id);
				}

				// Each family edge draws itself on just after the node it descends FROM has
				// landed, so the skeleton grows downwards with the cards rather than waiting.
				setFamilyEdges(
					familyFlowEdges
						// Both ends must have been placed, or the edge is a line to nowhere. Only the
						// orbit can drop a node, so in tree mode this passes everything through.
						.filter((edge) => placedIds.has(edge.source) && placedIds.has(edge.target))
						.map((edge) => {
							const delay = (delays.get(edge.source) ?? 0) + ROW_STAGGER_MS;
							const bar = bars.get(edge.source);
							// Whichever end is a junction anchors on the dot's centre, closing the gap.
							// Undefined for a person, so the edge keeps its handle position there.
							const anchor = {
								sourceHub: hubs.get(edge.source),
								targetHub: hubs.get(edge.target),
							};
							return {
								...edge,
								// The arrangement has to reach the edge component, because a pedigree's
								// router is actively wrong on rings -- see OrbitEdgeData.
								...(orbiting
									? { data: { orbit: true, ...anchor } }
									: bar
										? {
												data: {
													barY: bar.y,
													barLeft: bar.left,
													barRight: bar.right,
													drawsBar: barDrawer.get(edge.source) === edge.id,
													...anchor,
												},
											}
										: { data: anchor }),
								className: withFlag("kf-draw", edge.className, true),
								style: {
									...edge.style,
									"--kf-delay": `${delay}ms`,
								} as CSSProperties,
							};
						}),
				);
				setBands(rows);
				setExtent(box);
				setOverview(overviewNodes(positioned, selfId));
				setLayoutEpoch((epoch) => epoch + 1);
				setPhase("ready");
			})
			.catch(() => {
				// ELK is a lazy dynamic import, so the realistic failure is a dropped connection
				// on first layout -- which a retry fixes without a reload. Swallowing it would
				// leave the canvas on "Arranging the graph" forever.
				if (!cancelled) setPhase("error");
			});

		return () => {
			cancelled = true;
		};
	}, [
		laidOutNodes,
		laidOutEdges,
		// The FAMILY edges only. Depending on the relation memo here would re-run ELK on
		// every hover.
		familyFlowEdges,
		selfId,
		lod,
		view,
		depth,
		// Null outside orbit mode by construction, so a click in tree mode cannot re-run ELK.
		orbitFocusId,
		degree,
		kinship,
		folds,
		hidden,
		collapsed,
		fold,
		coarsePointer,
		canEdit,
		openQuickAdd,
		attempt,
		setNodes,
		setFamilyEdges,
	]);

	/**
	 * Put the viewer's own household on screen at a readable zoom.
	 *
	 * Extracted so the "You" button re-runs exactly what the first frame did. Two
	 * implementations of "where am I" would drift, and the whole value of the button is
	 * that it returns you to a known view.
	 */
	const frameSelf = useCallback(() => {
		const current = getNodes();
		const anchor = current.find((node) => (node.data as { isSelf?: boolean }).isSelf) ?? current[0];
		if (!anchor) return;

		/*
		 * Their household rather than their card alone -- a single card centred in an empty
		 * viewport says nothing about where you are, whereas parents, partner and children
		 * are the answer to "who is this".
		 *
		 * But fitting the household's BOUNDS is not the same as showing the household. ELK
		 * places a large sibship above its own descendant subtrees, so the box round a
		 * person's parents and siblings can span most of the canvas: measured, 52 of 117
		 * people have a household wider than a phone can render legibly.
		 */
		const household = current.filter((node) => homeIds?.has(node.id));
		if (household.length > 1) {
			const bounds = getNodesBounds(household);
			const householdZoom = Math.min(
				usable(viewportWidth, HOUSEHOLD_PADDING) / (bounds.width || 1),
				usable(viewportHeight, HOUSEHOLD_PADDING) / (bounds.height || 1),
			);

			if (householdZoom >= LEGIBLE_ZOOM[lod]) {
				// Capped at 1:1. `fitView` scales UP to fill, so a household of five on a
				// 1440px screen opened at 1.72x -- five cards magnified past the size they were
				// designed at, with 146 relatives off screen.
				void fitView({
					padding: HOUSEHOLD_PADDING,
					duration: 400,
					nodes: household,
					maxZoom: 1,
				});
				return;
			}

			// The metrics rather than 0 as the fallback: an unmeasured node would centre on
			// the card's top-left corner and put the person half a card off-centre.
			const metrics = NODE_METRICS[lod];
			void setCenter(
				anchor.position.x + (anchor.measured?.width ?? metrics.width) / 2,
				anchor.position.y + (anchor.measured?.height ?? metrics.height) / 2,
				{ zoom: LEGIBLE_ZOOM[lod], duration: 400 },
			);
			return;
		}

		// Nobody to show them with, so keep them at their designed size rather than blowing
		// one card up to fill the viewport.
		void fitView({ padding: 1.6, duration: 400, nodes: [anchor], maxZoom: 1 });
	}, [homeIds, lod, viewportWidth, viewportHeight, fitView, getNodes, getNodesBounds, setCenter]);

	// Frame the graph once its nodes have actually been measured. Keyed on layoutEpoch, so
	// switching between combined and mine-only refits but a hover does not.
	useEffect(() => {
		if (!measured || layoutEpoch === 0) return;

		// Once per layout, whatever else in the array changed. The `You` button is how a
		// viewer asks to be re-framed; nothing else should decide for them.
		if (framedEpoch.current === layoutEpoch) return;
		framedEpoch.current = layoutEpoch;

		const current = getNodes();
		if (current.length === 0) return;

		// Would fitting the whole tree push it below the legibility floor? On a phone a
		// four-generation tree does, and the result shows the shape of the family with none
		// of the names. So check the zoom the fit WOULD use rather than trusting fitView's
		// own clamp, which reports success either way.
		const bounds = getNodesBounds(current);
		const fitZoom = Math.min(
			usable(viewportWidth, FIT_PADDING) / (bounds.width || 1),
			usable(viewportHeight, FIT_PADDING) / (bounds.height || 1),
		);

		if (fitZoom >= LEGIBLE_ZOOM[lod]) {
			void fitView({ padding: FIT_PADDING, duration: 400 });
			return;
		}

		/*
		 * An orbit always fits rather than falling back to the household.
		 *
		 * `frameSelf` centres on the viewer's immediate family, which in a ring layout is a
		 * wedge of ring 1 -- so it would open on an arc of cards with the centre off screen,
		 * hiding the one person the whole arrangement is built around. The rings ARE the
		 * information here, so seeing them small beats seeing part of one legibly.
		 */
		if (view === "orbit") {
			void fitView({ padding: FIT_PADDING, duration: 400 });
			return;
		}

		// Too big to fit legibly: open on the viewer instead and let them pan or collapse.
		frameSelf();
	}, [
		measured,
		layoutEpoch,
		viewportWidth,
		viewportHeight,
		lod,
		view,
		frameSelf,
		fitView,
		getNodesBounds,
		getNodes,
	]);

	/**
	 * Travel to a person: centre them, select them, pin them, open their panel.
	 *
	 * All of it, because arriving is not the same as finding. A viewport that has moved
	 * leaves you looking at a wall of cards with no idea which one you asked for.
	 *
	 * `setCenter` rather than `fitView` on one node: fitting a single card zooms it to
	 * fill the viewport and throws away the relatives that answer "who is this". The zoom
	 * is only ever RAISED to the legibility floor, never lowered, so arriving never undoes
	 * a viewer's deliberate zoom-in.
	 */
	const travelTo = useCallback(
		(personId: string, { openDetail = false }: { openDetail?: boolean } = {}) => {
			const target = getNodes().find((node) => node.id === personId);
			if (!target) return;

			const metrics = NODE_METRICS[lod];
			void setCenter(
				target.position.x + (target.measured?.width ?? metrics.width) / 2,
				target.position.y + (target.measured?.height ?? metrics.height) / 2,
				// Read rather than subscribed: depending on the live zoom would re-run this on
				// every wheel tick and yank the viewport back to the last search hit.
				{ zoom: Math.max(getZoom(), LEGIBLE_ZOOM[lod]), duration: 400 },
			);

			setFocusedId(personId);
			// Pinned as well as focused: there is no pointer on the card you just travelled
			// to, so without the pin a searched person arrives with their relations hidden --
			// and "who is this connected to" is usually why you searched them.
			setPinnedId(personId);
			setTrail((current) => pushTrail(current, personId));
			if (openDetail) setDetailId(personId);
			setNodes((current) =>
				current.map((node) => {
					const selected = node.id === personId;
					return node.selected === selected ? node : { ...node, selected };
				}),
			);
		},
		[getNodes, getZoom, lod, setCenter, setNodes],
	);

	useEffect(() => {
		if (!goTo || !measured) return;
		travelTo(goTo.id, { openDetail: true });
	}, [goTo, measured, travelTo]);

	/**
	 * Who lights up when somebody is focused. Traverses through union dots, so hovering a
	 * parent reaches their partner and children rather than stopping at the junction.
	 *
	 * Over the ENABLED edges, not the drawn ones: the drawn set is itself derived from
	 * focus, so traversing it would make the highlight depend on its own output.
	 *
	 * Keyed on `revealedId`, the same value the reveal uses -- not on `focusedId`. Once a
	 * person is pinned and the pointer moves away, their lines are still on screen, and
	 * lighting keyed on hover alone would leave those lines drawn with nothing lit and
	 * every card dimmed around them.
	 */
	const lit = useMemo(() => {
		if (!revealedId) return null;
		const unionIds = new Set(sourceNodes.filter((n) => n.type === "union").map((n) => n.id));
		return neighbourhood(enabledEdges, revealedId, (id) => unionIds.has(id));
	}, [revealedId, sourceNodes, enabledEdges]);

	/**
	 * Apply focus by rewriting className only. Deliberately its own effect: folding focus
	 * into the layout's edge memo would re-run ELK on every hover.
	 *
	 * Nodes only. Edge focus is applied in the derived `edges` memo below, so pushing it
	 * into state as well would store the same fact twice.
	 */
	useEffect(() => {
		setNodes((current) =>
			current.map((node) => {
				// Three states, and the third is why `kf-lit` exists separately from the absence
				// of `kf-dim`. Dimming answers "not this one" for the rest of the tree; it cannot
				// answer "this one" when the lit neighbourhood is most of the canvas. The glow
				// marks the SUBJECT -- its relatives are already identified by the lines to it.
				let next = withFlag("kf-dim", node.className, Boolean(lit) && !lit?.nodeIds.has(node.id));
				next = withFlag("kf-lit", next, node.id === revealedId);
				return next === node.className ? node : { ...node, className: next };
			}),
		);
	}, [lit, revealedId, setNodes]);

	/**
	 * What React Flow renders: the laid-out skeleton, plus the revealed relations, with
	 * focus applied.
	 *
	 * Derived rather than stored, and that is the point of the split. Relations come SECOND
	 * so they paint over the skeleton, which is what their `zIndex: 1001` asks for -- and
	 * DOM order is the tiebreak React Flow actually uses within a z-index.
	 */
	const edges = useMemo<Edge[]>(() => {
		const focusApplied = (edge: Edge): Edge => {
			const active = Boolean(lit?.edgeIds.has(edge.id));
			let next = withFlag("is-active", edge.className, active);
			next = withFlag("kf-dim", next, Boolean(lit) && !active);
			return next === edge.className ? edge : { ...edge, className: next };
		};
		return [...familyEdges.map(focusApplied), ...relationFlowEdges.map(focusApplied)];
	}, [familyEdges, relationFlowEdges, lit]);

	// Tap counts as well as hover: on a phone there is no hover, and a tap that only
	// selected a card would leave the labels unreachable.
	const focus = useCallback((_: unknown, node: Node) => setFocusedId(node.id), []);
	const blur = useCallback(() => setFocusedId(null), []);

	/** Clicking the empty canvas clears the hover, the pin and the panel. */
	const clear = useCallback(() => {
		setFocusedId(null);
		setPinnedId(null);
		setDetailId(null);
		onPick?.(null);
	}, [onPick]);

	/**
	 * A click focuses, PINS, opens the panel and names the person.
	 *
	 * Pinning is what makes a revealed relation followable: without it the lines vanish the
	 * moment the pointer leaves the card. Clicking the same card again unpins, so the
	 * gesture is its own undo.
	 *
	 * Union dots are skipped for the NAMING and the panel only: a junction is not somebody
	 * you can relate to, and reporting one would put "Unknown" in a picker. It still
	 * focuses, since hovering a dot lighting up the couple it joins is useful.
	 */
	const pick = useCallback(
		(event: unknown, node: Node) => {
			focus(event, node);
			setPinnedId((current) => (current === node.id ? null : node.id));
			if (node.type !== "person") return;

			setDetailId((current) => (current === node.id ? null : node.id));
			setTrail((current) => pushTrail(current, node.id));
			const person = node.data as {
				primary?: Parameters<typeof displayName>[0];
			};
			if (person.primary) onPick?.({ id: node.id, name: displayName(person.primary) });
		},
		[focus, onPick],
	);

	/**
	 * Collapse or expand the generation a card sits in.
	 *
	 * Addressed by the PEOPLE in the band rather than by a band index, because a band is a
	 * layout artefact: it exists only after ELK has run, and an index would point at a
	 * different row as soon as somebody added a great-grandparent.
	 */
	const foldGeneration = useCallback(() => {
		const anchor = revealedId ?? selfId;
		if (!anchor) return;

		const anchorNode = getNodes().find((node) => node.id === anchor);
		if (!anchorNode) return;

		const row = getNodes()
			.filter((node) => node.type === "person" && node.position.y === anchorNode.position.y)
			.map((node) => node.id);
		if (row.length > 0) setCollapsed((current) => collapseGeneration(current, row));
	}, [revealedId, selfId, getNodes]);

	const onAction = useCallback(
		(action: ShortcutAction) => {
			switch (action) {
				case "search":
					onFocusSearch?.();
					break;
				case "fit":
					void fitView({ padding: FIT_PADDING, duration: 400 });
					break;
				case "self":
					frameSelf();
					break;
				case "zoomIn":
					void zoomIn({ duration: 200 });
					break;
				case "zoomOut":
					void zoomOut({ duration: 200 });
					break;
				case "detail": {
					const next = LOD_CYCLE[(LOD_CYCLE.indexOf(lod) + 1) % LOD_CYCLE.length];
					if (next) onLodChange?.(next);
					break;
				}
				case "generation":
					foldGeneration();
					break;
				case "expandAll":
					// One key that undoes every fold. Without it, unfolding a graph collapsed at
					// six places means finding six cards -- and the folded ones are exactly the
					// cards whose branches are off screen.
					setCollapsed(NOTHING_COLLAPSED);
					break;
				case "theme": {
					// Reads the LIVE attribute rather than component state, because the theme is
					// owned by <html> and the header's own control writes it too. Anything else
					// would be a second source of truth that could disagree with the paint.
					const isLight = document.documentElement.getAttribute(THEME_ATTR) === "light";
					const next = isLight ? "dark" : "light";
					applyScheme(resolveScheme(next));
					try {
						localStorage.setItem(THEME_KEY, next);
					} catch {
						// A private window throws on write. The attribute is already applied, so the
						// choice holds for this session and only persistence is lost.
					}
					break;
				}
				case "clear":
					if (helpOpen) setHelpOpen(false);
					else clear();
					break;
				case "help":
					setHelpOpen((open) => !open);
					break;
			}
		},
		[
			onFocusSearch,
			fitView,
			frameSelf,
			zoomIn,
			zoomOut,
			lod,
			onLodChange,
			helpOpen,
			clear,
			foldGeneration,
		],
	);

	useShortcuts(onAction);

	const detailPerson = detailId ? (people.get(detailId) ?? null) : null;
	const trailPeople = useMemo(
		() => trail.map((id) => people.get(id)).filter((p): p is FusedPerson => Boolean(p)),
		[trail, people],
	);

	if (phase === "error") {
		return <TreeError onRetry={() => setAttempt((n) => n + 1)} />;
	}

	return (
		<>
			{phase === "loading" && (
				<div className="absolute inset-0 z-30">
					<TreeLoading />
				</div>
			)}

			<ReactFlow
				nodes={nodes}
				edges={edges}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onNodeMouseEnter={focus}
				onNodeMouseLeave={blur}
				onNodeClick={pick}
				onPaneClick={clear}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				// Connecting nodes by dragging would imply a relationship kind we cannot infer;
				// relationships are added through the editor instead.
				nodesConnectable={false}
				elementsSelectable
				// React Flow deletes the selected node on Backspace by default. This canvas is
				// read-only, so that silently drops a person from the view with no undo.
				deleteKeyCode={null}
				// 150 edges in the tab order put ~150 stops between a keyboard user and the zoom
				// controls, for elements that cannot be acted on. People stay focusable; the
				// lines between them are not destinations.
				edgesFocusable={false}
				minZoom={MIN_ZOOM}
				maxZoom={MAX_ZOOM}
				proOptions={{ hideAttribution: false }}
				className="size-full"
			>
				{/*
				 * The taper gradient, referenced by `.is-directed` in globals.css.
				 *
				 * A `<defs>` entry cannot be written in a stylesheet, and it has to live in the
				 * document rather than inside React Flow's edge SVG -- `url(#id)` resolves against
				 * the whole document, so one definition serves every edge.
				 *
				 * `gradientUnits="objectBoundingBox"` is what makes ONE definition work for paths
				 * running in every direction: the gradient is expressed in the path's own box, so
				 * x1=0 is always the source end. A userSpaceOnUse gradient would need per-edge
				 * coordinates and therefore per-edge defs.
				 *
				 * The fade stops at `--kf-taper-fade` rather than 0, and the value is per scheme
				 * because an alpha is not a colour until you know what is behind it: 0.68 measures
				 * 3.28:1 on the dark canvas, 0.82 measures 3.45:1 on the light one. A stroke
				 * reaching transparent would read as cut off rather than as arriving, and the
				 * terminus is exactly where a reader looks to see WHO a relation lands on.
				 *
				 * `var()` DOES resolve inside `<stop stop-color>` -- verified on a live element.
				 */}
				{/* `aria-hidden="true"` spelled out rather than as the JSX shorthand: Biome's
				    noSvgWithoutTitle only recognises the string form, and this svg holds a
				    definition with nothing to announce. */}
				<svg aria-hidden="true" className="pointer-events-none absolute size-0" focusable="false">
					<defs>
						<linearGradient
							id="kf-taper"
							gradientUnits="objectBoundingBox"
							x1="0"
							y1="0"
							x2="1"
							y2="0"
						>
							{/* Both stops are the ACCENT, matching the revealed relation's own stroke: a
							    taper fading to a different hue than the line it belongs to reads as two
							    marks rather than one line arriving. */}
							<stop offset="0%" stopColor="var(--color-accent)" stopOpacity="1" />
							<stop
								offset="100%"
								stopColor="var(--color-accent)"
								stopOpacity="var(--kf-taper-fade)"
							/>
						</linearGradient>
					</defs>
				</svg>

				{/* No `color` prop: the dot fill and its edge fade are tokens in globals.css, so
				    the lattice restyles with the rest of the surface stack -- and passing `color`
				    would write the `-props` variable React Flow checks FIRST, overriding it.
				    Geometry stays here, since it is not a design token. */}
				<Background variant={BackgroundVariant.Dots} gap={24} size={1} />
				<GenerationRails bands={bands} />

				{/*
				 * Zoom buttons on a pointer device only.
				 *
				 * On a phone they are 133px of vertical canvas spent on a gesture the platform
				 * already provides better: pinch zooms about the point you are looking at, where a
				 * + button zooms about the viewport centre and moves whatever you were reading.
				 * Hidden with CSS rather than a media-query hook, so the server renders the same
				 * markup either way.
				 */}
				<Controls
					showInteractive={false}
					className="kf-zoom-controls overflow-hidden rounded-lg border border-hairline"
				/>

				{/*
				 * ONE panel holding the overview and the two travel buttons, not three. React
				 * Flow positions each Panel absolutely in its corner, so siblings in the same
				 * corner would stack -- and nudging one with a margin fails because the overview's
				 * height changes with the detail level. A flex column lets them sit above each
				 * other by layout instead.
				 *
				 * Bottom-RIGHT at every size, opposite React Flow's zoom stack. Flipping sides by
				 * media query needs a rule that beats `.react-flow__panel.left`, and their
				 * stylesheet is imported after globals.css, so an equally specific `left: auto`
				 * loses on source order -- leaving both edges pinned and stretching the panel into
				 * a full-width invisible strip that eats the drag which should pan the tree.
				 */}
				<Panel
					position="bottom-right"
					className="kf-locate pointer-events-none flex flex-col items-end gap-1.5"
				>
					<TreeMinimap nodes={overview} extent={extent} />

					<div className="flex gap-1.5">
						<TravelButton onClick={() => void fitView({ padding: FIT_PADDING, duration: 400 })}>
							<Maximize2 className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
							All
						</TravelButton>

						{/*
						 * Back to yourself. The single most valuable control on a canvas 10760px wide,
						 * and the one thing a viewer cannot recover by gesture: pan far enough on a
						 * phone and every direction looks the same.
						 */}
						{selfId && (
							<TravelButton onClick={frameSelf}>
								<Crosshair className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
								You
							</TravelButton>
						)}
					</div>
				</Panel>
			</ReactFlow>

			<OfflineNotice />

			{/* Centred at the top, between search on the left and the detail controls on the
			    right. `max-w` keeps it from reaching either on a narrow window. */}
			<div className="pointer-events-none absolute left-1/2 top-3 z-20 flex max-w-[min(28rem,calc(100%-16rem))] -translate-x-1/2 justify-center">
				<div className="pointer-events-auto">
					<TreeBreadcrumbs trail={trailPeople} onGoTo={(id) => travelTo(id)} />
				</div>
			</div>

			<PersonDetail
				person={detailPerson}
				index={relativeIndex}
				kinship={kinship}
				editableTreeIds={editableTreeIds}
				onAddRelative={detailPerson && canEdit ? () => openQuickAdd(detailPerson) : undefined}
				onCenter={detailPerson ? () => travelTo(detailPerson.id) : undefined}
				// Re-read from the server rather than patching locally: the write happened there, so
				// there is what knows the new graph -- and fusion, kinship and layout all derive
				// from it.
				onSaved={() => router.refresh()}
				onClose={() => setDetailId(null)}
				// Travelling from the panel keeps the panel open on the NEW person, which is what
				// makes it a way to walk the family: parents to their parents to their siblings.
				onGoTo={(id) => travelTo(id, { openDetail: true })}
			/>

			{/*
			 * The quick-add sheet, mounted ONCE here rather than per card.
			 *
			 * 117 cards each holding their own form would be 117 forms in the DOM for one that
			 * can be open, and every one of them would re-render on hover.
			 *
			 * `router.refresh()` on success rather than a local mutation: the write happened on
			 * the server, so the server is what knows the new graph -- and re-deriving fusion,
			 * kinship and layout from a client-side guess is how the canvas and the database
			 * start disagreeing.
			 */}
			<QuickAddSheet
				subject={quickAdd}
				onDone={() => router.refresh()}
				onClose={() => setQuickAdd(null)}
			/>

			{/*
			 * Why a `+` did nothing, when it did nothing.
			 *
			 * `openQuickAdd` refuses a person no source row of which this viewer may write to --
			 * a relative's own record, reached through an accepted link. Without this the button
			 * would swallow the press silently, which reads as a broken control rather than as a
			 * permission boundary. Dismissed by tapping it, since it is a notice and not a
			 * decision.
			 */}
			<AnimatePresence>
				{quickAddRefusal && (
					<motion.button
						type="button"
						onClick={() => setQuickAddRefusal(null)}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: 8 }}
						className={cn(
							"kf-glass absolute bottom-4 left-1/2 z-50 max-w-[min(22rem,calc(100%-2rem))]",
							"-translate-x-1/2 rounded-lg px-3 py-2 text-left text-[0.75rem] leading-snug",
							"text-ink-muted",
						)}
					>
						{quickAddRefusal}
					</motion.button>
				)}
			</AnimatePresence>

			<ShortcutSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
		</>
	);
}

function TravelButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"kf-glass pointer-events-auto flex min-h-11 items-center gap-2 rounded-lg px-3",
				"font-mono text-[0.625rem] uppercase tracking-wider text-ink-muted",
				"transition-colors duration-(--duration-fast) ease-(--ease-out)",
				"hover:border-hairline-strong hover:text-ink",
			)}
		>
			{children}
		</button>
	);
}

/**
 * Provider wrapper: `useReactFlow` requires context above the canvas.
 *
 * Keyed on the level of detail AND the arrangement, so switching either REMOUNTS rather
 * than diffing. Node dimensions change with the detail level, and React Flow caches
 * measured sizes per node id -- a diff would leave the old box on every node and the new
 * layout would collide with itself. The arrangement is in the key for a different reason:
 * tree and orbit place nodes in unrelated coordinate spaces (orbit is centred on the
 * origin and runs negative), so the viewport transform carried over from one is meaningless
 * in the other and the canvas would open looking at empty space.
 */
export function TreeCanvas(props: Props) {
	return (
		<ReactFlowProvider key={`${props.lod ?? "full"}:${props.view ?? "tree"}`}>
			<Canvas {...props} />
		</ReactFlowProvider>
	);
}
