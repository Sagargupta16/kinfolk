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
 *   - Focus, the depth tilt and per-pointer draggability are applied in their own
 *     effects that rewrite `className`/`draggable` and nothing else.
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
import { Crosshair, LocateFixed, Maximize2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
	type CSSProperties,
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { applyScheme, MOTION_ATTR, resolveScheme, THEME_ATTR, THEME_KEY } from "@/lib/theme";
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
	type PositionedNode,
} from "@/lib/tree/layout";
import { neighbourhood } from "@/lib/tree/neighbourhood";
import { type AddSlot, type AddTarget, addSlots, nodeAffordances } from "@/lib/tree/node-add";
import { type OverviewNode, overviewNodes } from "@/lib/tree/overview";
import { collapseUnionEdges, radialLayout } from "@/lib/tree/radial";
import { indexRelatives, relativesOf } from "@/lib/tree/relatives";
import { detourY, type SiblingBar } from "@/lib/tree/siblings";
import { cn } from "@/lib/utils";
import { FamilyEdge } from "./FamilyEdge";
import { GenerationRails } from "./GenerationRails";
import { NodeAddControls, NodeAddStrip } from "./NodeAdd";
import { NodeEditStrip } from "./NodeEdit";
import { PersonDetail } from "./PersonDetail";
import { PersonNode, UnionNode } from "./PersonNode";
import { pushTrail, TreeBreadcrumbs } from "./TreeBreadcrumbs";
import { TreeMinimap } from "./TreeMinimap";
import { type ShortcutAction, ShortcutSheet, useShortcuts } from "./TreeShortcuts";
import { OfflineNotice, TreeError, TreeLoading } from "./TreeStates";
import type { ViewMode } from "./ViewControls";

const nodeTypes = { person: PersonNode, union: UnionNode };
const edgeTypes = { family: FamilyEdge };

function travelDuration(milliseconds = 280): number {
	return document.documentElement.getAttribute(MOTION_ATTR) === "off" ? 0 : milliseconds;
}

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

/*
 * The clock of a write from the canvas, one storyboard (the times are matched in
 * globals.css): cards glide to their new places over 440ms; at REDRAW_MS a moved family's
 * lines start drawing back on; the new relative leaves the `+` at 120ms and lands at about
 * ARRIVE_MS, when its own lines and any new junction appear; a ring ripples out from it as
 * it settles. Under 1.5s end to end, the budget for an entrance.
 */
const REDRAW_MS = 260;
const ARRIVE_MS = 560;

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
	/** Durable person the workspace is organised around. */
	viewedId?: string | null;
	/** Changes the durable subject without conflating it with hover or panel state. */
	onViewedChange?: (personId: string) => void;
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
	 * Whether this viewer may write, which decides if the `+` handles are drawn at all.
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
	editableUnions?: UnionWithChildren[];
	/**
	 * A person to travel to, set by search, the People directory or the feed. An object rather
	 * than a bare id so asking for the SAME person twice still moves: after panning away,
	 * searching the name you just searched has to bring you back, and a plain string would
	 * compare equal.
	 *
	 * `profile` says whether arriving opens their profile. The directory and the feed are
	 * reading surfaces, so they do; search is how somebody finds a person to work on, so on an
	 * editable canvas it only travels and selects, and the card's own handles take over.
	 */
	goTo?: { id: string; profile: boolean } | null;
	/**
	 * Acknowledge a handled travel, so the request cannot replay.
	 *
	 * Without this, `goTo` sits in state forever and ANY re-fire of the travel
	 * effect -- `useNodesInitialized` flickering during a className rewrite is
	 * enough -- replays the last navigation: close a panel after arriving from
	 * search or the feed, and it reopens by itself. Same contract as
	 * `onCloseDetailHandled`.
	 */
	onGoToHandled?: () => void;
	/** How connected each person is. Passed in because search ranks by it too. */
	degree: Map<string, Degree>;
	/** What each person is to the viewer. Computed server-side: it needs the whole graph. */
	kinship?: Map<string, Kinship>;
	/** Focus the search box, for the `/` shortcut. */
	onFocusSearch?: () => void;
	/** Called with whether the detail panel is open, so the stage can move its chrome. */
	onDetailOpenChange?: (open: boolean) => void;
	/**
	 * Ask for the person panel to close, from chrome that lives outside the canvas.
	 *
	 * The stage's feed shares the detail panel's rail but cannot see `detailId`; this is a
	 * request/acknowledge contract because the canvas remounts when the detail level
	 * changes, and an unacknowledged request would replay there.
	 */
	closeDetailRequest?: { nonce: number } | null;
	/** Acknowledge a handled close, so the request cannot replay. */
	onCloseDetailHandled?: () => void;
	/** The directory shares this canvas's profile and editing surfaces. */
	directory?: ReactNode;
};

