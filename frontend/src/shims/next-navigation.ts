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

export function usePathname() {
	return window.location.pathname;
}

export function useSearchParams() {
	return new URLSearchParams(window.location.search);
}
