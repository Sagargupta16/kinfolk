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
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesInitialized,
	useNodesState,
	useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
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

	// Edges are a pure projection of the source data, so derive rather than store.
	const flowEdges = useMemo<Edge[]>(
		() =>
			sourceEdges.map((edge) => ({
				id: edge.id,
				source: edge.source,
				target: edge.target,
				type: "smoothstep",
				className: edge.kind === "partner" ? "is-partner" : undefined,
			})),
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

	return (
		<ReactFlow
			nodes={nodes}
			edges={edges}
			onNodesChange={onNodesChange}
			onEdgesChange={onEdgesChange}
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
