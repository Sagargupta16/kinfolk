"use client";

import { useSyncExternalStore } from "react";

const DESKTOP_SHEET = "(min-width: 640px)";

function subscribe(onChange: () => void) {
	const query = window.matchMedia(DESKTOP_SHEET);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

function getSnapshot() {
	return window.matchMedia(DESKTOP_SHEET).matches;
}

function getServerSnapshot() {
	return false;
}

/** Right-hand rail on desktop, bottom sheet on mobile. */
export function useSheetMotion() {
	const desktop = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

	return {
		closed: desktop ? { opacity: 0, x: "100%", y: 0 } : { opacity: 0, x: 0, y: "100%" },
		open: { opacity: 1, x: 0, y: 0 },
	};
}
