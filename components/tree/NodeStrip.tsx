"use client";

/**
 * The one small strip both card actions open: no header, no sections, anchored to the card.
 *
 * The earlier sheet was a box with a heading row, field labels and a close button, centred
 * on a desktop and docked at the bottom of a phone: three sections between a `+` and the
 * name it asks for, and nothing tying it to the card that opened it. This strip grows OUT of
 * the control that opened it and folds back into it, follows the card while the canvas pans,
 * and holds only the fields and the answer buttons. Its accessible name says whose relative
 * or whose record it is, so a screen reader hears what the picture shows.
 *
 * Positioned with transform (Motion's `x` / `y`), never `top` / `left`, so following a pan is
 * a compositor move rather than a layout. On a narrow canvas it docks along the bottom edge
 * instead, where a phone keyboard expects an input, and still grows from the `+` above it.
 */
import { useStore } from "@xyflow/react";
import { motion, useAnimate, type Variants } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MOTION_ATTR } from "@/lib/theme";
import { placeStrip, type StripSide } from "@/lib/tree/node-add";
import { cn } from "@/lib/utils";
import { useEscapeClose } from "./escape";

/** Below this canvas width the strip docks at the bottom, like the profile sheet. */
const DOCK_BELOW = 640;
const MARGIN = 12;

/**
 * Opens on a quick spring from its origin, and the rows follow 45ms apart.
 *
 * A spring rather than an overshooting cubic-bezier: it settles because it is damped, not
 * because a curve was drawn past 1. It folds away faster than it opened, at about 75% of
 * the entrance, on an ease-in, so leaving reads as going back into the `+`.
 */
const strip: Variants = {
	closed: { opacity: 0, scale: 0.35 },
	open: {
		opacity: 1,
		scale: 1,
		transition: {
			type: "spring",
			stiffness: 520,
			damping: 34,
			mass: 0.7,
			staggerChildren: 0.045,
			delayChildren: 0.06,
		},
	},
	gone: { opacity: 0, scale: 0.4, transition: { duration: 0.16, ease: [0.55, 0, 1, 0.45] } },
};

/** One row of a strip, rising into place once the strip has opened. */
export const stripRow: Variants = {
	closed: { opacity: 0, y: 6 },
	open: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
};

/**
 * A short head shake on the element, each time `trigger` takes a new truthy value.
 *
 * The answer to "that did not save": the strip refuses in the same place the person is
 * looking, rather than only printing a line they might not read. Skipped under the Reduced
 * setting, like the canvas travel.
 */
export function useShake<T extends HTMLElement>(trigger: unknown) {
	const [scope, animate] = useAnimate<T>();
	useEffect(() => {
		if (!trigger || !scope.current) return;
		if (document.documentElement.getAttribute(MOTION_ATTR) === "off") return;
		void animate(scope.current, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.32, ease: "easeOut" });
	}, [trigger, animate, scope]);
	return scope;
}

export function NodeStrip({
	anchor,
	side,
	label,
	onClose,
	children,
}: {
	/** The control's point in FLOW coordinates, so the strip moves with the card as it pans. */
	anchor: { x: number; y: number };
	side: StripSide;
	/** The dialog's accessible name: whose relative, or whose record. */
	label: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const [tx, ty, zoom] = useStore((state) => state.transform);
	const layer = useRef<HTMLDivElement>(null);
	const box = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 336, height: 128 });
	const [bounds, setBounds] = useState<{ width: number; height: number } | null>(null);

	// Through the shared stack (escape.ts): the strip opens on top, so it closes first.
	useEscapeClose(true, onClose);

	// Measured rather than assumed: a family choice or an error makes the strip taller, and the
	// placement has to keep the whole of it on screen.
	useLayoutEffect(() => {
		const host = layer.current;
		const element = box.current;
		if (!host || !element) return;
		const measure = () => {
			const width = element.offsetWidth;
			const height = element.offsetHeight;
			setSize((current) =>
				current.width === width && current.height === height ? current : { width, height },
			);
			setBounds((current) =>
				current && current.width === host.clientWidth && current.height === host.clientHeight
					? current
					: { width: host.clientWidth, height: host.clientHeight },
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(host);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const point = { x: anchor.x * zoom + tx, y: anchor.y * zoom + ty };
	const docked = bounds !== null && bounds.width < DOCK_BELOW;
	let place: { left: number; top: number; originX: number; originY: number } | null = null;
	if (bounds && docked) {
		const top = bounds.height - size.height - MARGIN;
		place = { left: MARGIN, top, originX: point.x - MARGIN, originY: point.y - top };
	} else if (bounds) {
		place = placeStrip(point, side, size, bounds);
	}

	return (
		<div ref={layer} className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
			<motion.div
				ref={box}
				role="dialog"
				aria-modal="false"
				aria-label={label}
				variants={strip}
				initial="closed"
				animate="open"
				exit="gone"
				className={cn("kf-glass kf-strip pointer-events-auto", docked && "kf-strip--docked")}
				style={{
					x: place?.left ?? 0,
					y: place?.top ?? 0,
					transformOrigin: place ? `${place.originX}px ${place.originY}px` : "50% 50%",
					visibility: place ? "visible" : "hidden",
				}}
			>
				{children}
			</motion.div>
		</div>
	);
}
