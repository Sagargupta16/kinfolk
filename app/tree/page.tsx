/**
 * The tree. One page, two data sources.
 *
 * Resolution order is deliberate: a real session wins over the demo cookie, so
 * signing in from inside the demo shows your own (possibly empty) tree rather
 * than silently keeping sample data on screen. Somebody with neither is sent to
 * sign-in, where the demo is offered.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionOrNull } from "@/auth";
import { EmptyTree } from "@/components/tree/EmptyTree";
import { TreeWorkspace } from "@/components/tree/TreeWorkspace";
import { buildDemoView, DEMO_COOKIE } from "@/lib/tree/demo";
import { loadTreeView } from "@/lib/tree/load";
import type { TreeView } from "@/lib/tree/view";

export const metadata = { title: "Your tree -- Kinfolk" };

type SearchParams = Promise<{ combined?: string; relations?: string }>;

export default async function TreePage({ searchParams }: { searchParams: SearchParams }) {
	const params = await searchParams;
	// Both default on: the combined view is the product, and hiding it behind a
	// toggle would make the first screen the least interesting one.
	const options = {
		combined: params.combined !== "0",
		showRelations: params.relations !== "0",
	};

	const session = await sessionOrNull();
	const userId = session?.user?.id;

	let view: TreeView | null = null;

	if (userId) {
		view = await loadTreeView(userId, options);
		// Signed in with no tree yet: a new account, not an error.
		if (!view) return <EmptyTree name={session?.user?.name ?? null} />;
	} else {
		const store = await cookies();
		if (!store.get(DEMO_COOKIE)) redirect("/signin?from=/tree");
		view = buildDemoView(options);
	}

	return <TreeWorkspace view={view} />;
}
