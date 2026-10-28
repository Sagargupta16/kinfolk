"use client";

/**
 * A part of the page whose code failed to load or to render.
 *
 * Lazy surfaces (the SPA's canvas and contact page, the record-link panel in both
 * runtimes) arrive as separate chunks, and a deploy that lands while a tab is open removes
 * the chunks that tab still expects. The import rejects, React has nowhere to put the
 * error, and the whole tree unmounts to a blank page. This turns that into a sentence and
 * a way out, supplied by the caller because a panel and a page need different ones.
 *
 * There is no retry without a reload: `lazy()` caches its rejected promise, so rendering
 * the same component again throws the same error. Reloading fetches the current build.
 *
 * A class because React still has no hook that catches a render error; this is the only
 * thing in the repo that needs one. Its own module so the SPA entry can wrap the app
 * without pulling the canvas states and their animation library into the first bundle.
 */
import { Component, type ReactNode } from "react";

export class LoadBoundary extends Component<
	{ fallback: ReactNode; children: ReactNode },
	{ failed: boolean }
> {
	override state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	override render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}
