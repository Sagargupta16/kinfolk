/**
 * Demo mode: the sample tree, projected through the real pipeline.
 *
 * Mirrors the ledger-sync pattern -- one UI, two data sources, a flag, and
 * mutation guards -- with the difference that Kinfolk renders on the server, so
 * there is no client cache to seed. The switch is a cookie read in a server
 * component instead of a store, which keeps demo data out of the client bundle
 * entirely.
 *
 * Deliberately calls `fuseTrees` and `toFlowGraph` rather than shipping
 * pre-computed positions: if fusion breaks, the demo must break too. A demo that
 * cannot fail is a screenshot, not a proof.
 */
import { fuseTrees, toFlowGraph } from "./graph";
import { fusedSelfId, kinshipMap } from "./kinship";
import { sampleLinks, samplePrimaryTreeId, sampleSelfId, sampleSlices } from "./sample";
import type { TreeView } from "./view";

/** Cookie that opts a visitor into sample data. Session-scoped, no value beyond "on". */
export const DEMO_COOKIE = "kinfolk_demo";

export type DemoOptions = {
	/** False drops the relative's tree, showing what a viewer without a share sees. */
	combined?: boolean;
	/** False hides the social overlay, leaving the bare family skeleton. */
	showRelations?: boolean;
};

/**
 * Build the demo view.
 *
 * Mine-only mode drops the other tree AND its links, which is exactly what
 * somebody without a share grant would get -- not the same tree with nodes
 * hidden, but a genuinely smaller dataset.
 */
export function buildDemoView({
	combined = true,
	showRelations = true,
}: DemoOptions = {}): TreeView {
	const slices = combined
		? sampleSlices
		: sampleSlices.filter((slice) => slice.treeId === samplePrimaryTreeId);
	const links = combined ? sampleLinks : [];

	const fused = fuseTrees(slices, links, samplePrimaryTreeId);
	const { nodes, edges } = toFlowGraph(fused);

	return {
		nodes,
		edges,
		selfId: sampleSelfId,
		// Nothing to write to: the demo owns no rows and has no user to attribute them to,
		// so the editor is not rendered at all. `edit-actions.ts` refuses a demo request
		// server-side as well -- this only avoids offering a button that would be refused.
		editableTreeId: null,
		kinship: kinshipMap(fused, fusedSelfId(fused, sampleSelfId)),
		treeNames: slices.map((slice) => slice.treeName),
		isDemo: true,
		isCombined: combined,
		showRelations,
		stats: {
			people: fused.people.length,
			rows: slices.reduce((total, slice) => total + slice.people.length, 0),
			merged: fused.people.filter((person) => person.sources.length > 1).length,
			relations: fused.relations.length,
			trees: slices.length,
		},
	};
}
