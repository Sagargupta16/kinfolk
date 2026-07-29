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
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { degrees } from "@/lib/tree/density";
import type { FlowEdge, FlowNode } from "@/lib/tree/graph";
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
	edges: FlowEdge[];
	/** Person id to highlight as the viewer. */
	selfId?: string;
	/** How much of each person to draw. Changes node size, so it re-runs layout. */
	lod?: Lod;
};

function Canvas({ nodes: sourceNodes, edges: sourceEdges, selfId, lod = "full" }: Props) {
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
	// `getNodesBounds` from the hook, not the standalone export: the bare function
	// has no node lookup and warns on every call.
	const { fitView, getNodesBounds, getNodes, setCenter } = useReactFlow();

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

	// How connected each person is, so a hub can be drawn as one. Derived from the
	// same nodes and edges the layout sees, never stored.
	const degree = useMemo(() => degrees(sourceNodes, sourceEdges), [sourceNodes, sourceEdges]);

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

	// Edges are a pure projection of the source data, so derive rather than store.
	const flowEdges = useMemo<Edge[]>(
		() =>
			sourceEdges.map((edge) => {
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
							? { markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 } }
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
		[sourceEdges],
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
				viewportWidth / (bounds.width || 1),
				viewportHeight / (bounds.height || 1),
			);

			if (householdZoom >= LEGIBLE_ZOOM[lod]) {
				// Capped at 1:1. `fitView` scales UP to fill, so a household of five on a
				// 1440px screen opened at 1.72x -- five cards magnified past the size they
				// were designed at, with 146 relatives off screen. At 1:1 the same five
				// are centred and the leftover room fills with the family around them,
				// which is what a wider screen should buy.
				void fitView({ padding: 0.3, duration: 400, nodes: household, maxZoom: 1 });
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
			viewportWidth / (bounds.width || 1),
			viewportHeight / (bounds.height || 1),
		);

		if (fitZoom >= LEGIBLE_ZOOM[lod]) {
			void fitView({ padding: 0.2, duration: 400 });
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

	// Who lights up when somebody is focused. Traverses through union dots, so
	// hovering a parent reaches their partner and children rather than stopping at
	// the junction between them.
	const lit = useMemo(() => {
		if (!focusedId) return null;
		const unionIds = new Set(sourceNodes.filter((n) => n.type === "union").map((n) => n.id));
		return neighbourhood(sourceEdges, focusedId, (id) => unionIds.has(id));
	}, [focusedId, sourceNodes, sourceEdges]);

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
			minZoom={0.15}
			maxZoom={1.8}
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
