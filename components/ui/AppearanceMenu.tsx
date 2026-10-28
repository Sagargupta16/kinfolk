"use client";

import { Settings2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEscapeClose } from "@/components/tree/escape";
import { ThemeControls } from "@/components/tree/ThemeControls";

/** The panel's distance from either edge of the screen, matching its 1.5rem width allowance. */
const EDGE = 12;

/** One reachable appearance control in both the public page and the canvas header. */
export function AppearanceMenu() {
	const [open, setOpen] = useState(false);
	/** How far right of the button's own edge the panel is moved to stay on screen. */
	const [shift, setShift] = useState(0);
	const wrapper = useRef<HTMLDivElement>(null);
	const panel = useRef<HTMLElement>(null);
	useEscapeClose(open, () => setOpen(false));

	useEffect(() => {
		if (!open) return;
		const dismiss = (event: PointerEvent) => {
			if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
		};
		window.addEventListener("pointerdown", dismiss);
		return () => window.removeEventListener("pointerdown", dismiss);
	}, [open]);

	/**
	 * Keep the panel inside the viewport.
	 *
	 * It hangs from the button's right edge, and on a phone that edge is not the screen's:
	 * a signed-in owner has Share and the account menu to its right, so a panel extending
	 * leftwards from there opened 11px off a 375px screen and lost its first button at
	 * 320px. Measured before paint and on every resize, from the rendered width rather
	 * than a constant, because the width is in rem and a reader's text size changes it.
	 */
	useLayoutEffect(() => {
		if (!open) return;
		const place = () => {
			const button = wrapper.current?.getBoundingClientRect();
			const width = panel.current?.offsetWidth;
			if (!button || !width) return;
			setShift(Math.max(0, EDGE - (button.right - width)));
		};
		place();
		window.addEventListener("resize", place);
		return () => window.removeEventListener("resize", place);
	}, [open]);

	return (
		<div ref={wrapper} className="relative shrink-0">
			<button
				type="button"
				className="kf-header-control flex size-11 items-center justify-center border border-hairline text-ink-muted hover:text-ink"
				aria-label="Appearance settings"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
			>
				<Settings2 aria-hidden="true" className="size-4" strokeWidth={1.6} />
			</button>
			{open && (
				<section
					ref={panel}
					aria-label="Appearance"
					style={{ right: -shift }}
					className="kf-appearance-menu absolute top-[calc(100%+0.5rem)] z-50 w-[min(16rem,calc(100vw-1.5rem))] rounded-2xl border border-hairline-strong bg-surface p-4 shadow-(--kf-shadow-panel)"
				>
					<div className="mb-2 flex items-center justify-between">
						<h2 className="text-sm font-semibold text-ink">Make it yours</h2>
						<button
							type="button"
							onClick={() => setOpen(false)}
							className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-raised hover:text-ink"
							aria-label="Close appearance settings"
						>
							<X className="size-4" strokeWidth={1.75} aria-hidden="true" />
						</button>
					</div>
					<p className="mb-3 text-xs text-ink-faint">Theme and motion, saved on this device.</p>
					<ThemeControls className="flex-wrap" />
				</section>
			)}
		</div>
	);
}
