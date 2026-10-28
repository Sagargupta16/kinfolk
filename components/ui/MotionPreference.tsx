"use client";

import { MotionConfig } from "motion/react";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { followSystemScheme, MOTION_ATTR } from "@/lib/theme";

function subscribe(onChange: () => void) {
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: [MOTION_ATTR] });
	return () => observer.disconnect();
}

function snapshot() {
	return document.documentElement.getAttribute(MOTION_ATTR) === "off";
}

/**
 * Motion and CSS share the same persisted, explicit preference.
 *
 * Also where a `system` theme follows the OS: this is the one client component the Next
 * layout and the SPA entry both mount on every page, so it is the only place a listener
 * lives for as long as the page does.
 */
export function MotionPreference({ children }: { children: ReactNode }) {
	const reduced = useSyncExternalStore(subscribe, snapshot, () => false);
	useEffect(() => followSystemScheme(), []);
	return <MotionConfig reducedMotion={reduced ? "always" : "never"}>{children}</MotionConfig>;
}
