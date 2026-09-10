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
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { parseTreeView, type SerialisedTreeView } from "@/lib/tree/serialise";
import type { TreeView } from "@/lib/tree/view";
import { API_BASE, authHeaders, clearToken, getToken } from "./api";
import { callbackUrl, completeSignIn } from "./auth";
import { CallbackScreen } from "./screens/CallbackScreen";
import { Landing } from "./screens/Landing";
import { LoadingScreen, MessageScreen } from "./screens/States";
import { REFRESH_EVENT } from "./shims/next-navigation";

const TreeWorkspace = lazy(() =>
	import("@/components/tree/TreeWorkspace").then((module) => ({ default: module.TreeWorkspace })),
);
const ContactWorkspace = lazy(() =>
	import("@/components/contacts/ContactWorkspace").then((module) => ({
		default: module.ContactWorkspace,
	})),
);

/** Where we are, relative to the mount. */
function route(): "landing" | "callback" | "tree" | "contacts" {
	const base = import.meta.env.BASE_URL.replace(/\/$/, "");
	const path = window.location.pathname.replace(base, "") || "/";
	if (path.startsWith("/auth/callback")) return "callback";
	if (path.startsWith("/tree")) return "tree";
	if (path.startsWith("/contacts/")) return "contacts";
	return "landing";
}

type Data =
	| { state: "loading" }
	| { state: "error"; message: string }
	| { state: "ready"; view: TreeView };

export function App() {
	const screen = route();

	if (screen === "callback") return <CallbackScreen complete={completeSignIn} />;
	if (screen === "tree") return <TreeScreen />;
	if (screen === "contacts") {
		const personId = window.location.pathname.split("/contacts/")[1]?.split("/")[0] ?? "";
		return (
			<Suspense fallback={<LoadingScreen />}>
				<ContactWorkspace personId={personId} />
			</Suspense>
		);
	}
	return <Landing />;
}

function TreeScreen() {
	const [data, setData] = useState<Data>({ state: "loading" });
	const activeRequest = useRef<AbortController | null>(null);

	const load = useCallback(async () => {
		activeRequest.current?.abort();
		const controller = new AbortController();
		activeRequest.current = controller;
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
			const response = await fetch(url, { headers: authHeaders(), signal: controller.signal });
			if (controller.signal.aborted) return;

			if (!response.ok) {
				if (response.status === 401) clearToken();

				const message =
					response.status === 401
						? "Your session has expired. Sign in again."
						: "Could not load your graph.";
				setData({ state: "error", message });
				return;
			}

			const body = (await response.json()) as { view: SerialisedTreeView | null };
			if (controller.signal.aborted) return;
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
			if (controller.signal.aborted) return;
			setData({ state: "error", message: "Could not reach the server." });
		}
	}, []);

	useEffect(() => {
		void load();
		// `router.refresh()` in a shared component raises this, which is how a write
		// gets reflected without reloading the page and losing the viewport.
		const onRefresh = () => void load();
		window.addEventListener(REFRESH_EVENT, onRefresh);
		return () => {
			activeRequest.current?.abort();
			window.removeEventListener(REFRESH_EVENT, onRefresh);
		};
	}, [load]);

	if (data.state === "loading") return <LoadingScreen />;
	if (data.state === "error") return <MessageScreen message={data.message} />;
	return (
		<Suspense fallback={<LoadingScreen />}>
			<TreeWorkspace view={data.view} />
		</Suspense>
	);
}

export { callbackUrl };
