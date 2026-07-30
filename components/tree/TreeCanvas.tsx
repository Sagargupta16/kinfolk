"use client";

/**
 * The canvas. Owns layout-on-data-change and nothing else; all graph maths
 * lives in lib/tree so it stays testable.
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
import { Crosshair } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Degree } from "@/lib/tree/density";
import {
	displayName,
	type FlowEdge,
	type FlowNode,
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
import { siblingBars } from "@/lib/tree/siblings";
import { cn } from "@/lib/utils";
import { FamilyEdge } from "./FamilyEdge";
import { GenerationRails } from "./GenerationRails";
import { PersonNode, UnionNode } from "./PersonNode";
import { TreeMinimap } from "./TreeMinimap";

const nodeTypes = { person: PersonNode, union: UnionNode };
const edgeTypes = { family: FamilyEdge };

/**
 * Per-generation entrance delay.
 *
 * Cards fade in oldest row first, so the tree assembles downwards the way it is
 * read. Staggering by generation rather than by node index is what makes it look
 * like structure appearing instead of a list loading.
 */
const ROW_STAGGER_MS = 70;
/** Ceiling on the stagger: a deep tree must not take a second to appear. */
const MAX_STAGGER_MS = 420;

/**
 * Zoom below which each level of detail stops being worth reading, per LOD.
 *
 * Framing refuses to fit the whole tree under this floor: a whole tree rendered
 * too small to read is strictly worse than the part of one you can.
 *
 * The floor has to vary, because what "legible" means varies. A card's 11px
 * metadata dies around 0.55. A dot has no text at all, so the only question is
 * whether it is still a visible mark -- and at 0.18 a 16px node is a ~3px dot,
 * which is exactly the density a 117-person overview needs. Holding dots to the
 * card's floor would refuse to ever fit the tree it exists to show.
 */
const LEGIBLE_ZOOM: Record<Lod, number> = {
	full: 0.55,
	compact: 0.45,
	dot: 0.18,
};

/**
 * Zoom limits, named because the legibility guard has to use the same numbers the
 * canvas does. Inline on `<ReactFlow>` they could drift from the maths that
 * predicts what a fit will produce.
 */
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 1.8;

/** Breathing room round a fit, as React Flow's own fraction-of-viewport padding. */
const FIT_PADDING = 0.2;
/** More, for a household: a few cards centred in a bare viewport reads as an error. */
const HOUSEHOLD_PADDING = 0.3;

/**
 * How much viewport a fit actually gets to use, once padding is taken out.
 *
 * Reproduces `parsePadding` from @xyflow/system exactly, including the floor and
 * the doubling for both sides. Without it the legibility guard divides by the RAW
 * viewport while `fitView` divides by the padded one, so the guard overestimates
 * the zoom by the padding factor -- 1.2x here, 1.3x for a household -- and waves
 * through fits that render below the floor it exists to enforce. Which is worst on
 * a phone, where padding is the largest share of the viewport.
 */
function usable(viewport: number, padding: number): number {
	return viewport - Math.floor((viewport - viewport / (1 + padding)) * 0.5) * 2;
}

/**
 * Which generation a y coordinate belongs to, for the entrance stagger.
 *
 * Nearest band rather than exact match, because a union dot sits BETWEEN two
 * rows and belongs to neither. Keying on equality would give every dot delay 0
 * and they would all pop in ahead of the couples they join.
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
 * Starting false is the safe default -- a mouse gets the richer behaviour, and a
 * phone loses it for one frame.
 */
