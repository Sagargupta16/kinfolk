/**
 * The one shape the UI renders, whatever produced it.
 *
 * Demo mode and a signed-in session are two SOURCES for this type, never two
 * code paths through the canvas. That is the whole point: the sample tree
 * exercises the same projection, the same layout and the same components as real
 * data, so "works in the demo" means something. A second rendering path would
 * let the demo drift into a showreel that proves nothing.
 */
import type { FlowEdge, FlowNode, UnionWithChildren } from "./graph";
import type { Kinship } from "./kinship";

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
	/**
	 * What each person IS to the viewer, keyed by fused id. See lib/tree/kinship.ts.
	 *
	 * Carried on the view rather than computed in the card, because it is a property
	 * of the whole graph: deriving "second cousin once removed" needs the ancestor
	 * walk from both ends, which a component holding one person cannot do. Empty when
	 * there is no viewer, which is what a signed-out visitor and mine-only demo mode
	 * both get.
	 */
	kinship: Map<string, Kinship>;
	stats: TreeViewStats;
	/** Names of the contributing trees, for the workspace header. */
	treeNames: string[];
	/** True when this is sample data, which drives the banner and mutation guards. */
	isDemo: boolean;
	/**
	 * The graph this viewer may WRITE to, or null for a read-only canvas.
	 *
	 * Null in demo mode and for a viewer holding only a read grant. Its absence hides the
	 * editor rather than disabling it, since a disabled control advertises an action that
	 * can never succeed here. This is a rendering hint only -- every mutation re-checks
	 * permission server-side in lib/tree/authz.ts, because a value that reached the client
	 * is a value the client can change.
	 */
	editableTreeId: string | null;
	/** Every writable tree, with the default destination first. Rechecked on each mutation. */
	editableTreeIds: string[];
	/** Labels for choosing which writable family to share. Optional for older APIs. */
	editableTrees?: { id: string; name: string }[];
	/** Unfused records for choosing the exact writable parenting group in quick-add. */
	editableUnions: UnionWithChildren[];
	/**
	 * Who is signed in, for the account menu.
	 *
	 * Name and email only. The header needs to say WHOSE graph this is -- the product is
	 * several people's records joined, so "signed in as" is not decoration -- and nothing
	 * beyond those two fields belongs in a client bundle.
	 *
	 * Null in demo mode, which is what hides the menu: there is nobody to sign out.
	 */
	viewer: { name: string | null; email: string | null } | null;
	/** Echoed back so the header can render toggles without re-reading searchParams. */
	isCombined: boolean;
	showRelations: boolean;
};
