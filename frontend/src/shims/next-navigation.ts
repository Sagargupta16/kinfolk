/**
 * `next/navigation`, for the SPA.
 *
 * `TreeCanvas` uses exactly one thing from it: `router.replace()` to write the
 * focused person into the URL so a view can be linked and the back button works.
 * That is `history.replaceState` with extra steps, so it shims cleanly.
 *
 * `refresh()` is the interesting one. In the Next app it re-runs the server
 * component and re-renders with fresh data, which is how the canvas updates after
 * a write. Here there is no server render to re-run, so it dispatches an event the
 * SPA listens for and answers by re-fetching `/api/tree`. Same contract -- "the
 * data may have changed, go and look" -- with a different mechanism underneath.
 */

/** The event `refresh()` raises, so the SPA can re-fetch the view. */
export const REFRESH_EVENT = "kinfolk:refresh";

export function useRouter() {
	return {
		replace(url: string) {
			window.history.replaceState(null, "", url);
		},
		push(url: string) {
			window.history.pushState(null, "", url);
		},
		back() {
			window.history.back();
		},
		forward() {
			window.history.forward();
		},
		/**
		 * Ask the app to re-read its data.
		 *
		 * Deliberately NOT `location.reload()`, which is the lazy shim and would
		 * throw away the canvas viewport, the collapse state and the open panel --
		 * every bit of where-you-were, on every single edit.
		 */
		refresh() {
			window.dispatchEvent(new Event(REFRESH_EVENT));
		},
		prefetch() {},
	};
}

/**
 * `redirect()`, as a navigation.
 *
 * In Next this throws a control-flow signal that unwinds the render and sends a
 * Location header. Here it navigates, which is the closest honest equivalent -- and
 * it must NOT return, because the callers (`lib/tree/demo-actions.ts`) treat
 * everything after it as unreachable.
 */
export function redirect(url: string): never {
	const base = import.meta.env.BASE_URL.replace(/\/$/, "");
	window.location.assign(url.startsWith("/") ? `${base}${url}` : url);
	// `assign` does not stop execution, so this keeps the `never` contract that the
	// callers rely on for their own control flow.
	throw new Error(`Redirecting to ${url}`);
}

export function usePathname() {
	return window.location.pathname;
}

export function useSearchParams() {
	return new URLSearchParams(window.location.search);
}
