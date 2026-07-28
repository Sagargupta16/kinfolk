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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FlowEdge, FlowNode } from "@/lib/tree/graph";
import { layoutGraph } from "@/lib/tree/layout";
import { PersonNode, UnionNode } from "./PersonNode";

const nodeTypes = { person: PersonNode, union: UnionNode };

type Props = {
	nodes: FlowNode[];
	edges: FlowEdge[];
	/** Person id to highlight as the viewer. */
	selfId?: string;
};

function Canvas({ nodes: sourceNodes, edges: sourceEdges, selfId }: Props) {
	const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
	const { fitView } = useReactFlow();

	// True only once React Flow has measured every node, which it cannot do while
	// the container is 0x0 (hidden tab, pane not yet laid out). Framing on rAF
	// instead would silently no-op in that window and never retry.
	const measured = useNodesInitialized();

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
						type: "bezier",
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
		void layoutGraph(sourceNodes, sourceEdges).then((positioned) => {
			if (cancelled) return;

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
								}
							: node.data,
					// Union dots are structural, not content; dragging them would
					// desync the layout from the data.
					draggable: node.type === "person",
				})),
			);
			setEdges(flowEdges);
		});

		return () => {
			cancelled = true;
		};
	}, [sourceNodes, sourceEdges, flowEdges, selfId, setNodes, setEdges]);

	// Frame the graph once the nodes it contains have actually been measured.
	// Keyed on `nodes` too, so switching between combined and mine-only refits.
	useEffect(() => {
		if (!measured || nodes.length === 0) return;
		void fitView({ padding: 0.2, duration: 400 });
	}, [measured, nodes, fitView]);

	// Light up the focused person's social links. Deliberately its own effect that
	// only touches className: folding focus into the flowEdges memo would re-run
	// ELK on every hover, since the layout effect depends on that memo.
	useEffect(() => {
		setEdges((current) =>
			current.map((edge) => {
				if (!edge.className?.includes("is-relation")) return edge;

				const active = Boolean(
					focusedId && (edge.source === focusedId || edge.target === focusedId),
				);
				const base = edge.className.replace(" is-active", "");
				const next = active ? `${base} is-active` : base;

				return next === edge.className ? edge : { ...edge, className: next };
			}),
		);
	}, [focusedId, setEdges]);

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
			<Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#26282e" />
			<Controls showInteractive={false} className="!border-hairline !bg-surface" />
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