function Canvas({
	nodes: sourceNodes,
	edges: sourceEdges,
	showRelations = true,
	selfId,
	viewedId,
	onViewedChange,
	lod = "full",
	onLodChange,
	view = "tree",
	depth = false,
	canEdit = false,
	editableTreeIds = [],
	editableUnions,
	goTo,
	onGoToHandled,
	degree,
	kinship,
	onFocusSearch,
	onDetailOpenChange,
	closeDetailRequest,
	onCloseDetailHandled,
	directory,
	held,
}: Props & { held: Held }) {
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
	const positionedRef = useRef<PositionedNode[]>([]);
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
	const {
		fitView,
		getNodesBounds,
		getNodes,
		getViewport,
		setCenter,
		setViewport,
		getZoom,
		zoomIn,
		zoomOut,
	} = useReactFlow();
	/**
	 * Where the viewed card sat before an in-canvas write, so the layouts that follow keep it
	 * still on screen instead of re-framing the tree.
	 *
	 * Every write ends in a relayout, and every layout used to be framed: a tree that fits ran
	 * `fitView` and slid the `+` out from under the pointer, a larger one re-centred and threw
	 * the viewer's pan away -- twice when the add also opened a fold. The next relative of a
	 * family is added from the same card, so the card is what must not move. `until` bounds
	 * the hold, so a write whose layout never lands cannot suppress framing for good.
	 */
	const writeAnchor = useRef<{ id: string; x: number; y: number; until: number } | null>(null);

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

	// Reported upward so the stage can slide its control cluster out from under the
	// desktop panel: the panel is deliberately non-modal, and a control that cannot
	// be clicked while it is open is a dead control, not a design.
	useEffect(() => {
		onDetailOpenChange?.(detailId !== null);
	}, [detailId, onDetailOpenChange]);

	/**
	 * Keep the open panel's subject in the unobscured part of the canvas.
	 *
	 * `setCenter` normally puts the card in the viewport centre, which is behind the
	 * 55dvh mobile sheet and can sit under the 22rem desktop rail on a narrow screen.
	 * The panel's layout box is already final while its transform animates, so its
	 * offset dimensions provide the exact reserved space without duplicating CSS values.
	 */
	useEffect(() => {
		if (!detailId || !measured) return;

		const frame = requestAnimationFrame(() => {
			const target = getNodes().find((node) => node.id === detailId);
			const panel = document.querySelector<HTMLElement>(".kf-sheet--rail");
			if (!target || !panel) return;

			const metrics = NODE_METRICS[lod];
			const zoom = Math.max(getZoom(), LEGIBLE_ZOOM[lod]);
			const targetX = target.position.x + (target.measured?.width ?? metrics.width) / 2;
			const targetY = target.position.y + (target.measured?.height ?? metrics.height) / 2;
			const desktopRail = panel.offsetLeft > 0;
			const flow = document.querySelector<HTMLElement>(".react-flow");
			const flowTop = flow?.getBoundingClientRect().top ?? 0;
			// The viewing docket is the one piece of chrome inside the canvas's top edge; the
			// search box and the editor moved out of the canvas, so measuring them read 0.
			const docket = document.querySelector<HTMLElement>(
				'[aria-label="Current person and recently viewed"]',
			);
			const topInset =
				desktopRail || !docket ? 0 : Math.max(0, docket.getBoundingClientRect().bottom - flowTop);
			const mobileOffset = Math.max(0, panel.offsetHeight - topInset) / (2 * zoom);

			void setCenter(
				targetX + (desktopRail ? panel.offsetWidth / (2 * zoom) : 0),
				targetY + (desktopRail ? 0 : mobileOffset),
				{ zoom, duration: travelDuration() },
			);
		});

		return () => cancelAnimationFrame(frame);
	}, [detailId, measured, getNodes, getZoom, lod, setCenter]);
	const { trail, setTrail } = held;
	const [helpOpen, setHelpOpen] = useState(false);
	/**
	 * The one strip open on the canvas: adding from a pressed `+`, or editing the viewed card.
	 *
	 * The add strip keeps the whole SLOT, not only its target: the slot's point is where the
	 * strip grows from, and where the new relative will be seen to come out of. Its accessible
	 * name says whose relative it adds -- "Add a parent" with no name attached is how a father
	 * gets recorded against the wrong person.
	 */
	const [strip, setStrip] = useState<
		{ kind: "add"; slot: AddSlot } | { kind: "edit"; personId: string } | null
	>(null);
	/** The source row just written, until the relayout that contains it can light it up. */
	const [createdPersonId, setCreatedPersonId] = useState<string | null>(null);
	/** The fused id of the card currently wearing the "just added" flash. */
	const [newId, setNewId] = useState<string | null>(null);
	/** The card just edited in place, which a light sweeps across once. */
	const [updatedId, setUpdatedId] = useState<string | null>(null);
	/** The card shrinking away while its delete is in flight. */
	const [leavingId, setLeavingId] = useState<string | null>(null);
	/**
	 * The relative being born, read by the NEXT layout: their source id and the `+` they came
	 * out of. A ref, not state, because the layout effect must not depend on it -- it is a fact
	 * about the write, consumed once by the layout that contains the new card.
	 */
	const pendingBirth = useRef<{ personId: string; from: { x: number; y: number } } | null>(null);
	/** Alternates the glide keyframes, so a card moved by two writes in a row glides twice. */
	const glideCount = useRef(0);
	const [savedName, setSavedName] = useState<string | null>(null);
	useEffect(() => {
		if (!savedName) return;
		const timer = window.setTimeout(() => setSavedName(null), 5000);
		return () => window.clearTimeout(timer);
	}, [savedName]);
	/** A write that failed after its strip had already been closed. */
	const [failure, setFailure] = useState<string | null>(null);
	useEffect(() => {
		if (!failure) return;
		const timer = window.setTimeout(() => setFailure(null), 7000);
		return () => window.clearTimeout(timer);
	}, [failure]);
	/*
	 * Where the toasts stand. On a phone an open strip is docked along the bottom edge, and
	 * relatives are added in runs, so a toast at the bottom sat on the strip's Son and
	 * Daughter answers for five seconds after every add. With a strip open there, it goes up.
	 */
	const toastPlace = strip ? "max-sm:top-3 sm:bottom-4" : "bottom-4";
	// Refreshing the server route after a write is what keeps fusion, kinship and the layout
	// derived from the database rather than from a client-side guess about what changed.
	const router = useRouter();
	const { collapsed, setCollapsed } = held;

	const selfNodeId = useMemo(
		() =>
			sourceNodes.find(
				(node) =>
					node.type === "person" &&
					Boolean(selfId && node.data.sources.some((source) => source.id === selfId)),
			)?.id,
		[sourceNodes, selfId],
	);

	/**
	 * The viewer's immediate family, for framing when the tree cannot fit legibly.
	 *
	 * FAMILY edges only. Traversing social edges too would drag in a friend of a friend on
	 * the far side of the canvas, and the "immediate family" box would span the whole tree
	 * -- the very thing this fallback exists to avoid.
	 */
	/** Which node ids are union dots, built once per data change rather than per hover. */
	const unionIds = useMemo(
		() => new Set(sourceNodes.filter((n) => n.type === "union").map((n) => n.id)),
		[sourceNodes],
	);
	const homeIds = useMemo(() => {
		if (!selfNodeId) return null;
		const family = sourceEdges.filter((edge) => edge.layout);
		return neighbourhood(family, selfNodeId, (id) => unionIds.has(id)).nodeIds;
	}, [selfNodeId, unionIds, sourceEdges]);

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
	/*
	 * Kept by CONTENT, not by computation. The viewed person is an anchor, so picking
	 * somebody recomputes this set -- and with anything folded a fresh Set, even an
	 * identical one, flowed into the laid-out arrays and re-ran ELK and the framing on
	 * every pick (a click must stay cheap). Only a change in who is visible may relayout.
	 */
	const foldAnchors = useMemo(
		() => [
			...(selfNodeId ? [selfNodeId] : []),
			...(viewedId ? [viewedId] : []),
			...collapsed.descendants,
			...collapsed.ancestors,
		],
		[selfNodeId, viewedId, collapsed],
	);
	const visibleCache = useRef<Set<string> | null>(null);
	const visibleIds = useMemo(() => {
		const next = visibleAfterCollapse(sourceNodes, sourceEdges, collapsed, foldAnchors);
		const previous = visibleCache.current;
		if (previous && previous.size === next.size && [...next].every((id) => previous.has(id))) {
			return previous;
		}
		visibleCache.current = next;
		return next;
	}, [sourceNodes, sourceEdges, collapsed, foldAnchors]);

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
	const orbitFocusId = view === "orbit" ? (viewedId ?? selfNodeId ?? null) : null;

	const folds = useMemo(() => foldable(sourceEdges), [sourceEdges]);
	/*
	 * Counted with the canvas's own anchors, so a "+N" badge never counts somebody the canvas
	 * still shows. The anchors include the viewed person, and these counts reach the layout,
	 * so the result is kept by content like `visibleIds`: a pick must not re-run ELK.
	 */
	const hiddenCache = useRef<Map<string, number> | null>(null);
	const hidden = useMemo(() => {
		const next = hiddenCounts(sourceNodes, sourceEdges, collapsed, foldAnchors);
		const previous = hiddenCache.current;
		if (
			previous &&
			previous.size === next.size &&
			[...next].every(([id, count]) => previous.get(id) === count)
		) {
			return previous;
		}
		hiddenCache.current = next;
		return next;
	}, [sourceNodes, sourceEdges, collapsed, foldAnchors]);

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

	useEffect(() => {
		if (!viewedId || !people.has(viewedId)) return;
		setTrail((current) => pushTrail(current, viewedId));
	}, [people, viewedId, setTrail]);

	/** Whose relations are revealed: the pinned person, else the hovered one. */
	const revealedId = pinnedId ?? focusedId;

	const fold = useCallback(
		(personId: string, direction: "descendants" | "ancestors") => {
			setCollapsed((current) => toggleCollapse(current, personId, direction));
		},
		[setCollapsed],
	);

	/**
	 * Every source row's name, sex and fused card, for the `+` handles.
	 *
	 * Keyed by SOURCE id because writes target source rows: a card shows a fused person whose
	 * id is the smallest member id, which on a merged person is the far family's row about
	 * half the time, so a `+` posting that id would be refused about somebody's own
	 * grandmother. The fused id is kept alongside, to find the partner's card on screen.
	 */
	const sourceIndex = useMemo(() => {
		const index = new Map<
			string,
			{ name: string; sex: FusedPerson["primary"]["sex"]; fusedId: string }
		>();
		for (const node of sourceNodes) {
			if (node.type !== "person") continue;
			for (const source of node.data.sources) {
				index.set(source.id, { name: displayName(source), sex: source.sex, fusedId: node.id });
			}
		}
		return index;
	}, [sourceNodes]);

	/**
	 * What the viewed person can grow, or null when no `+` belongs on the canvas.
	 *
	 * Null on a read-only canvas, in the orbit (where "above" is not where a parent goes), at
	 * the dot level (a `+` larger than the dot it belongs to), and for a person whose every
	 * row belongs to another family -- a linked relative's record is theirs to edit.
	 */
	const affordances = useMemo(() => {
		if (!canEdit || view === "orbit" || lod === "dot" || !viewedId) return null;
		const person = people.get(viewedId);
		if (!person) return null;
		const target = editTarget(person, editableTreeIds);
		if (!target.editable) return null;
		const source = person.sources.find((row) => row.id === target.personId);
		return nodeAffordances({
			subjectId: target.personId,
			subjectName: displayName(source ?? person.primary),
			subjectSex: (source ?? person.primary).sex,
			unions: (editableUnions ?? []).filter((union) => union.treeId === target.treeId),
			people: sourceIndex,
			// Parents the canvas already DRAWS, from either family: a linked family's record of
			// both parents leaves no slot for this one to fill.
			drawnParents: relativesOf(relativeIndex, viewedId).parents.length,
		});
	}, [
		canEdit,
		view,
		lod,
		viewedId,
		people,
		editableTreeIds,
		editableUnions,
		sourceIndex,
		relativeIndex,
	]);

	useEffect(() => {
		if (!closeDetailRequest) return;
		setDetailId(null);
		onCloseDetailHandled?.();
	}, [closeDetailRequest, onCloseDetailHandled]);

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
						bars: new Map<string, SiblingBar>(),
					})
				: layoutGraph(laidOutNodes, laidOutEdges, lod, selfNodeId);

		// ELK is async and imported lazily, so a fast second data change can resolve out of
		// order. The flag drops stale layouts.
		arranged
			.then(({ nodes: positioned, bands: rows, extent: box, bars: laneBars }) => {
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

				/*
				 * After a write from the canvas the family MOVES to make room instead of jumping.
				 *
				 * Every card that existed and has a new place glides there from where it was on
				 * SCREEN -- a FLIP on the card's own element, because React Flow owns the wrapper's
				 * transform -- the new relative flies out of the `+` it was added from, and the
				 * lines that changed draw back on as the cards come to rest. The viewed card holds
				 * still: the viewport moves in THIS commit by exactly as far as that card moved, so
				 * its glide is zero and every other card's is measured from the picture the person
				 * was looking at. Doing the hold here rather than after measurement is what stops a
				 * frame of new positions under the old viewport, which a glide would make visible.
				 */
				const anchor = writeAnchor.current;
				const heldNode =
					anchor && Date.now() < anchor.until
						? positioned.find((node) => node.id === anchor.id)
						: undefined;
				const shift =
					anchor && heldNode
						? { x: heldNode.position.x - anchor.x, y: heldNode.position.y - anchor.y }
						: null;
				const before = new Map(positionedRef.current.map((node) => [node.id, node.position]));
				const gliding = shift !== null && before.size > 0;
				if (anchor && heldNode && shift) {
					if (shift.x !== 0 || shift.y !== 0) {
						const viewport = getViewport();
						void setViewport({
							x: viewport.x - shift.x * viewport.zoom,
							y: viewport.y - shift.y * viewport.zoom,
							zoom: viewport.zoom,
						});
					}
					writeAnchor.current = { ...anchor, x: heldNode.position.x, y: heldNode.position.y };
				}

				const parity = glideCount.current % 2;
				const moves = new Map<string, { className: string; vars: Record<string, string> }>();
				const changed = new Set<string>();
				const birth = pendingBirth.current;
				let born = false;
				if (gliding && shift) {
					for (const node of positioned) {
						const was = before.get(node.id);
						if (
							!was &&
							birth &&
							node.type === "person" &&
							node.data.sources.some((source) => source.id === birth.personId)
						) {
							// Out of the `+`: its point moved with the held card, by `shift`.
							const fromX = birth.from.x + shift.x - (node.position.x + node.width / 2);
							const fromY = birth.from.y + shift.y - (node.position.y + node.height / 2);
							moves.set(node.id, {
								className: " kf-born",
								// The entrance runs at once, entirely under the birth, so no tail of it
								// shows after the relative has landed.
								vars: {
									"--kf-from-x": `${fromX}px`,
									"--kf-from-y": `${fromY}px`,
									"--kf-delay": "0ms",
								},
							});
							changed.add(node.id);
							born = true;
						} else if (!was) {
							// Anything else new -- the junction of a new couple -- appears as the new
							// relative lands, rather than ahead of them.
							moves.set(node.id, { className: "", vars: { "--kf-delay": `${ARRIVE_MS}ms` } });
							changed.add(node.id);
						} else {
							const dx = was.x - node.position.x + shift.x;
							const dy = was.y - node.position.y + shift.y;
							if (Math.hypot(dx, dy) <= 1) continue;
							moves.set(node.id, {
								className: ` kf-glide-${parity}`,
								vars: { "--kf-glide-x": `${dx}px`, "--kf-glide-y": `${dy}px` },
							});
							changed.add(node.id);
						}
					}
				}
				// Consumed by the layout that contains the new card, and only by that one.
				if (born) pendingBirth.current = null;
				if (changed.size > 0) glideCount.current += 1;

				/*
				 * Which lines redraw: any touching a card that moved or arrived, and every line of
				 * a family whose children moved -- the sibling bracket is drawn by one of them, and
				 * it changes shape when any child moves.
				 */
				const rethread = new Set<string>();
				if (changed.size > 0) {
					const families = new Set(
						familyFlowEdges
							.filter((edge) => changed.has(edge.target) || changed.has(edge.source))
							.map((edge) => edge.source),
					);
					for (const edge of familyFlowEdges) {
						if (changed.has(edge.source) || changed.has(edge.target) || families.has(edge.source)) {
							rethread.add(edge.id);
						}
					}
				}
				const arriving = new Set(
					positioned.filter((node) => !before.has(node.id)).map((node) => node.id),
				);

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
						// Structured arrangements own their geometry. Free-dragging one card would
						// immediately break parent/child ranks and leave partner rails behind.
						draggable: false,
						// Union beads paint BELOW the cards. The bead placement already aims for a
						// clear gutter, but a fused graph can leave a couple with no gutter at all
						// -- and a bead behind an opaque card is quiet, where a bead on somebody's
						// face reads as a defect.
						zIndex: node.type === "person" ? 2 : 1,
						// The animation itself is CSS (see globals.css); React Flow owns the node's
						// transform, so a JS-driven entrance would fight it. Focus and the depth
						// tilt are className flags applied in their own effect below: the base is
						// written here, the flags survive a relayout by being reapplied on epoch.
						// `kf-enter` stays first on every layout: a card's entrance has long finished,
						// and keeping its name in place is what stops a relayout from replaying it.
						className: `kf-enter${moves.get(node.id)?.className ?? ""}`,
						style: {
							"--kf-delay": `${delays.get(node.id) ?? 0}ms`,
							...moves.get(node.id)?.vars,
						} as CSSProperties,
					})),
				);

				/**
				 * Sibling bars, and which child edge of each family draws the horizontal run.
				 *
				 * The layout computes them, because it sizes the generation gaps from them. None
				 * in orbit mode: a bar is a horizontal bracket in a generation gap, and an orbit
				 * has neither.
				 *
				 * The election is by lowest edge id rather than by position, so it is stable
				 * across relayouts: picking the leftmost child would hand the bar to a different
				 * edge whenever ELK reorders siblings, restarting the draw-on animation on an
				 * edge that had not changed.
				 */
				const orbiting = view === "orbit" && Boolean(orbitFocusId);
				const bars: Map<string, SiblingBar> = orbiting ? new Map() : laneBars;

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

				/** Laid-out boxes by id, for the marriage-line rail below. */
				const boxes = new Map(positioned.map((node) => [node.id, node]));
				// Built once per layout, not copied out of the map for every partner edge.
				const personBoxes = positioned.filter((node) => node.type === "person");

				/**
				 * The marriage line's coordinates, for partner edges only.
				 *
				 * Computed here because only the canvas holds the laid-out boxes: an edge
				 * knows its handle positions (the card's bottom centre), and the marriage
				 * line runs at MID-card height, which no handle is at. For a couple the
				 * junction already sits on the line (layout.ts put it there), so the rail
				 * is the hub's own y; for the direct childless-couple edge it is the
				 * midpoint of the two partners' mid-heights.
				 */
				const partnerRail = (edge: Edge) => {
					const sBox = boxes.get(edge.source);
					const tBox = boxes.get(edge.target);
					if (!sBox || !tBox) return null;
					const sourceMidY = sBox.position.y + sBox.height / 2;
					const targetMidY = tBox.position.y + tBox.height / 2;
					// A direct childless partnership has no junction whose placement can choose a
					// safe lane. If another card lies between its endpoints, route through the
					// generation gap instead of drawing through that person's name -- by the same
					// rule the sibling lanes keep clear of.
					const railY =
						tBox.type === "union"
							? targetMidY
							: (detourY(sBox, tBox, personBoxes, NODE_METRICS[lod].rowGap) ??
								(sourceMidY + targetMidY) / 2);

					return { partner: true as const, railY, sourceMidY, targetMidY };
				};

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
							// The marriage line, for partner edges in the tree arrangement. Keyed off
							// the class the family memo already assigns, so partner-ness is decided
							// in exactly one place.
							const rail =
								!orbiting && (edge.className ?? "").includes("is-partner")
									? partnerRail(edge)
									: null;
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
													...(rail ?? {}),
												},
											}
										: { data: { ...anchor, ...(rail ?? {}) } }),
								className: withFlag(
									`kf-redraw-${parity}`,
									withFlag("kf-draw", edge.className, true),
									rethread.has(edge.id),
								),
								style: {
									...edge.style,
									"--kf-delay": `${delay}ms`,
									// A line to a new relative waits for them to land; a moved family's
									// lines start as its cards near rest.
									...(rethread.has(edge.id)
										? {
												"--kf-redraw-delay": `${
													arriving.has(edge.source) || arriving.has(edge.target)
														? ARRIVE_MS
														: REDRAW_MS
												}ms`,
											}
										: {}),
								} as CSSProperties,
							};
						}),
				);
				positionedRef.current = positioned;
				setBands(rows);
				setExtent(box);
				setOverview(overviewNodes(positioned, selfId));
				setLayoutEpoch((epoch) => epoch + 1);
				setPhase("ready");
			})
			.catch((error: unknown) => {
				// ELK is a lazy dynamic import, so the realistic failure is a dropped connection
				// on first layout -- which a retry fixes without a reload. Swallowing it would
				// leave the canvas on "Arranging the graph" forever. Logged by name only: the
				// same catch covers a fault in the passes after ELK, which a retry cannot fix
				// and which an empty console would hide.
				console.error(
					"[kinfolk] layout failed:",
					error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
				);
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
		// A string that changes only with the data, so it adds no relayout of its own.
		selfNodeId,
		lod,
		view,
		// Null outside orbit mode by construction, so a click in tree mode cannot re-run ELK.
		orbitFocusId,
		degree,
		kinship,
		folds,
		hidden,
		collapsed,
		fold,
		attempt,
		setNodes,
		setFamilyEdges,
		// Stable callbacks from React Flow, for the write hold above; never a reason to re-run.
		getViewport,
		setViewport,
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
					duration: travelDuration(),
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
				{ zoom: LEGIBLE_ZOOM[lod], duration: travelDuration() },
			);
			return;
		}

		// Nobody to show them with, so keep them at their designed size rather than blowing
		// one card up to fill the viewport.
		void fitView({ padding: 1.6, duration: travelDuration(), nodes: [anchor], maxZoom: 1 });
	}, [homeIds, lod, viewportWidth, viewportHeight, fitView, getNodes, getNodesBounds, setCenter]);

	/**
	 * The `+` handles, placed against the laid-out boxes.
	 *
	 * From `positionedRef` keyed on `layoutEpoch`, not from the React Flow node array: that
	 * array takes a new identity on every hover (focus rewrites className), and these
	 * positions only change when a layout lands. Empty while a layout is pending, so a handle
	 * is never drawn against the previous layout's coordinates.
	 */
	const slots = useMemo(() => {
		void layoutEpoch;
		if (!affordances || !viewedId || phase !== "ready") return [];
		const boxes = new Map(positionedRef.current.map((node) => [node.id, node]));
		const toBox = (node: PositionedNode | undefined): Box | undefined =>
			node
				? { x: node.position.x, y: node.position.y, width: node.width, height: node.height }
				: undefined;
		const box = toBox(boxes.get(viewedId));
		if (!box) return [];
		// Free space beside the card, from EVERY laid-out person on its row -- including a
		// spouse recorded only by a linked family, whom this tree's unions cannot see.
		const free = { left: Number.POSITIVE_INFINITY, right: Number.POSITIVE_INFINITY };
		for (const node of positionedRef.current) {
			if (node.type !== "person" || node.id === viewedId) continue;
			if (Math.abs(node.position.y - box.y) > 1) continue;
			if (node.position.x + node.width <= box.x) {
				free.left = Math.min(free.left, box.x - (node.position.x + node.width));
			} else if (node.position.x >= box.x + box.width) {
				free.right = Math.min(free.right, node.position.x - (box.x + box.width));
			}
		}
		return addSlots(affordances, box, {
			boxOf: (sourceId) => {
				const fused = sourceIndex.get(sourceId)?.fusedId;
				return fused ? toBox(boxes.get(fused)) : undefined;
			},
			junctionOf: (unionId) => toBox(boxes.get(`union:${unionId}`)),
			free,
			reach: Math.round(NODE_METRICS[lod].gap * 1.75) - 6,
			rowGap: NODE_METRICS[lod].rowGap,
		});
	}, [affordances, viewedId, phase, layoutEpoch, sourceIndex, lod]);

	const frameViewed = useCallback(() => {
		const anchor = getNodes().find((node) => node.id === viewedId);
		if (!anchor) {
			frameSelf();
			return;
		}
		const metrics = NODE_METRICS[lod];
		void setCenter(
			anchor.position.x + (anchor.measured?.width ?? metrics.width) / 2,
			anchor.position.y + (anchor.measured?.height ?? metrics.height) / 2,
			{ zoom: Math.max(getZoom(), LEGIBLE_ZOOM[lod]), duration: travelDuration() },
		);
	}, [frameSelf, getNodes, getZoom, lod, setCenter, viewedId]);

	// Frame the graph once its nodes have actually been measured. Keyed on layoutEpoch, so
	// switching between combined and mine-only refits but a hover does not.
	useEffect(() => {
		if (!measured || layoutEpoch === 0) return;

		// Once per layout, whatever else in the array changed. The `You` button is how a
		// viewer asks to be re-framed; nothing else should decide for them.
		if (framedEpoch.current === layoutEpoch) return;
		framedEpoch.current = layoutEpoch;

		// After a write from the canvas: hold the viewed card where it was rather than framing.
		const anchor = writeAnchor.current;
		if (anchor && Date.now() < anchor.until) {
			const moved = positionedRef.current.find((node) => node.id === anchor.id);
			if (moved) {
				const viewport = getViewport();
				const dx = (moved.position.x - anchor.x) * viewport.zoom;
				const dy = (moved.position.y - anchor.y) * viewport.zoom;
				if (dx !== 0 || dy !== 0) {
					void setViewport({ x: viewport.x - dx, y: viewport.y - dy, zoom: viewport.zoom });
				}
				writeAnchor.current = { ...anchor, x: moved.position.x, y: moved.position.y };
			}
			return;
		}
		writeAnchor.current = null;

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
			void fitView({ padding: FIT_PADDING, duration: travelDuration() });
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
			void fitView({ padding: FIT_PADDING, duration: travelDuration() });
			return;
		}

		// Too big to fit legibly: open on the durable subject instead and let them pan or fold.
		frameViewed();
	}, [
		measured,
		layoutEpoch,
		viewportWidth,
		viewportHeight,
		lod,
		view,
		frameViewed,
		fitView,
		getNodesBounds,
		getNodes,
		getViewport,
		setViewport,
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
		(personId: string, { openDetail = false }: { openDetail?: boolean } = {}): boolean => {
			const target = getNodes().find((node) => node.id === personId);
			if (!target) return false;

			onViewedChange?.(personId);

			const metrics = NODE_METRICS[lod];
			void setCenter(
				target.position.x + (target.measured?.width ?? metrics.width) / 2,
				target.position.y + (target.measured?.height ?? metrics.height) / 2,
				// Read rather than subscribed: depending on the live zoom would re-run this on
				// every wheel tick and yank the viewport back to the last search hit.
				{ zoom: Math.max(getZoom(), LEGIBLE_ZOOM[lod]), duration: travelDuration() },
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
			return true;
		},
		[getNodes, getZoom, lod, onViewedChange, setCenter, setNodes, setTrail],
	);

	/*
	 * Travel from inside the canvas -- a relative in the profile, a breadcrumb -- even to
	 * somebody a fold hides or the orbit leaves out. `travelTo` alone returned false for an
	 * unplaced person, so tapping a folded child in their mother's profile did nothing at
	 * all. Making them the viewed person anchors them, which brings them back on the next
	 * layout, and the travel completes from there.
	 */
	const [pendingTravel, setPendingTravel] = useState<{ id: string; openDetail: boolean } | null>(
		null,
	);
	const goToPerson = useCallback(
		(id: string, openDetail = false) => {
			if (travelTo(id, { openDetail })) return;
			onViewedChange?.(id);
			setPendingTravel({ id, openDetail });
		},
		[travelTo, onViewedChange],
	);
	useEffect(() => {
		if (!pendingTravel || !measured) return;
		void layoutEpoch;
		if (!people.has(pendingTravel.id)) {
			setPendingTravel(null);
			return;
		}
		if (travelTo(pendingTravel.id, { openDetail: pendingTravel.openDetail }))
			setPendingTravel(null);
	}, [pendingTravel, measured, layoutEpoch, travelTo, people]);

	useEffect(() => {
		if (!goTo || !measured) return;
		// A travel requested from an older projection stays pending until the relayout
		// actually contains its target. `layoutEpoch` is the retry trigger.
		void layoutEpoch;
		// Search on a read-only canvas still opens the profile: with no handles there, reading
		// is the only thing a found person offers.
		if (travelTo(goTo.id, { openDetail: goTo.profile || !canEdit })) onGoToHandled?.();
	}, [goTo, measured, layoutEpoch, travelTo, onGoToHandled, canEdit]);

	/*
	 * Light up a person just added, once a layout that contains them has landed.
	 *
	 * The canvas deliberately does NOT travel to them. The `+` handles belong to the viewed
	 * person, and a family is entered in runs -- "Narendra's children are Paras and Princi"
	 * -- so staying on the subject keeps the next `+` exactly where the last one was. The
	 * flash says where the new card went instead.
	 *
	 * Keyed on the laid-out set rather than on `people`: the refreshed data arrives before
	 * ELK has placed it, and a flash applied to a card that is not on the canvas yet would
	 * be wiped by the relayout that puts it there.
	 */
	useEffect(() => {
		if (!createdPersonId || phase !== "ready") return;
		void layoutEpoch;
		const added = [...people.values()].find((person) =>
			person.sources.some((source) => source.id === createdPersonId),
		);
		if (!added || !positionedRef.current.some((node) => node.id === added.id)) return;
		setCreatedPersonId(null);
		setNewId(added.id);
		// The framing effect, declared earlier, has already held the card for this layout.
		writeAnchor.current = null;
	}, [createdPersonId, phase, layoutEpoch, people]);

	useEffect(() => {
		if (!newId) return;
		const timer = window.setTimeout(() => setNewId(null), 2400);
		return () => window.clearTimeout(timer);
	}, [newId]);

	/*
	 * A strip belongs to the person whose card opened it, so selecting somebody else closes it.
	 *
	 * Left open it would still be anchored to the old card, but the handles have moved to
	 * another one, and a strip for one person beside the handles of another is two subjects on
	 * screen at once. The id is read in the body because identity change IS the trigger, the
	 * same pattern the detail panel uses.
	 */
	useEffect(() => {
		void viewedId;
		setStrip(null);
	}, [viewedId]);

	// The People tab covers the canvas; a strip left open would float over it, anchored to
	// a card nobody can see, and still accept a save.
	const showingDirectory = Boolean(directory);
	useEffect(() => {
		if (showingDirectory) setStrip(null);
	}, [showingDirectory]);
	// Opening a profile, from the `p` key or anywhere else, closes the strip: on a phone the
	// two share the bottom of the screen, and the strip painted over the sheet it opened.
	useEffect(() => {
		if (detailId) setStrip(null);
	}, [detailId]);

	/**
	 * Unfold whatever would hide the person just added.
	 *
	 * Adding a parent to somebody whose ancestors are folded, or a child or partner to somebody
	 * whose descendants are, writes a real row and then draws nothing: the fold hides it, the
	 * toast says it was added, and the canvas says it was not. Measured in the browser, that
	 * read exactly as a failed save. Folding descendants blocks the unions a person partners
	 * in, so a couple's child needs the PARTNER's fold opened too.
	 */
	const revealAdded = useCallback(
		(target: AddTarget) => {
			if (!viewedId) return;
			if (target.direction === "parent") {
				setCollapsed((current) =>
					current.ancestors.has(viewedId)
						? toggleCollapse(current, viewedId, "ancestors")
						: current,
				);
				return;
			}
			const partnerSource = affordances?.couples.find(
				(couple) => couple.unionId === target.unionId,
			)?.partnerSourceId;
			const partner = partnerSource ? sourceIndex.get(partnerSource)?.fusedId : undefined;
			const owners = partner ? [viewedId, partner] : [viewedId];
			setCollapsed((current) =>
				owners.reduce(
					(next, id) => (next.descendants.has(id) ? toggleCollapse(next, id, "descendants") : next),
					current,
				),
			);
		},
		[viewedId, affordances, sourceIndex, setCollapsed],
	);

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
		return neighbourhood(enabledEdges, revealedId, (id) => unionIds.has(id));
	}, [revealedId, unionIds, enabledEdges]);

	/**
	 * Apply focus and the depth tilt by rewriting className only. Deliberately its own
	 * effect: folding either into the layout's edge memo would re-run ELK on every hover
	 * (or on a purely visual toggle), and letting the layout pass write the flags meant
	 * a relayout WIPED them -- travel to a person, fold a branch, and the dim/lit state
	 * vanished until the next hover.
	 *
	 * Nodes only. Edge focus is applied in the derived `edges` memo below, so pushing it
	 * into state as well would store the same fact twice.
	 */
	useEffect(() => {
		// A trigger, not data: a relayout writes fresh base classNames, wiping these
		// flags, and nothing else in this array changes when that happens. Reading the
		// epoch is what makes the dependency honest rather than a suppression.
		void layoutEpoch;
		setNodes((current) =>
			current.map((node) => {
				// `kf-depth` tilts the CARD, never the pane: React Flow owns the wrapper's
				// transform for positioning, so a pane-level rotateX would leave the layout
				// and the picture disagreeing about where every node is.
				let next = withFlag("kf-depth", node.className, depth);
				// Three states, and the third is why `kf-lit` exists separately from the absence
				// of `kf-dim`. Dimming answers "not this one" for the rest of the tree; it cannot
				// answer "this one" when the lit neighbourhood is most of the canvas. The glow
				// marks the SUBJECT -- its relatives are already identified by the lines to it.
				next = withFlag("kf-dim", next, Boolean(lit) && !lit?.nodeIds.has(node.id));
				next = withFlag("kf-lit", next, node.id === revealedId);
				next = withFlag("kf-new", next, node.id === newId);
				next = withFlag("kf-updated", next, node.id === updatedId);
				next = withFlag("kf-leaving", next, node.id === leavingId);
				return next === node.className ? node : { ...node, className: next };
			}),
		);
	}, [lit, revealedId, depth, newId, updatedId, leavingId, layoutEpoch, setNodes]);

	// The sweep runs once; clearing the flag lets the next edit of the same card run it again.
	useEffect(() => {
		if (!updatedId) return;
		const timer = window.setTimeout(() => setUpdatedId(null), 1200);
		return () => window.clearTimeout(timer);
	}, [updatedId]);

	/*
	 * A deleted card stays shrunk until the refreshed graph has been laid out, then the flag
	 * goes whatever happened. Waiting for the fused id to vanish was not enough: deleting MY
	 * row of a person another family also records leaves their row under the same fused id,
	 * and that card stayed at opacity 0 for good.
	 */
	const leftAt = useRef<number | null>(null);
	useEffect(() => {
		if (!leavingId) {
			leftAt.current = null;
			return;
		}
		if (leftAt.current === null) leftAt.current = layoutEpoch;
		else if (layoutEpoch > leftAt.current) setLeavingId(null);
	}, [leavingId, layoutEpoch]);

	/*
	 * A pin or focus on somebody who is no longer in the graph -- deleted, or re-fused under
	 * another id when a link was accepted -- would leave every other card dimmed around a
	 * person who is not there, and a hover cannot lift a pin.
	 */
	useEffect(() => {
		if (pinnedId && !people.has(pinnedId)) setPinnedId(null);
		if (focusedId && !people.has(focusedId)) setFocusedId(null);
	}, [pinnedId, focusedId, people]);

	/** Keep the durable viewed state explicit in card data, selection and the overview. */
	useEffect(() => {
		void layoutEpoch;
		setNodes((current) =>
			current.map((node) => {
				if (node.type !== "person") return node;
				const isViewed = node.id === viewedId;
				const data = node.data as { isViewed?: boolean };
				const className = withFlag("kf-viewed", node.className, isViewed);
				const plainLabel = (node.ariaLabel ?? "").replace(/^Viewing, /, "");
				const ariaLabel = isViewed ? `Viewing, ${plainLabel}` : plainLabel;
				if (
					data.isViewed === isViewed &&
					node.selected === isViewed &&
					node.className === className &&
					node.ariaLabel === ariaLabel
				) {
					return node;
				}
				return {
					...node,
					selected: isViewed,
					className,
					ariaLabel,
					data: data.isViewed === isViewed ? node.data : { ...node.data, isViewed },
				};
			}),
		);
		setOverview(overviewNodes(positionedRef.current, selfId, viewedId ?? undefined));
	}, [layoutEpoch, selfId, setNodes, viewedId]);

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

	/** Clicking the empty canvas clears transient surfaces, never the durable viewed person. */
	const clear = useCallback(() => {
		setFocusedId(null);
		setPinnedId(null);
		setDetailId(null);
		// A tap on the canvas around an open strip dismisses it, which is why the strip needs no
		// close button of its own.
		setStrip(null);
		setNodes((current) =>
			current.map((node) => {
				const selected = node.type === "person" && node.id === viewedId;
				return node.selected === selected ? node : { ...node, selected };
			}),
		);
	}, [setNodes, viewedId]);

	/** Whether this viewer may write a person's own row: an edit strip, or only a profile. */
	const editable = useCallback(
		(personId: string) => {
			const person = people.get(personId);
			return Boolean(person && editTarget(person, editableTreeIds).editable);
		},
		[people, editableTreeIds],
	);

	/**
	 * A click focuses, PINS and names the person -- and on an editable canvas that is all.
	 *
	 * Pinning is what makes a revealed relation followable: without it the lines vanish the
	 * moment the pointer leaves the card.
	 *
	 * A family you can edit is built from the cards, so a tap PICKS somebody: they become the
	 * viewed person and their `+` handles appear, and nothing else opens. The profile used to
	 * open on every tap -- a panel of Family, About and Contact sections covering half a phone
	 * -- which put a box of sections between a person and their own handles. A second tap on
	 * the viewed card edits it in place; a person whose rows belong to another family opens
	 * their profile instead, since there is nothing of theirs to edit. A read-only canvas (the
	 * demo, an invited viewer) keeps tap-to-read: there are no handles to reach, and the
	 * profile is what a reader came for. Clicking the same card again there closes it.
	 *
	 * Union dots are skipped for the viewed person and the panel only: a junction is not
	 * somebody you can relate to, and making one the subject would put "Unknown" on the
	 * viewing docket. It still focuses, since hovering a dot lighting up the couple it joins
	 * is useful.
	 */
	const pick = useCallback(
		(event: unknown, node: Node) => {
			focus(event, node);
			if (node.type !== "person") {
				setPinnedId((current) => (current === node.id ? null : node.id));
				return;
			}

			if (!canEdit) {
				setPinnedId((current) => (current === node.id ? null : node.id));
				onViewedChange?.(node.id);
				setDetailId((current) => (current === node.id ? null : node.id));
				setTrail((current) => pushTrail(current, node.id));
				return;
			}

			if (node.id !== viewedId) {
				setPinnedId(node.id);
				onViewedChange?.(node.id);
				setDetailId(null);
				setTrail((current) => pushTrail(current, node.id));
				return;
			}

			// The second tap on the person already carrying the handles.
			setPinnedId(node.id);
			if (editable(node.id)) {
				setStrip((current) =>
					current?.kind === "edit" && current.personId === node.id
						? null
						: { kind: "edit", personId: node.id },
				);
			} else {
				setDetailId((current) => (current === node.id ? null : node.id));
			}
		},
		[focus, onViewedChange, canEdit, viewedId, editable, setTrail],
	);

	/**
	 * Collapse or expand the generation a card sits in.
	 *
	 * Addressed by the PEOPLE in the band rather than by a band index, because a band is a
	 * layout artefact: it exists only after ELK has run, and an index would point at a
	 * different row as soon as somebody added a great-grandparent.
	 */
	const foldGeneration = useCallback(() => {
		const anchor = viewedId ?? revealedId ?? selfNodeId;
		if (!anchor) return;

		const anchorNode = getNodes().find((node) => node.id === anchor);
		if (!anchorNode) return;

		const row = getNodes()
			.filter((node) => node.type === "person" && node.position.y === anchorNode.position.y)
			.map((node) => node.id);
		if (row.length > 0) setCollapsed((current) => collapseGeneration(current, row));
	}, [viewedId, revealedId, selfNodeId, getNodes, setCollapsed]);

	const onAction = useCallback(
		(action: ShortcutAction) => {
			switch (action) {
				case "search":
					onFocusSearch?.();
					break;
				case "fit":
					void fitView({ padding: FIT_PADDING, duration: travelDuration() });
					break;
				case "self":
					frameSelf();
					break;
				case "zoomIn":
					void zoomIn({ duration: travelDuration(160) });
					break;
				case "zoomOut":
					void zoomOut({ duration: travelDuration(160) });
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
				case "add":
					// The handles render in the viewport portal, AFTER every card in the DOM, so
					// Tab alone reaches them only after all 117 people. This is the keyboard's way
					// in; from the first handle, Tab walks the rest.
					document.querySelector<HTMLButtonElement>(".kf-node-add")?.focus();
					break;
				case "edit":
					// The keyboard's second tap: the edit strip on the viewed card, when it is yours.
					if (viewedId && canEdit && editable(viewedId)) {
						setStrip({ kind: "edit", personId: viewedId });
					}
					break;
				case "profile":
					// Taps no longer open the profile on an editable canvas, so it needs a key.
					if (viewedId) setDetailId((current) => (current === viewedId ? null : viewedId));
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
			viewedId,
			canEdit,
			editable,
			setCollapsed,
		],
	);

	useShortcuts(onAction);

	const detailPerson = detailId ? (people.get(detailId) ?? null) : null;

	/** The edit strip's person, and the point it grows from: the card's right edge. */
	const editPerson = strip?.kind === "edit" ? (people.get(strip.personId) ?? null) : null;
	const editBox =
		strip?.kind === "edit"
			? positionedRef.current.find((node) => node.id === strip.personId)
			: undefined;
	const editAnchor = editBox
		? { x: editBox.position.x + editBox.width, y: editBox.position.y + editBox.height / 2 }
		: null;

	/** Before a write: hold the viewed card where it is on screen through the relayout. */
	const holdViewed = () => {
		const held = positionedRef.current.find((node) => node.id === viewedId);
		if (held && viewedId) {
			writeAnchor.current = {
				id: viewedId,
				x: held.position.x,
				y: held.position.y,
				until: Date.now() + 8000,
			};
		}
	};
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

			<div
				className={cn("size-full", directory && "kf-canvas-hidden")}
				inert={Boolean(directory)}
				aria-hidden={Boolean(directory)}
			>
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
					<ZoomVariable />
					<GenerationRails bands={bands} />
					<NodeAddControls
						slots={slots}
						card={{
							...NODE_METRICS[lod],
							pill: lod === "compact" ? 18 : 22,
							// The household gap alignPedigreeRows packs with is 1.75x the level's gap;
							// a few pixels short of it keeps a side target off the next card. Each slot
							// narrows this further to the free space actually beside the card.
							reach: Math.round(NODE_METRICS[lod].gap * 1.75) - 6,
						}}
						openKey={strip?.kind === "add" ? strip.slot.key : null}
						// The open `+` is also its close: pressing it again folds the strip back in.
						onOpen={(slot) =>
							setStrip((current) =>
								current?.kind === "add" && current.slot.key === slot.key
									? null
									: { kind: "add", slot },
							)
						}
					/>

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
							<TravelButton
								onClick={() => void fitView({ padding: FIT_PADDING, duration: travelDuration() })}
							>
								<Maximize2 className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
								<span className="max-sm:sr-only">All</span>
							</TravelButton>

							{/*
							 * Back to yourself. The single most valuable control on a canvas 10760px wide,
							 * and the one thing a viewer cannot recover by gesture: pan far enough on a
							 * phone and every direction looks the same.
							 */}
							{viewedId && (
								<TravelButton onClick={frameViewed}>
									<LocateFixed className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
									<span className="max-sm:sr-only">Current</span>
								</TravelButton>
							)}

							{selfNodeId && selfNodeId !== viewedId && (
								<TravelButton onClick={frameSelf}>
									<Crosshair className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
									<span className="max-sm:sr-only">You</span>
								</TravelButton>
							)}
						</div>
					</Panel>
				</ReactFlow>
			</div>

			{directory}
			<OfflineNotice />

			{/* The mobile profile already names the current person. Hide the trail while it
			    is open so the selected card still fits above the sheet. */}
			<div
				className={cn(
					"pointer-events-none absolute left-3 top-3 z-20 flex min-w-0 max-w-[calc(100%_-_1.5rem)] justify-start",
					detailId && !directory && "hidden sm:flex",
					directory && "hidden",
				)}
			>
				<div className="pointer-events-auto min-w-0 max-w-full">
					<TreeBreadcrumbs trail={trailPeople} onGoTo={(id) => goToPerson(id)} />
				</div>
			</div>

			<PersonDetail
				person={detailPerson}
				index={relativeIndex}
				kinship={kinship}
				editableTreeIds={editableTreeIds}
				onCenter={detailPerson ? () => travelTo(detailPerson.id) : undefined}
				// Re-read from the server rather than patching locally: the write happened there, so
				// there is what knows the new graph -- and fusion, kinship and layout all derive
				// from it.
				onSaved={() => router.refresh()}
				onClose={() => setDetailId(null)}
				// Travelling from the panel keeps the panel open on the NEW person, which is what
				// makes it a way to walk the family: parents to their parents to their siblings.
				onGoTo={(id) => goToPerson(id, true)}
			/>

			{/*
			 * The one strip, mounted ONCE here rather than per card, inside a presence so it
			 * folds back into the control that opened it when it closes.
			 *
			 * `router.refresh()` on success rather than a local mutation: the write happened on
			 * the server, so the server is what knows the new graph -- and re-deriving fusion,
			 * kinship and layout from a client-side guess is how the canvas and the database
			 * start disagreeing.
			 */}
			<AnimatePresence>
				{strip?.kind === "add" && (
					<NodeAddStrip
						key={`add:${strip.slot.key}`}
						slot={strip.slot}
						onDone={({ id, name }) => {
							holdViewed();
							// Remembered for the layout that contains them: they come out of this `+`.
							if (id) {
								pendingBirth.current = {
									personId: id,
									from: { x: strip.slot.x, y: strip.slot.y },
								};
							}
							revealAdded(strip.slot.target);
							setSavedName(name);
							setCreatedPersonId(id ?? null);
							router.refresh();
						}}
						onFailed={setFailure}
						onClose={() => setStrip(null)}
					/>
				)}
				{strip?.kind === "edit" && editPerson && editAnchor && (
					<NodeEditStrip
						key={`edit:${strip.personId}`}
						person={editPerson}
						editableTreeIds={editableTreeIds}
						anchor={editAnchor}
						side="right"
						onSaved={(change) => {
							if (change === "updated") {
								// A new birth year reorders siblings, so an edit can move cards too.
								holdViewed();
								setUpdatedId(strip.personId);
							}
							router.refresh();
						}}
						onLeaving={(leaving) => setLeavingId(leaving ? strip.personId : null)}
						onFailed={setFailure}
						onProfile={() => {
							setStrip(null);
							setDetailId(strip.personId);
						}}
						onClose={() => setStrip(null)}
					/>
				)}
			</AnimatePresence>
			<AnimatePresence>
				{savedName && (
					<motion.p
						role="status"
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2 }}
						className={cn(
							"pointer-events-none absolute left-1/2 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2",
							"rounded-xl border border-hairline-strong bg-surface px-4 py-3 text-center text-sm text-ink",
							toastPlace,
						)}
					>
						{savedName} is now part of your family tree.
					</motion.p>
				)}
				{/* A write that failed after its strip was closed: nowhere else would say so. */}
				{failure && (
					<motion.p
						role="alert"
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2 }}
						className={cn(
							"pointer-events-none absolute left-1/2 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2",
							"rounded-xl border border-danger/40 bg-surface px-4 py-3 text-center text-sm text-danger",
							toastPlace,
						)}
					>
						{failure}
					</motion.p>
				)}
			</AnimatePresence>

			<ShortcutSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
		</>
	);
}

