/**
 * Routing and data loading for the static UI.
 *
 * Four screens, so there is no router dependency: a `switch` on the pathname is
 * the honest implementation at this size, and adding react-router would ship a
 * routing engine to decide between four strings.
 *
 * The data contract is the one thing worth being careful about. `TreeWorkspace`
 * takes a `TreeView` and knows nothing about where it came from -- exactly as it
 * does in the Next app, where a server component passes the same shape. So the
 * canvas, the panels and the editor are shared code, and this file is only the part
 * Next was doing for free: fetch, parse, and hold.
 */
import { X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { EmptyTree } from "@/components/tree/EmptyTree";
import { LoadBoundary } from "@/components/ui/LoadBoundary";
import { parseTreeView, type SerialisedTreeView } from "@/lib/tree/serialise";
import type { TreeView } from "@/lib/tree/view";
import {
	API_BASE,
	authHeaders,
	clearToken,
	getToken,
	REQUEST_TIMEOUT_MS,
	withTimeout,
} from "./api";
import { callbackUrl, completeSignIn } from "./auth";
import { CallbackScreen } from "./screens/CallbackScreen";
import { Landing } from "./screens/Landing";
import { LoadingScreen, MessageScreen, ReloadScreen } from "./screens/States";
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

/** Whether this visit asked for the sample family by name, as every sample link does. */
function demoRequested(): boolean {
	return new URLSearchParams(window.location.search).get("demo") === "1";
}

/** Why a read failed, and the one thing that would fix it. */
type Failure = { message: string; remedy: "retry" | "reload" | "sign-in" };

type Read =
	| { kind: "view"; view: TreeView }
	| { kind: "empty" }
	| { kind: "failed"; failure: Failure };

type Data =
	| { state: "loading" }
	| { state: "error"; failure: Failure }
	/** Signed in, and the account has no graph at all. */
	| { state: "empty" }
	/** `notice` is a failed REFRESH: the family on screen stays, with a way to try again. */
	| { state: "ready"; view: TreeView; notice: Failure | null };

const UNREACHABLE: Read = {
	kind: "failed",
	failure: { message: "Could not reach the server.", remedy: "retry" },
};

export function App() {
	const screen = route();

	if (screen === "callback") return <CallbackScreen complete={completeSignIn} />;
	if (screen === "tree") return demoRequested() || getToken() ? <TreeScreen /> : <SignedOut />;
	if (screen === "contacts") {
		const personId = window.location.pathname.split("/contacts/")[1]?.split("/")[0] ?? "";
		return (
			<LoadBoundary fallback={<ReloadScreen />}>
				<Suspense fallback={<LoadingScreen />}>
					<ContactWorkspace personId={personId} />
				</Suspense>
			</LoadBoundary>
		);
	}
	return <Landing />;
}

/**
 * /tree with neither a session nor `?demo=1`: the front door, where sign-in and the
 * sample both are -- the same answer as the Next app, whose /tree redirects to /signin.
 *
 * It used to open the sample family instead, so somebody whose session had just expired
 * was shown a stranger's family where their own had been, with nothing saying why.
 */
function SignedOut() {
	useEffect(() => {
		window.history.replaceState(null, "", import.meta.env.BASE_URL);
	}, []);
	return <Landing />;
}

/**
 * One read of `/api/tree`, sorted into what the screen should do about it.
 *
 * The failures are kept apart because their remedies differ. A rejected fetch is the
 * network or the timeout, and trying again may work. A body that is not JSON, or JSON
 * without a readable view, is this build and the API disagreeing about the shape --
 * usually Pages and Vercel mid-deploy -- and only a reload, which fetches the matching
 * build, fixes that. Reporting both as "could not reach the server" sent people
 * checking a connection that was fine.
 */
async function readTree(signal: AbortSignal): Promise<Read> {
	const params = new URLSearchParams(window.location.search);
	const demo = params.get("demo") === "1";

	const url = new URL(`${API_BASE}/api/tree`, window.location.origin);
	if (demo) url.searchParams.set("demo", "1");
	// Threaded through so a shared link keeps its view options.
	if (params.get("combined") === "0") url.searchParams.set("combined", "0");
	if (params.get("relations") === "0") url.searchParams.set("relations", "0");

	let response: Response;
	try {
		response = await fetch(url, {
			// No credential for the sample: it needs none, and an API from before the sample
			// was checked first would answer a bearer with the visitor's own family instead.
			headers: demo ? {} : authHeaders(),
			signal: withTimeout(REQUEST_TIMEOUT_MS, signal),
		});
	} catch {
		return UNREACHABLE;
	}

	if (!response.ok) {
		if (response.status === 401) {
			clearToken();
			return {
				kind: "failed",
				failure: { message: "Your session has expired. Sign in again.", remedy: "sign-in" },
			};
		}
		return { kind: "failed", failure: { message: "Could not load your graph.", remedy: "retry" } };
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch (error) {
		// The body can stop arriving (a dropped connection, the timeout) or arrive as
		// something that is not JSON. Only the second is a version problem.
		return error instanceof SyntaxError ? outOfStep("the response was not JSON") : UNREACHABLE;
	}
	if (!isTreeBody(body)) return outOfStep("the response had no readable view");
	// A signed-in account with no graph yet. Not an error.
	if (body.view === null) return { kind: "empty" };

	try {
		// Through `parseTreeView`, never `body.view` directly: `kinship` crosses the
		// wire as entries and has to be rebuilt into a Map, and a view whose kinship
		// is a plain object renders every card without its relationship line.
		return { kind: "view", view: parseTreeView(body.view) };
	} catch {
		return outOfStep("the view could not be parsed");
	}
}

/** Enough of the shape to hand to `parseTreeView`, which assumes the rest. */
function isTreeBody(body: unknown): body is { view: SerialisedTreeView | null } {
	if (!body || typeof body !== "object" || !("view" in body)) return false;
	const { view } = body;
	if (view === null) return true;
	return (
		typeof view === "object" &&
		Array.isArray((view as { nodes?: unknown }).nodes) &&
		Array.isArray((view as { edges?: unknown }).edges)
	);
}

function outOfStep(reason: string): Read {
	// A fixed reason and nothing from the payload, which is somebody's family.
	console.error(`[kinfolk] /api/tree answered in a shape this build cannot read: ${reason}`);
	return {
		kind: "failed",
		failure: {
			message:
				"This page and the server are out of step, which usually means Kinfolk was just updated. Reloading the page fixes it.",
			remedy: "reload",
		},
	};
}

function TreeScreen() {
	const [data, setData] = useState<Data>({ state: "loading" });
	const activeRequest = useRef<AbortController | null>(null);

	const load = useCallback(async () => {
		activeRequest.current?.abort();
		const controller = new AbortController();
		activeRequest.current = controller;

		const read = await readTree(controller.signal);
		// Superseded by a newer load, whose answer is the one that counts.
		if (controller.signal.aborted) return;

		if (read.kind === "view") setData({ state: "ready", view: read.view, notice: null });
		else if (read.kind === "empty") setData({ state: "empty" });
		else {
			const { failure } = read;
			// A failed REFRESH keeps the family on screen. Every refresh follows a write
			// that already succeeded, and swapping the workspace for a message screen threw
			// away the viewport, the folds and any open panel to report a re-read problem.
			setData((current) =>
				current.state === "ready" ? { ...current, notice: failure } : { state: "error", failure },
			);
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
	if (data.state === "empty") return <EmptyTree name={null} />;
	if (data.state === "error") {
		const { failure } = data;
		return (
			<MessageScreen
				message={failure.message}
				action={
					failure.remedy === "reload"
						? { label: "Reload", onClick: () => window.location.reload() }
						: failure.remedy === "retry"
							? {
									label: "Try again",
									onClick: () => {
										setData({ state: "loading" });
										void load();
									},
								}
							: undefined
				}
			/>
		);
	}
	return (
		<>
			<LoadBoundary fallback={<ReloadScreen />}>
				<Suspense fallback={<LoadingScreen />}>
					<TreeWorkspace view={data.view} />
				</Suspense>
			</LoadBoundary>
			{data.notice && (
				<RefreshNotice
					failure={data.notice}
					onRetry={load}
					onDismiss={() =>
						setData((current) =>
							current.state === "ready" ? { ...current, notice: null } : current,
						)
					}
				/>
			)}
		</>
	);
}

/**
 * A re-read that failed while the family stayed on screen.
 *
 * Bottom centre, where the canvas reports its own writes, so the notice lands where the
 * eye already is after saving; it sits above those toasts because it is the newer news.
 * Dismissible, because it is fixed over the canvas and a phone has no spare lane for it.
 */
function RefreshNotice({
	failure,
	onRetry,
	onDismiss,
}: {
	failure: Failure;
	onRetry: () => Promise<void>;
	onDismiss: () => void;
}) {
	const [retrying, startRetry] = useTransition();
	const remedy = {
		retry: (
			<button
				type="button"
				disabled={retrying}
				onClick={() => startRetry(onRetry)}
				className="min-h-11 shrink-0 rounded-lg px-3 font-medium text-accent-ink hover:bg-surface-raised disabled:opacity-60"
			>
				{retrying ? "Trying..." : "Try again"}
			</button>
		),
		reload: (
			<button
				type="button"
				onClick={() => window.location.reload()}
				className="min-h-11 shrink-0 rounded-lg px-3 font-medium text-accent-ink hover:bg-surface-raised"
			>
				Reload
			</button>
		),
		"sign-in": (
			<a
				href={import.meta.env.BASE_URL}
				className="flex min-h-11 shrink-0 items-center rounded-lg px-3 font-medium text-accent-ink hover:bg-surface-raised"
			>
				Sign in
			</a>
		),
	}[failure.remedy];

	return (
		<div
			role="alert"
			className="fixed bottom-4 left-1/2 z-50 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-1 rounded-xl border border-danger/40 bg-surface py-1 pr-1 pl-4 text-sm text-ink shadow-(--kf-shadow-panel)"
		>
			<p className="min-w-0 py-2 leading-snug">
				{failure.message}
				{failure.remedy === "retry" && " What is on screen may be out of date."}
			</p>
			{remedy}
			<button
				type="button"
				onClick={onDismiss}
				aria-label="Dismiss"
				className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-raised hover:text-ink"
			>
				<X className="size-4" strokeWidth={1.75} aria-hidden="true" />
			</button>
		</div>
	);
}

export { callbackUrl };
