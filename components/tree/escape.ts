"use client";

/**
 * One Escape press closes ONE surface.
 *
 * Ten floating surfaces (panels, sheets, menus, the legend, the help overlay) can
 * overlap, and each used to hold its own document- or window-level keydown listener
 * -- so a single press closed every open surface at once. Open the feed, open a
 * person, start editing them, press Escape: all three vanished, when the gesture
 * meant "back out one step".
 *
 * A module-level stack rather than React context, because the surfaces mount under
 * different providers (React Flow panels, fixed-position chrome, the account bar
 * outside the canvas) and the only coordination they need is "who is on top".
 * Registration order IS stacking order: a surface registers when it opens, so the
 * most recently opened surface is the one a press closes.
 *
 * Not `stopImmediatePropagation` across per-surface listeners: that depends on the
 * order addEventListener happened to run, which is mount order, not opening order.
 */
import { useEffect, useRef } from "react";

type Close = () => void;

/** Open surfaces, bottom to top. */
const stack: Close[] = [];

function onKeydown(event: KeyboardEvent): void {
	if (event.key !== "Escape") return;
	// Somebody earlier in the dispatch already claimed this press -- the search box
	// closing its own dropdown is the real case (its React handler runs first and
	// calls preventDefault).
	if (event.defaultPrevented) return;
	const top = stack.at(-1);
	if (!top) return;
	// Claimed: useShortcuts checks this flag before treating Escape as "clear the
	// selection", so closing a surface never also strips the selection under it.
	event.preventDefault();
	top();
}

/** The document listener exists only while something is open. */
function register(close: Close): () => void {
	if (stack.length === 0) document.addEventListener("keydown", onKeydown);
	stack.push(close);
	return () => {
		const index = stack.indexOf(close);
		if (index !== -1) stack.splice(index, 1);
		if (stack.length === 0) document.removeEventListener("keydown", onKeydown);
	};
}

/**
 * Close this surface on Escape, coordinated with every other open surface.
 *
 * `active` is whether the surface is currently OPEN, not whether it is mounted --
 * most of these panels stay mounted with a boolean. `close` is read through a ref so
 * a fresh closure per render does not re-register: re-registering would move a
 * long-open surface to the top of the stack and Escape would close things out of
 * order.
 */
export function useEscapeClose(active: boolean, close: Close): void {
	const closeRef = useRef(close);
	useEffect(() => {
		closeRef.current = close;
	}, [close]);

	useEffect(() => {
		if (!active) return;
		return register(() => closeRef.current());
	}, [active]);
}
