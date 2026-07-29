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
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesInitialized,
	useNodesState,
	useReactFlow,
	useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { FlowEdge, FlowNode } from "@/lib/tree/graph";
import { type GenerationBand, layoutGraph } from "@/lib/tree/layout";
import { neighbourhood } from "@/lib/tree/neighbourhood";
import { GenerationRails } from "./GenerationRails";
import { PersonNode, UnionNode } from "./PersonNode";

const nodeTypes = { person: PersonNode, union: UnionNode };

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
 * Zoom below which a card's 11px metadata stops being readable.
 *
 * Framing refuses to go under this: a whole tree rendered too small to read is
 * strictly worse than part of one you can.
 */
const LEGIBLE_ZOOM = 0.55;

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
};

function Canvas({ nodes: sourceNodes, edges: sourceEdges, selfId }: Props) {
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
	const { fitView, getNodesBounds, getNodes } = useReactFlow();

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
						className: `is-relation is-${edge.relationKind}`,
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
					type: "smoothstep",
					className: edge.kind === "partner" ? "is-partner" : undefined,
				};
			}),
		[sourceEdges],
	);

	useEffect(() => {
		let cancelled = false;

		// ELK is async and imported lazily, so a fast second data change can
		// resolve out of order. The flag drops stale layouts.
		void layoutGraph(sourceNodes, sourceEdges).then(({ nodes: positioned, bands: rows }) => {
			if (cancelled) return;

			setNodes(
				positioned.map((node) => {
					const delay = Math.min(rowFor(node.position.y, rows) * ROW_STAGGER_MS, MAX_STAGGER_MS);

					return {
						id: node.id,
						type: node.type,
						position: node.position,
						data:
							node.type === "person"
								? {
										...node.data,
										isSelf: node.data.sources.some((s) => s.id === selfId),
									}
								: node.data,
						// Union dots are structural, not content; dragging them would
						// desync the layout from the data.
						draggable: node.type === "person",
						// The animation itself is CSS (see globals.css); React Flow owns
						// the node's transform, so a JS-driven entrance would fight it.
						className: "kf-enter",
						style: { "--kf-delay": `${delay}ms` } as CSSProperties,
					};
				}),
			);
			setEdges(flowEdges);
			setBands(rows);
			setLayoutEpoch((epoch) => epoch + 1);
		});

		return () => {
			cancelled = true;
		};
	}, [sourceNodes, sourceEdges, flowEdges, selfId, setNodes, setEdges]);

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

		if (fitZoom >= LEGIBLE_ZOOM) {
			void fitView({ padding: 0.2, duration: 400 });
			return;
		}

		// Too big to fit legibly: open on the viewer instead and let them pan out. A
		// readable corner they recognise beats an unreadable whole.
		const anchor = nodes.find((node) => (node.data as { isSelf?: boolean }).isSelf) ?? nodes[0];
		if (!anchor) return;

		void fitView({ padding: 1.6, duration: 400, nodes: [anchor] });
	}, [measured, layoutEpoch, viewportWidth, viewportHeight, fitView, getNodesBounds, getNodes]);

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
			{/* Styled in globals.css, which has to out-specify React Flow's own sheet. */}
			<Controls
				showInteractive={false}
				className="overflow-hidden rounded-md border border-hairline"
			/>
		</ReactFlow>
	);
}

/** Provider wrapper: `useReactFlow` requires context above the canvas. */
export function TreeCanvas(props: Props) {
	return (
		<ReactFlowProvider>
			<Canvas {...props} />
		</ReactFlowProvider>
	);
}