function useCoarsePointer(): boolean {
	const [coarse, setCoarse] = useState(false);

	useEffect(() => {
		const query = window.matchMedia("(pointer: coarse)");
		setCoarse(query.matches);

		// Subscribed, not sampled once: a tablet with a keyboard attached switches
		// pointer type without a reload.
		const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	return coarse;
}

/**
 * The unions in a projected graph, for the sibling-bar pass.
 *
 * Read back off the union NODES rather than passed alongside them: the canvas is
 * handed `FlowNode[]` and a union node already carries its own row, so a second
 * prop would be the same data arriving twice with no guarantee the two agree.
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
	 * Layout needs them even when they are not drawn: `anchorFamilylessNodes()` finds
	 * a person with no family by following who they know, so filtering them out here
	 * would put those people in ELK's first layer and invent a generation above the
	 * oldest ancestor. `showRelations` decides what is DRAWN, nothing more.
	 */
	edges: FlowEdge[];
	/** False draws the bare family skeleton, at identical positions. */
	showRelations?: boolean;
	/** Person id to highlight as the viewer. */
	selfId?: string;
	/** How much of each person to draw. Changes node size, so it re-runs layout. */
	lod?: Lod;
	/**
	 * A person to travel to, set by search. An object rather than a bare id so
	 * asking for the SAME person twice still moves: after panning away, searching
	 * the name you just searched has to bring you back, and a plain string would
	 * compare equal and do nothing.
	 */
	goTo?: { id: string } | null;
	/**
	 * How connected each person is, keyed by fused node id.
	 *
	 * Passed in rather than computed here because search ranks by it too, and two
	 * memos over 151 nodes would be the same work for the same answer.
	 */
	degree: Map<string, Degree>;
	/**
	 * What each person is to the viewer, keyed by fused node id. See
	 * lib/tree/kinship.ts.
	 *
	 * Computed on the server with the rest of the view, because it needs the whole
	 * graph: the ancestor walk from both ends is what turns two paths into "second
	 * cousin once removed", and a card holding one person cannot do it.
	 */
	kinship?: Map<string, Kinship>;
	/**
	 * Called with the person whose card was clicked, so the editor can pre-fill its
	 * "from" field.
	 *
	 * Clicking already sets hover focus (there is no hover on a phone), so this rides the
	 * same handler rather than adding a second gesture -- naming somebody you can see is
	 * exactly what a click on their card should mean.
	 */
	onPick?: (person: { id: string; name: string } | null) => void;
};

function Canvas({
	nodes: sourceNodes,
	edges: sourceEdges,
	showRelations = true,
	selfId,
	lod = "full",
	goTo,
	degree,
	kinship,
	onPick,
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
	 * render of the panel, and React Flow's bounds are only correct once every node
	 * has been measured -- which is the frame after. Sizing on stale bounds gave the
	 * card view the dot view's ratio for one paint, a visible jump in the corner.
	 */
	const [extent, setExtent] = useState<Box>({ x: 0, y: 0, width: 0, height: 0 });
	/**
	 * The tree as coloured boxes for the overview, derived alongside the layout.
	 *
	 * Not from `nodes`: hover focus rewrites every node's className, so a memo over the
	 * live array would rebuild 151 rectangles on each mouse move to redraw the identical
	 * picture. Positions are the only input the map has, and they change here.
	 */
	const [overview, setOverview] = useState<OverviewNode[]>([]);
	/**
	 * Bumped once per completed layout, and the only thing framing keys off.
	 *
	 * Deliberately not `nodes`: hover focus rewrites className via setNodes, so the
	 * array gets a new identity on every mouse move. Framing on that refits the
	 * viewport mid-hover, throwing away the zoom the viewer chose -- and the
	 * resulting pan slides the card out from under the cursor, which fires
	 * mouseleave and cancels the focus that caused it.
	 */
	const [layoutEpoch, setLayoutEpoch] = useState(0);
	/**
	 * The epoch already framed, so each layout is framed exactly once.
	 *
	 * The dependency array cannot express this on its own. Framing needs the current
	 * viewport size, and `frameSelf` closes over it too, so BOTH the raw dimensions
	 * and the callback's identity change on every resize -- and on a phone the URL
	 * bar collapsing is a resize, mid-gesture. Measured: zoomed to 0.95, changed
	 * height by 22px, and the viewport snapped back to the opening 0.66. A ref
	 * compares against the thing framing is actually about (new positions to show)
	 * rather than the things it merely reads.
	 */
	const framedEpoch = useRef(0);
	// `getNodesBounds` from the hook, not the standalone export: the bare function
	// has no node lookup and warns on every call.
	const { fitView, getNodesBounds, getNodes, setCenter, getZoom } = useReactFlow();

	// True only once React Flow has measured every node, which it cannot do while
	// the container is 0x0 (hidden tab, pane not yet laid out). Framing on rAF
	// instead would silently no-op in that window and never retry.
	const measured = useNodesInitialized();

	// Container size, read from the store rather than measured here: framing has to
	// know whether the tree fits BEFORE it decides how to frame, and subscribing
	// means a rotated phone reframes.
	const viewportWidth = useStore((state) => state.width);
	const viewportHeight = useStore((state) => state.height);

	// The person whose social links are lit up. Relation edges cannot be hovered
	// themselves: they render above the cards so their labels stay readable, which
	// means they must not intercept pointer events.
	//
	// It is also what DRAWS the relation overlay at all -- see `revealedIds`. Focus used
	// to only change the styling of lines that were already on screen; now it decides
	// whether they are on screen.
	const [focusedId, setFocusedId] = useState<string | null>(null);
	/**
	 * The person whose relations are pinned open, set by clicking a card.
	 *
	 * Separate from `focusedId` because hover is a glance and a click is a decision: a
	 * hover reveal vanishes the moment you move towards the line you wanted to read,
	 * which on a canvas this wide makes a long relation impossible to follow. A pinned
	 * person survives the pointer leaving, so you can trace the edge to its other end.
	 *
	 * On a phone there is no hover at all, so this is the ONLY way relations appear --
	 * which is why it rides the existing tap handler rather than adding a gesture.
	 */
	const [pinnedId, setPinnedId] = useState<string | null>(null);

	// Cards are draggable with a mouse and not with a finger. On a phone a card is
	// most of the screen, so a swipe that starts on one has to pan the canvas -- and
	// dragging is an editing gesture with nowhere to save to yet, where panning is
	// the only way to read a tree wider than the screen.
	const coarsePointer = useCoarsePointer();

	/**
	 * The viewer's immediate family, for framing when the tree cannot fit legibly.
	 *
	 * FAMILY edges only. Traversing social edges too would drag in a friend of a
	 * friend on the far side of the canvas and the "immediate family" box would span
	 * the whole tree -- which is the very thing the fallback exists to avoid.
	 */
	const homeIds = useMemo(() => {
		if (!selfId) return null;
		const unionIds = new Set(sourceNodes.filter((n) => n.type === "union").map((n) => n.id));
		const familyEdges = sourceEdges.filter((edge) => edge.layout);
		return neighbourhood(familyEdges, selfId, (id) => unionIds.has(id)).nodeIds;
	}, [selfId, sourceNodes, sourceEdges]);

	/**
	 * The edges the viewer has ENABLED, which is not the same set the layout gets and
	 * not the same set that gets drawn.
	 *
	 * `layoutGraph` keeps reading `sourceEdges`, so toggling the overlay changes what
	 * you see without moving a single card. What is actually rendered is narrower still
	 * -- see `revealedRelations` below.
	 */
	const enabledEdges = useMemo(
		() => visibleEdges(sourceEdges, showRelations),
		[sourceEdges, showRelations],
	);

	/**
	 * Whose relations are currently revealed: the pinned person, else the hovered one.
	 *
	 * Pin wins over hover so that moving the pointer towards a revealed line does not
	 * destroy the thing you were reaching for.
	 */
	const revealedId = pinnedId ?? focusedId;

	/**
	 * The relation edges to actually DRAW -- only those touching the revealed person.
	 *
	 * This is the rework, and it is a deletion rather than a restyling. Measured on the
	 * sample graph before it: the 52 relation edges accounted for 73% of all edge ink at
	 * a median span of 2214px, against the family skeleton's median of 69px -- a 32x
	 * ratio. Fifty-two lines crossing the entire canvas is the haze the cards sat in, and
	 * no colour or weight could fix it, because the problem was never how the lines were
	 * drawn. It was that they were drawn at all, permanently, for a property almost
	 * nobody has: the median person has ONE relation and 56 of 120 have none.
	 *
	 * A relation is a per-person fact, so it is answered per person. At rest the canvas
	 * is the family skeleton, which is the structure the layout actually encodes; focus
	 * somebody and their world appears around them. Nothing is lost -- every edge is
	 * still reachable, and now legible when it arrives instead of being one of fifty-two
	 * identical diagonals.
	 *
	 * This also retires `is-far`: distance-fading existed solely to mitigate the
	 * always-on overlay, and a revealed edge should be drawn at full strength however
	 * far it reaches, because the viewer just asked for exactly that line.
	 */
	const revealedRelations = useMemo(() => {
		if (!revealedId) return [];
		return enabledEdges.filter(
			(edge) =>
				edge.kind === "relation" && (edge.source === revealedId || edge.target === revealedId),
		);
	}, [enabledEdges, revealedId]);

	/**
	 * The FAMILY skeleton as React Flow edges, and the only edge memo layout may depend on.
	 *
	 * Split from the relations deliberately. The layout effect depends on this memo, so
	 * anything in it re-runs ELK when it changes -- and revealing relations changes with
	 * every hover. Folding the two together would re-lay out the entire graph on each
	 * mouse move, which is the same trap documented for the focus effect below.
	 */
	const familyFlowEdges = useMemo<Edge[]>(
		() =>
			// From `enabledEdges`, NOT `drawnEdges`: the latter narrows with the hovered
			// person, so depending on it here would give this memo a new identity on every
			// mouse move -- and the layout effect depends on this memo, so ELK would re-run
			// for the entire graph each time the pointer crossed a card. The family skeleton
			// does not change with focus anyway, which is the whole reason it is split out.
			enabledEdges
				.filter((edge) => edge.kind !== "relation")
				.map((edge) => ({
					id: edge.id,
					source: edge.source,
					target: edge.target,
					// Our own type, purely so the path can carry pathLength={1} for the
					// draw-on animation. Same route smoothstep produces.
					type: "family",
					className: edge.kind === "partner" ? "is-partner" : undefined,
				})),
		[enabledEdges],
	);

	/**
	 * The revealed relations as React Flow edges.
	 *
	 * Already narrowed to the revealed person, so this is at most a handful of lines
	 * rather than the whole overlay -- the p90 person has three.
	 */
	const relationFlowEdges = useMemo<Edge[]>(
		() =>
			revealedRelations.map((edge) => ({
				id: edge.id,
				source: edge.source,
				target: edge.target,
				// Curved, not orthogonal: social edges cut across the generation
				// grid, and a curve reads as "not part of the skeleton".
				// "default" IS React Flow's bezier renderer -- there is no edge type
				// named "bezier", and asking for one silently falls back to this
				// same renderer while logging a warning on every edge.
				type: "default",
				label: edge.label,
				// Otherwise React Flow announces the literal "Edge from <id> to
				// <id>", reading fused ids aloud. The label is the fact.
				ariaLabel: edge.label,
				className: [
					"is-relation",
					`is-${edge.relationKind}`,
					`is-close-${edge.closeness ?? 1}`,
					edge.ended ? "is-ended" : "",
					// Direction is a TAPERED stroke now, not an arrowhead -- see the
					// `.is-directed` rules in globals.css for why the marker was removed.
					// A class rather than a `markerEnd` so the state stays in the cascade
					// with the edge's other five, and so it composes with is-active and
					// is-ended instead of being an inline style neither can reach.
					edge.directed ? "is-directed" : "",
					// Every revealed relation draws itself on. Cheap now that there are at
					// most a handful: as an always-on overlay this would have been 52
					// simultaneous animations, so the reveal is what makes the motion
					// affordable as well as legible.
					"kf-reveal",
				]
					.filter(Boolean)
					.join(" "),
				// Above the cards, because a label pinned to a curve's midpoint
				// otherwise gets painted over by whatever card it passes behind.
				// Safe only because the line itself is a thin dash: it reads
				// as an overlay and never competes with the family skeleton.
				zIndex: 1001,
			})),
		[revealedRelations],
	);

	useEffect(() => {
		let cancelled = false;

		// ELK is async and imported lazily, so a fast second data change can
		// resolve out of order. The flag drops stale layouts.
		void layoutGraph(sourceNodes, sourceEdges, lod).then(
			({ nodes: positioned, bands: rows, extent: box }) => {
				if (cancelled) return;

				/** Entrance delay per node id, reused below to time the edges. */
				const delays = new Map<string, number>();
				for (const node of positioned) {
					delays.set(
						node.id,
						Math.min(rowFor(node.position.y, rows) * ROW_STAGGER_MS, MAX_STAGGER_MS),
					);
				}

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
									}
								: node.data,
						// Name, relationship and dates, which is what the card shows. Never a
						// contact value: an accessible name is MORE exposed than the visible
						// card, so it must not become the back door PersonNode refuses to be.
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
						// Union dots are structural, not content; dragging them would
						// desync the layout from the data. Nothing is draggable by
						// finger, so a swipe from anywhere pans.
						draggable: node.type === "person" && !coarsePointer,
						// The animation itself is CSS (see globals.css); React Flow owns
						// the node's transform, so a JS-driven entrance would fight it.
						className: "kf-enter",
						style: { "--kf-delay": `${delays.get(node.id) ?? 0}ms` } as CSSProperties,
					})),
				);

				/**
				 * Sibling bars, and which child edge of each family draws the horizontal run.
				 *
				 * The election is by lowest edge id rather than by position, so it is stable
				 * across relayouts: picking (say) the leftmost child would hand the bar to a
				 * different edge whenever ELK reorders siblings, and the draw-on animation
				 * would restart on an edge that had not changed.
				 */
				const bars = siblingBars(unionsOf(sourceNodes), positioned);
				const barDrawer = new Map<string, string>();
				for (const edge of familyFlowEdges) {
					if (!bars.has(edge.source)) continue;
					const current = barDrawer.get(edge.source);
					if (!current || edge.id < current) barDrawer.set(edge.source, edge.id);
				}

				// Each family edge draws itself on just after the node it descends FROM has
				// landed, so the skeleton grows downwards with the cards rather than being
				// there waiting for them.
				//
				// Only family edges are set here. Relations are appended by their own effect
				// below, because they change on hover and this one runs ELK.
				setFamilyEdges(
					familyFlowEdges.map((edge) => {
						const delay = (delays.get(edge.source) ?? 0) + ROW_STAGGER_MS;
						const bar = bars.get(edge.source);
						return {
							...edge,
							...(bar
								? {
										data: {
											barY: bar.y,
											barLeft: bar.left,
											barRight: bar.right,
											drawsBar: barDrawer.get(edge.source) === edge.id,
										},
									}
								: {}),
							className: withFlag("kf-draw", edge.className, true),
							style: { ...edge.style, "--kf-delay": `${delay}ms` } as CSSProperties,
						};
					}),
				);
				setBands(rows);
				setExtent(box);
				setOverview(overviewNodes(positioned, selfId));
				setLayoutEpoch((epoch) => epoch + 1);
			},
		);

		return () => {
			cancelled = true;
		};
	}, [
		sourceNodes,
		sourceEdges,
		// The FAMILY edges only. Depending on the relation memo here would re-run ELK on
		// every hover, since revealing a person's relations changes it.
		familyFlowEdges,
		selfId,
		lod,
		degree,
		kinship,
		coarsePointer,
		setNodes,
		setFamilyEdges,
	]);

	/**
	 * Put the viewer's own household on screen at a readable zoom.
	 *
	 * Extracted from the framing effect so the "find me" button can re-run exactly
	 * what the first frame did. Two implementations of "where am I" would drift, and
	 * the whole value of the button is that it returns you to a known view.
	 */
	const frameSelf = useCallback(() => {
		const nodes = getNodes();
		const anchor = nodes.find((node) => (node.data as { isSelf?: boolean }).isSelf) ?? nodes[0];
		if (!anchor) return;

		// Their household rather than their card alone -- a single card centred in an
		// empty viewport says nothing about where you are in the tree, whereas
		// parents, partner and children are the answer to "who is this".
		//
		// But fitting the household's BOUNDS is not the same as showing the
		// household. ELK places a large sibship above its own descendant subtrees, so
		// the box round a person's parents and siblings can span most of the canvas:
		// measured on the sample data, 52 of 117 people have a household wider than a
		// phone can render legibly. Fitting that box just reproduces the unreadable
		// zoom this branch exists to avoid.
		//
		// So centre on the PERSON at a fixed legible zoom and let the household fill
		// whatever the viewport holds. Guarantees legibility for everyone, where
		// fitting bounds only guarantees it for people with small families.
		const household = nodes.filter((node) => homeIds?.has(node.id));
		if (household.length > 1) {
			const bounds = getNodesBounds(household);
			const householdZoom = Math.min(
				usable(viewportWidth, HOUSEHOLD_PADDING) / (bounds.width || 1),
				usable(viewportHeight, HOUSEHOLD_PADDING) / (bounds.height || 1),
			);

			if (householdZoom >= LEGIBLE_ZOOM[lod]) {
				// Capped at 1:1. `fitView` scales UP to fill, so a household of five on a
				// 1440px screen opened at 1.72x -- five cards magnified past the size they
				// were designed at, with 146 relatives off screen. At 1:1 the same five
				// are centred and the leftover room fills with the family around them,
				// which is what a wider screen should buy.
				void fitView({
					padding: HOUSEHOLD_PADDING,
					duration: 400,
					nodes: household,
					maxZoom: 1,
				});
				return;
			}

			// The metrics rather than 0 as the fallback: `measured` should be set by
			// now (the framing effect waits on useNodesInitialized), but an unmeasured
			// node would otherwise centre on the card's top-left corner and put the
			// person half a card off-centre, which on a phone is most of the screen.
			const metrics = NODE_METRICS[lod];
			void setCenter(
				anchor.position.x + (anchor.measured?.width ?? metrics.width) / 2,
				anchor.position.y + (anchor.measured?.height ?? metrics.height) / 2,
				{ zoom: LEGIBLE_ZOOM[lod], duration: 400 },
			);
			return;
		}

		// Nobody to show them with, so keep them at their designed size rather than
		// blowing one card up to fill the viewport.
		void fitView({ padding: 1.6, duration: 400, nodes: [anchor], maxZoom: 1 });
	}, [homeIds, lod, viewportWidth, viewportHeight, fitView, getNodes, getNodesBounds, setCenter]);

	// Frame the graph once the nodes it contains have actually been measured. Keyed
	// on layoutEpoch, so switching between combined and mine-only refits but a
	// hover does not.
	useEffect(() => {
		if (!measured || layoutEpoch === 0) return;

		// Once per layout, whatever else in the array changed. The `You` button is how
		// a viewer asks to be re-framed; nothing else should decide for them.
		if (framedEpoch.current === layoutEpoch) return;
		framedEpoch.current = layoutEpoch;

		// Read nodes imperatively rather than depending on them, for the reason
		// layoutEpoch exists.
		const nodes = getNodes();
		if (nodes.length === 0) return;

		// Would fitting the whole tree push it below the legibility floor? On a phone
		// a four-generation tree does, and the result shows the shape of the family
		// with none of the names. So check the zoom the fit WOULD use rather than
		// trusting fitView's own clamp, which reports success either way.
		const bounds = getNodesBounds(nodes);
		const fitZoom = Math.min(
			usable(viewportWidth, FIT_PADDING) / (bounds.width || 1),
			usable(viewportHeight, FIT_PADDING) / (bounds.height || 1),
		);

		if (fitZoom >= LEGIBLE_ZOOM[lod]) {
			void fitView({ padding: FIT_PADDING, duration: 400 });
			return;
		}

		// Too big to fit legibly: open on the viewer instead and let them pan or
		// collapse to dots.
		frameSelf();
	}, [
		measured,
		layoutEpoch,
		viewportWidth,
		viewportHeight,
		lod,
		frameSelf,
		fitView,
		getNodesBounds,
		getNodes,
	]);

	/**
	 * Travel to a searched person: centre them, select them, light their links.
	 *
	 * All three, because arriving is not the same as finding. A viewport that has
	 * moved leaves you looking at a wall of cards with no idea which one you asked
	 * for, so the card is selected (an accent ring) and its relations are focused --
	 * exactly the state hovering it would produce.
	 *
	 * `setCenter` rather than `fitView` on one node: fitting a single card zooms it
	 * to fill the viewport and throws away the relatives that answer "who is this".
	 * The zoom is only raised to the legibility floor, never lowered, so arriving
	 * never undoes a viewer's deliberate zoom-in.
	 */
	useEffect(() => {
		if (!goTo || !measured) return;

		const target = getNodes().find((node) => node.id === goTo.id);
		if (!target) return;

		// The zoom is READ here rather than subscribed to. Depending on the live value
		// would re-run this effect on every wheel tick and yank the viewport back to
		// the last search hit.
		const metrics = NODE_METRICS[lod];
		void setCenter(
			target.position.x + (target.measured?.width ?? metrics.width) / 2,
			target.position.y + (target.measured?.height ?? metrics.height) / 2,
			{ zoom: Math.max(getZoom(), LEGIBLE_ZOOM[lod]), duration: 400 },
		);

		setFocusedId(goTo.id);
		// Pinned as well as focused: there is no pointer on the card you just travelled to,
		// so without the pin a searched person would arrive with their relations hidden --
		// and "who is this person connected to" is usually why you searched them.
		setPinnedId(goTo.id);
		setNodes((current) =>
			current.map((node) => {
				const selected = node.id === goTo.id;
				return node.selected === selected ? node : { ...node, selected };
			}),
		);
	}, [goTo, measured, lod, getNodes, getZoom, setCenter, setNodes]);

	// Who lights up when somebody is focused. Traverses through union dots, so
	// hovering a parent reaches their partner and children rather than stopping at
	// the junction between them.
	//
	// Over the ENABLED edges, not the drawn ones. `drawnEdges` is now itself derived from
	// the focus, so traversing it would make the highlight depend on its own output: the
	// relations revealed BY focusing somebody are exactly the ones that then need lighting.
	// The toggle is still respected, since switching the overlay off empties it here too.
	//
	// Keyed on `revealedId`, the same value the reveal uses -- not on `focusedId`. Once a
	// person is pinned and the pointer moves away, their lines are still on screen, and
	// lighting keyed on hover alone would leave those lines drawn with nothing lit and
	// every card dimmed around them.
	const lit = useMemo(() => {
		if (!revealedId) return null;
		const unionIds = new Set(sourceNodes.filter((n) => n.type === "union").map((n) => n.id));
		return neighbourhood(enabledEdges, revealedId, (id) => unionIds.has(id));
	}, [revealedId, sourceNodes, enabledEdges]);

	// Apply focus by rewriting className only. Deliberately its own effect:
	// folding focus into the layout's edge memo would re-run ELK on every hover, since
	// the layout effect depends on that memo.
	//
	// Nodes only. Edge focus used to be applied here too, by rewriting the class on every
	// edge in state; now the rendered edge array is DERIVED (see `edges` below), so
	// pushing focus into state as well would be the same fact stored twice.
	useEffect(() => {
		setNodes((current) =>
			current.map((node) => {
				// Three states, and the third is why `kf-lit` exists separately from the
				// absence of `kf-dim`. Dimming answers "not this one" for the rest of the
				// tree; it cannot answer "this one" when the lit neighbourhood is most of the
				// canvas, because then there is hardly anything dimmed to stand out from. The
				// glow marks the SUBJECT, so only the focused card gets it -- its relatives
				// are already identified by the lines running to it.
				let next = withFlag("kf-dim", node.className, Boolean(lit) && !lit?.nodeIds.has(node.id));
				next = withFlag("kf-lit", next, node.id === focusedId);
				return next === node.className ? node : { ...node, className: next };
			}),
		);
	}, [lit, focusedId, setNodes]);

	/**
	 * What React Flow actually renders: the laid-out skeleton, plus the revealed
	 * relations, with focus applied.
	 *
	 * Derived rather than stored, and that is the point of the split. The skeleton keeps
	 * the positions and draw-on delays ELK gave it, the relations come and go with the
	 * pointer, and neither has to write to the other. Focus is applied here too, so a
	 * hover costs one array rebuild instead of a state write per edge.
	 *
	 * Relations come SECOND so they paint over the skeleton, which is what their
	 * `zIndex: 1001` already asks for -- and DOM order is the tiebreak React Flow
	 * actually uses within a z-index.
	 */
	const edges = useMemo<Edge[]>(() => {
		const focusApplied = (edge: Edge): Edge => {
			// Two flags, because an edge has three states: lit, untouched, and dimmed
			// because attention is elsewhere.
			const active = Boolean(lit?.edgeIds.has(edge.id));
			let next = withFlag("is-active", edge.className, active);
			next = withFlag("kf-dim", next, Boolean(lit) && !active);
			return next === edge.className ? edge : { ...edge, className: next };
		};
		return [...familyEdges.map(focusApplied), ...relationFlowEdges.map(focusApplied)];
	}, [familyEdges, relationFlowEdges, lit]);

	// Tap counts as well as hover: on a phone there is no hover, and a tap that
	// only selects a card would leave the labels unreachable.
	const focus = useCallback((_: unknown, node: Node) => setFocusedId(node.id), []);
	const blur = useCallback(() => setFocusedId(null), []);

	/**
	 * Clicking the empty canvas clears both the hover and the pin.
	 *
	 * The pin has to be clearable by a gesture a viewer will find without being told, and
	 * "click away to stop looking at this" is the one every canvas already uses.
	 */
	const clear = useCallback(() => {
		setFocusedId(null);
		setPinnedId(null);
	}, []);

	/**
	 * A click focuses, PINS, and NAMES the person.
	 *
	 * Pinning is what makes a revealed relation followable: without it the lines vanish
	 * the moment the pointer leaves the card, so a relation crossing the canvas could
	 * never be traced to its far end. Clicking the same card again unpins, so the gesture
	 * is its own undo.
	 *
	 * Union dots are skipped for the NAMING only: a junction is not somebody you can
	 * relate to, and reporting one would put "Unknown" in a picker. It still focuses,
	 * since hovering a dot lighting up the couple it joins is useful.
	 */
	const pick = useCallback(
		(event: unknown, node: Node) => {
			focus(event, node);
			setPinnedId((current) => (current === node.id ? null : node.id));
			if (node.type !== "person") return;
			const person = node.data as { primary?: Parameters<typeof displayName>[0] };
			if (person.primary) onPick?.({ id: node.id, name: displayName(person.primary) });
		},
		[focus, onPick],
	);

	return (
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
			// Connecting nodes by dragging would imply a relationship kind we
			// cannot infer; relationships are added through the editor instead.
			nodesConnectable={false}
			elementsSelectable
			// React Flow deletes the selected node on Backspace by default. This canvas
			// is read-only, so that silently drops a person from the view with no undo
			// and leaves the screen disagreeing with the database until a reload.
			deleteKeyCode={null}
			// 198 relation edges in the tab order put ~200 stops between a keyboard user
			// and the zoom controls, for elements that cannot be acted on. The people
			// stay focusable; the lines between them are not destinations.
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
			 * document rather than inside React Flow's edge SVG -- `url(#id)` resolves
			 * against the whole document, so one definition serves every edge instead of
			 * one per edge group.
			 *
			 * `gradientUnits="objectBoundingBox"` is what makes ONE definition work for
			 * paths running in every direction: the gradient is expressed in the path's own
			 * box, so x1=0 is always the source end. A userSpaceOnUse gradient would need
			 * per-edge coordinates and therefore per-edge defs.
			 *
			 * Fading to 68%, not to 0, and the number is a measurement rather than a taste
			 * call. A stroke that reaches transparent stops being a line that arrives
			 * somewhere and reads as one that was cut off -- and the terminus is precisely
			 * where a reader looks to see WHO the relation lands on.
			 *
			 * An edge owes 3:1 under WCAG SC 1.4.11, and because this end is drawn with an
			 * alpha it has to be scored on the COMPOSITE (fg*a + bg*(1-a)) rather than on
			 * the token. The first attempt faded to 35%, which composites to 1.69:1 against
			 * the canvas -- a line only findable if you already knew it was there, which is
			 * the exact defect this repo's contrast rule exists to catch. 0.68 measures
			 * 3.28:1, so the taper is still clearly a taper (5.90 -> 3.28 is a 1.8x drop the
			 * eye reads as direction) with both ends legible.
			 */}
			{/* `aria-hidden="true"` spelled out rather than as the JSX shorthand: Biome's
			    noSvgWithoutTitle only recognises the string form, and this svg holds a
			    definition with nothing to announce. Same trap as TreeLegend's samples. */}
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
						{/* The ACCENT, matching the revealed relation's own stroke. It was
						    `--color-edge-soft` while relations were a permanent grey overlay; a
						    revealed relation is drawn in the accent, and a taper that faded to a
						    different hue than the line it belongs to would read as two marks. */}
						<stop offset="0%" stopColor="var(--color-accent)" stopOpacity="1" />
						<stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.68" />
					</linearGradient>

					{/*
					 * The `#kf-taper-far` definition was deleted along with `is-far` itself.
					 *
					 * It existed only because a gradient's stops cannot be reached by a rule
					 * targeting the path, so a far DIRECTED edge needed a second def to receive the
					 * distance treatment. Nothing fades by distance any more -- a revealed relation
					 * is drawn at full strength however far it reaches, because the viewer asked
					 * for precisely that line -- so both the def and its `--color-edge-far` token
					 * are gone rather than left behind unreferenced.
					 */}
				</defs>
			</svg>

			{/* No `color`: the dot fill and its edge fade are tokens in globals.css
			    (`.react-flow__background-pattern`), so the lattice restyles with the rest
			    of the surface stack instead of holding the one hardcoded colour on the
			    canvas. Geometry stays here, since it is not a design token. */}
			<Background variant={BackgroundVariant.Dots} gap={24} size={1} />
			<GenerationRails bands={bands} />

			{/*
			 * Zoom buttons on a pointer device only.
			 *
			 * On a phone they are 133px of vertical canvas spent on a gesture the
			 * platform already provides better: pinch zooms about the point you are
			 * looking at, where a + button zooms about the viewport centre and moves
			 * whatever you were reading. Hidden with CSS rather than a media-query hook
			 * so the server renders the same markup either way.
			 */}
			<Controls
				showInteractive={false}
				className="kf-zoom-controls overflow-hidden rounded-md border border-hairline"
			/>

			{/*
			 * Bottom-right: the overview, then "back to yourself".
			 *
			 * ONE panel holding both, not two. React Flow positions each Panel absolutely
			 * in its corner, so a second one in the same corner would stack on top of the
			 * first -- and the fix is not to nudge one with a margin, since the overview's
			 * height changes with the detail level and any hardcoded offset would be
			 * wrong at two of the three. A flex column lets them sit above each other by
			 * layout instead.
			 *
			 * Bottom-RIGHT at every size, opposite React Flow's zoom stack. Flipping
			 * sides by media query needs a rule that beats `.react-flow__panel.left`,
			 * and React Flow's stylesheet is imported below this file so an equally
			 * specific `left: auto` loses on source order -- leaving both edges pinned
			 * and stretching the panel into a full-width invisible strip across the
			 * bottom of the tree, which then eats the drag that should pan it.
			 */}
			<Panel
				position="bottom-right"
				className="kf-locate pointer-events-none flex flex-col items-end gap-1.5"
			>
				<TreeMinimap nodes={overview} extent={extent} />

				{/*
				 * Back to yourself. The single most valuable control on a canvas 10760px
				 * wide, and the one thing a viewer cannot recover by gesture: pan far
				 * enough on a phone and every direction looks the same.
				 */}
				{selfId && (
					<button
						type="button"
						onClick={frameSelf}
						title="Back to your family"
						className={cn(
							"pointer-events-auto flex min-h-11 items-center gap-2 rounded-md px-3",
							"border border-hairline bg-surface/90 font-mono text-[0.625rem]",
							"uppercase tracking-wider text-ink-muted backdrop-blur-sm",
							"transition-colors duration-(--duration-fast) ease-(--ease-out)",
							"hover:border-hairline-strong hover:text-ink",
						)}
					>
						<Crosshair aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
						You
					</button>
				)}
			</Panel>
		</ReactFlow>
	);
}

/**
 * Provider wrapper: `useReactFlow` requires context above the canvas.
 *
 * Keyed on the level of detail, so switching remounts rather than diffing. Node
 * dimensions change with it, and React Flow caches measured sizes per node id --
 * a diff would leave the old box on every node and the new layout would collide
 * with itself.
 */
export function TreeCanvas(props: Props) {
	return (
		<ReactFlowProvider key={props.lod ?? "full"}>
			<Canvas {...props} />
		</ReactFlowProvider>
	);
}