/**
 * One of the travel buttons in the bottom-right corner.
 *
 * Icons only on a phone: with their labels the row was about 240px of a 375px canvas, plus
 * the Map toggle beside it, and a tap on a card underneath went to a button instead. The
 * label stays in the accessible name, so nothing is lost to a screen reader.
 */
function TravelButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"kf-glass pointer-events-auto flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-3 max-sm:px-0",
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
 * The live zoom, published to CSS as `--kf-zoom` on the viewport.
 *
 * Every node is inside the scaled viewport, so a control sized in CSS pixels is NOT that
 * size on screen: a `size-11` (44px) fold button measured 35px at 0.785 zoom and would be
 * 7px at the 0.15 floor. A touch target has to clear 44 SCREEN pixels, so the only honest
 * way to size one inside a transformed layer is to divide by the scale it is about to be
 * multiplied by -- which means CSS needs the number.
 *
 * A custom property rather than a prop, for the reason the pointer wash is: a prop would
 * re-render every node on every wheel tick, and React Flow answers a render by
 * re-measuring. And a component of its own, because the subscription re-renders whoever
 * holds it on every zoom frame: held by the canvas, that was the whole 1,900-line canvas
 * and its unmemoised panels, once per frame of every pinch.
 */
function ZoomVariable() {
	const zoom = useStore((state) => state.transform[2]);
	useEffect(() => {
		// On the viewport itself, which is the element the nodes live inside, so the value is
		// in scope for every card without threading a ref through ReactFlow (which does not
		// forward one).
		document
			.querySelector<HTMLElement>(".react-flow__viewport")
			?.style.setProperty("--kf-zoom", String(zoom));
	}, [zoom]);
	return null;
}

/**
 * Canvas state that must outlive the provider remount below.
 *
 * The provider is keyed by detail level and arrangement, so pressing `d` or switching to
 * orbit builds a fresh canvas. Folds and the visited trail lived inside it, so that
 * silently unfolded every branch and reset the breadcrumbs to one name -- while the viewed
 * person, lifted to the stage for exactly this remount, survived it. Both are held here,
 * above the key.
 */
type Held = {
	collapsed: Collapsed;
	setCollapsed: Dispatch<SetStateAction<Collapsed>>;
	trail: string[];
	setTrail: Dispatch<SetStateAction<string[]>>;
};

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
	const [collapsed, setCollapsed] = useState<Collapsed>(NOTHING_COLLAPSED);
	const [trail, setTrail] = useState<string[]>(() => (props.viewedId ? [props.viewedId] : []));
	const held = useMemo(() => ({ collapsed, setCollapsed, trail, setTrail }), [collapsed, trail]);
	return (
		<ReactFlowProvider key={`${props.lod ?? "full"}:${props.view ?? "tree"}`}>
			<Canvas {...props} held={held} />
		</ReactFlowProvider>
	);
}
