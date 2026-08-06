/**
 * Routing and data loading for the static UI.
 *
 * Three screens, so there is no router dependency: a `switch` on the pathname is
 * the honest implementation at this size, and adding react-router would ship a
 * routing engine to decide between three strings.
 *
 * The data contract is the one thing worth being careful about. `TreeWorkspace`
 * takes a `TreeView` and knows nothing about where it came from -- exactly as it
 * does in the Next app, where a server component passes the same shape. So the
 * canvas, the panels and the editor are shared code, and this file is only the part
 * Next was doing for free: fetch, parse, and hold.
 */
import { useCallback, useEffect, useState } from "react";
import { TreeWorkspace } from "@/components/tree/TreeWorkspace";
import { parseTreeView, type SerialisedTreeView } from "@/lib/tree/serialise";
import type { TreeView } from "@/lib/tree/view";
import { API_BASE, authHeaders, getToken } from "./api";
import { callbackUrl, completeSignIn } from "./auth";
import { CallbackScreen } from "./screens/CallbackScreen";
import { Landing } from "./screens/Landing";
import { LoadingScreen, MessageScreen } from "./screens/States";
import { REFRESH_EVENT } from "./shims/next-navigation";

/** Where we are, relative to the mount. */
function route(): "landing" | "callback" | "tree" {
	const base = import.meta.env.BASE_URL.replace(/\/$/, "");
	const path = window.location.pathname.replace(base, "") || "/";
	if (path.startsWith("/auth/callback")) return "callback";
	if (path.startsWith("/tree")) return "tree";
	return "landing";
}

type Data = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; view: TreeView };

export function App() {
	const screen = route();

	if (screen === "callback") return <CallbackScreen complete={completeSignIn} />;
	if (screen === "tree") return <TreeScreen />;
	return <Landing />;
}

function TreeScreen() {
	const [data, setData] = useState<Data>({ state: "loading" });

	const load = useCallback(async () => {
		// The demo needs no token, so the query mirrors what /tree does on the server:
		// a session wins, and `?demo=1` is the fallback a signed-out visitor gets.
		const params = new URLSearchParams(window.location.search);
		const demo = params.get("demo") === "1" || !getToken();

		const url = new URL(`${API_BASE}/api/tree`, window.location.origin);
		if (demo) url.searchParams.set("demo", "1");
		// Threaded through so a shared link keeps its view options.
		if (params.get("combined") === "0") url.searchParams.set("combined", "0");
		if (params.get("relations") === "0") url.searchParams.set("relations", "0");

		try {
			const response = await fetch(url, { headers: authHeaders() });

			if (response.status === 401) {
				setData({ state: "error", message: "Your session has expired. Sign in again." });
				return;
			}
			if (!response.ok) {
				setData({ state: "error", message: "Could not load your graph." });
				return;
			}

			const body = (await response.json()) as { view: SerialisedTreeView | null };
			if (!body.view) {
				// A signed-in account with no tree yet. Not an error.
				setData({ state: "error", message: "Your graph is empty. Add somebody to begin." });
				return;
			}
			// Through `parseTreeView`, never `body.view` directly: `kinship` crosses the
			// wire as entries and has to be rebuilt into a Map, and a view whose kinship
			// is a plain object renders every card without its relationship line.
			setData({ state: "ready", view: parseTreeView(body.view) });
		} catch {
			setData({ state: "error", message: "Could not reach the server." });
		}
	}, []);

	useEffect(() => {
		void load();
		// `router.refresh()` in a shared component raises this, which is how a write
		// gets reflected without reloading the page and losing the viewport.
		const onRefresh = () => void load();
		window.addEventListener(REFRESH_EVENT, onRefresh);
		return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
	}, [load]);

	if (data.state === "loading") return <LoadingScreen />;
	if (data.state === "error") return <MessageScreen message={data.message} />;
	return <TreeWorkspace view={data.view} />;
}

export { callbackUrl };
