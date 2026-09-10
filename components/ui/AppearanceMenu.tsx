"use client";

import { Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEscapeClose } from "@/components/tree/escape";
import { ThemeControls } from "@/components/tree/ThemeControls";

/** One reachable appearance control in both the public page and the canvas header. */
export function AppearanceMenu() {
	const [open, setOpen] = useState(false);
	const wrapper = useRef<HTMLDivElement>(null);
	useEscapeClose(open, () => setOpen(false));

	useEffect(() => {
		if (!open) return;
		const dismiss = (event: PointerEvent) => {
			if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
		};
		window.addEventListener("pointerdown", dismiss);
		return () => window.removeEventListener("pointerdown", dismiss);
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
					aria-label="Appearance"
					className="kf-appearance-menu absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 rounded-2xl border border-hairline-strong bg-surface p-4 shadow-(--kf-shadow-panel)"
				>
					<div className="mb-2 flex items-center justify-between">
						<h2 className="text-sm font-semibold text-ink">Make it yours</h2>
						<button
							type="button"
							onClick={() => setOpen(false)}
							className="-mr-2 flex size-11 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-raised hover:text-ink"
							aria-label="Close appearance settings"
						>
							<X className="size-4" aria-hidden="true" />
						</button>
					</div>
					<p className="mb-3 text-xs text-ink-faint">Theme and motion, saved on this device.</p>
					<ThemeControls className="flex-wrap" />
				</section>
			)}
		</div>
	);
}
