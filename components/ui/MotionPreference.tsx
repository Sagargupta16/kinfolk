"use client";

import { MotionConfig } from "motion/react";
import { type ReactNode, useSyncExternalStore } from "react";
import { MOTION_ATTR } from "@/lib/theme";

function subscribe(onChange: () => void) {
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: [MOTION_ATTR] });
	return () => observer.disconnect();
}

function snapshot() {
	return document.documentElement.getAttribute(MOTION_ATTR) === "off";
}

/** Motion and CSS share the same persisted, explicit preference. */
export function MotionPreference({ children }: { children: ReactNode }) {
	const reduced = useSyncExternalStore(subscribe, snapshot, () => false);
	return <MotionConfig reducedMotion={reduced ? "always" : "never"}>{children}</MotionConfig>;
}
