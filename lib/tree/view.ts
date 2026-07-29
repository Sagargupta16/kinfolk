/**
 * The one shape the UI renders, whatever produced it.
 *
 * Demo mode and a signed-in session are two SOURCES for this type, never two
 * code paths through the canvas. That is the whole point: the sample tree
 * exercises the same projection, the same layout and the same components as real
 * data, so "works in the demo" means something. A second rendering path would
 * let the demo drift into a showreel that proves nothing.
 */
import type { FlowEdge, FlowNode } from "./graph";

export type TreeViewStats = {
	/** Logical humans after fusion. */
	people: number;
	/** Person ROWS that produced them; higher than `people` when trees overlap. */
	rows: number;
	/** How many of those humans were described by more than one family. */
	merged: number;
	/** Non-hierarchical edges in the data, whether or not the overlay is showing them. */
	relations: number;
	/** Trees contributing to this view. */
	trees: number;
};

export type TreeView = {
	nodes: FlowNode[];
	/**
	 * Every edge, including relations a viewer with the overlay off will not see.
	 *
	 * Deliberately not pre-filtered: layout follows relation edges to place a person
	 * who has no family recorded, so removing them here moves people instead of
	 * merely hiding lines. `visibleEdges()` in graph.ts is where the toggle applies.
	 */
	edges: FlowEdge[];
	/** Person id to highlight as the viewer, when known. */
	selfId?: string;
	stats: TreeViewStats;
	/** Names of the contributing trees, for the workspace header. */
	treeNames: string[];
	/** True when this is sample data, which drives the banner and mutation guards. */
	isDemo: boolean;
	/** Echoed back so the header can render toggles without re-reading searchParams. */
	isCombined: boolean;
	showRelations: boolean;
};
