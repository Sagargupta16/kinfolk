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
	MarkerType,
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
	visibleEdges,
} from "@/lib/tree/graph";
import { type GenerationBand, type Lod, layoutGraph, NODE_METRICS } from "@/lib/tree/layout";
import { neighbourhood } from "@/lib/tree/neighbourhood";
import { cn } from "@/lib/utils";
import { FamilyEdge } from "./FamilyEdge";
import { GenerationRails } from "./GenerationRails";
import { PersonNode, UnionNode } from "./PersonNode";

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
};

function Canvas({
	nodes: sourceNodes,
	edges: sourceEdges,
	showRelations = true,
	selfId,
	lod = "full",
	goTo,
	degree,
}: Props) {
	const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
	const [bands, setBands] = useState<GenerationBand[]>([]);
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
	const [focusedId, setFocusedId] = useState<string | null>(null);

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
	 * The edges to DRAW, which is not the same set the layout gets.
	 *
	 * Everything downstream of here -- what is rendered, and who lights up on hover --
	 * reads this one. `layoutGraph` keeps reading `sourceEdges`, so turning the
	 * overlay off changes what you see without moving a single card.
	 */
	const drawnEdges = useMemo(
		() => visibleEdges(sourceEdges, showRelations),
		[sourceEdges, showRelations],
	);

	// Edges are a pure projection of the source data, so derive rather than store.
	const flowEdges = useMemo<Edge[]>(
		() =>
			drawnEdges.map((edge) => {
				if (edge.kind === "relation") {
					return {
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
						]
							.filter(Boolean)
							.join(" "),
						// Above the cards, because a label pinned to a curve's midpoint
						// otherwise gets painted over by whatever card it passes behind.
						// Safe only because the line itself is a faint 1px dash: it reads
						// as an overlay and never competes with the family skeleton. The
						// label stays hidden until hover or tap (see globals.css).
						zIndex: 1001,
						...(edge.directed
							? {
									markerEnd: {
										type: MarkerType.ArrowClosed,
										width: 14,
										height: 14,
										// Passed here, not styled in CSS. React Flow hoists markers
										// into one shared <defs> outside the edge groups and writes
										// the colour as an inline style on the polyline, so a rule
										// scoped to `.is-relation` matches nothing AND an unscoped
										// one still loses to the inline value. Left unset the
										// arrowhead keeps React Flow's #b1b1b7, which is the family
										// skeleton's weight on an overlay glyph.
										//
										// A `var()` rather than a hex so the token stays the single
										// source of truth: it lands in an inline style, and inline
										// custom properties resolve against the element's own
										// cascade, which inherits from :root like anything else.
										color: "var(--color-edge-soft)",
									},
								}
							: {}),
					};
				}

				return {
					id: edge.id,
					source: edge.source,
					target: edge.target,
					// Our own type, purely so the path can carry pathLength={1} for the
					// draw-on animation. Same route smoothstep produces.
					type: "family",
					className: edge.kind === "partner" ? "is-partner" : undefined,
				};
			}),
		[drawnEdges],
	);

	useEffect(() => {
		let cancelled = false;

		// ELK is async and imported lazily, so a fast second data change can
		// resolve out of order. The flag drops stale layouts.
		void layoutGraph(sourceNodes, sourceEdges, lod).then(({ nodes: positioned, bands: rows }) => {
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
									lod,
								}
							: node.data,
					// Name and dates, which is what the card shows. Never a contact
					// value: an accessible name is MORE exposed than the visible card,
					// so it must not become the back door PersonNode refuses to be.
					...(node.type === "person"
						? {
								ariaLabel: [displayName(node.data.primary), lifespan(node.data.primary)]
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

			// Each family edge draws itself on just after the node it descends FROM has
			// landed, so the skeleton grows downwards with the cards rather than being
			// there waiting for them. Relation edges are excluded: they are an overlay,
			// and animating them in would read as part of the structure.
			setEdges(
				flowEdges.map((edge) => {
					if (edge.className?.includes("is-relation")) return edge;
					const delay = (delays.get(edge.source) ?? 0) + ROW_STAGGER_MS;
					return {
						...edge,
						className: withFlag("kf-draw", edge.className, true),
						style: { ...edge.style, "--kf-delay": `${delay}ms` } as CSSProperties,
					};
				}),
			);
			setBands(rows);
			setLayoutEpoch((epoch) => epoch + 1);
		});

		return () => {
			cancelled = true;
		};
	}, [sourceNodes, sourceEdges, flowEdges, selfId, lod, degree, coarsePointer, setNodes, setEdges]);

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
	// Over the DRAWN edges: with the overlay off, lighting a friend whose connecting
	// line is not on screen would highlight them for no visible reason.
	const lit = useMemo(() => {
		if (!focusedId) return null;
		const unionIds = new Set(sourceNodes.filter((n) => n.type === "union").map((n) => n.id));
		return neighbourhood(drawnEdges, focusedId, (id) => unionIds.has(id));
	}, [focusedId, sourceNodes, drawnEdges]);

	// Apply focus by rewriting className only. Deliberately its own effect:
	// folding focus into the flowEdges memo would re-run ELK on every hover, since
	// the layout effect depends on that memo.
	useEffect(() => {
		setNodes((current) =>
			current.map((node) => {
				const next = withFlag("kf-dim", node.className, Boolean(lit) && !lit?.nodeIds.has(node.id));
				return next === node.className ? node : { ...node, className: next };
			}),
		);

		setEdges((current) =>
			current.map((edge) => {
				// Two flags, because an edge has three states: lit, untouched, and
				// dimmed because attention is elsewhere.
				const active = Boolean(lit?.edgeIds.has(edge.id));
				let next = withFlag("is-active", edge.className, active);
				next = withFlag("kf-dim", next, Boolean(lit) && !active);
				return next === edge.className ? edge : { ...edge, className: next };
			}),
		);
	}, [lit, setNodes, setEdges]);

	// Tap counts as well as hover: on a phone there is no hover, and a tap that
	// only selects a card would leave the labels unreachable.
	const focus = useCallback((_: unknown, node: Node) => setFocusedId(node.id), []);
	const blur = useCallback(() => setFocusedId(null), []);

	return (
		<ReactFlow
			nodes={nodes}
			edges={edges}
			onNodesChange={onNodesChange}
			onEdgesChange={onEdgesChange}
			onNodeMouseEnter={focus}
			onNodeMouseLeave={blur}
			onNodeClick={focus}
			onPaneClick={blur}
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
			<Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1c1e23" />
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
			 * Back to yourself. The single most valuable control on a canvas 10760px
			 * wide, and the one thing a viewer cannot recover by gesture: pan far enough
			 * on a phone and every direction looks the same.
			 *
			 * Bottom-RIGHT at every size, opposite React Flow's zoom stack. Flipping
			 * sides by media query needs a rule that beats `.react-flow__panel.left`,
			 * and React Flow's stylesheet is imported below this file so an equally
			 * specific `left: auto` loses on source order -- leaving both edges pinned
			 * and stretching the panel into a full-width invisible strip across the
			 * bottom of the tree, which then eats the drag that should pan it.
			 */}
			{selfId && (
				<Panel position="bottom-right" className="kf-locate">
					<button
						type="button"
						onClick={frameSelf}
						title="Back to your family"
						className={cn(
							"flex min-h-11 items-center gap-2 rounded-md border border-hairline px-3",
							"bg-surface/90 font-mono text-[0.625rem] uppercase tracking-wider text-ink-muted",
							"backdrop-blur-sm transition-colors duration-[--duration-fast] ease-[--ease-out]",
							"hover:border-hairline-strong hover:text-ink",
						)}
					>
						<Crosshair aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
						You
					</button>
				</Panel>
			)}
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
