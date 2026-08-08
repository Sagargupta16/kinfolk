"use client";

/**
 * How the graph is arranged, and whether cards are tilted.
 *
 * Two separate controls rather than one list of presets, because they answer different
 * questions and compose: an orbit can be flat or tilted, and so can a tree. Folding them
 * into "Tree / Orbit / Orbit 3D" would triple as soon as a third arrangement arrived.
 */
import { Boxes, GitBranch, Orbit } from "lucide-react";
import { cn } from "@/lib/utils";

/** The arrangements. Ordered as they are learned: the pedigree first. */
export type ViewMode = "tree" | "orbit";

const MODES: { value: ViewMode; label: string; hint: string; Icon: typeof Orbit }[] = [
	{
		value: "tree",
		label: "Tree",
		hint: "Generations in rows, oldest at the top",
		Icon: GitBranch,
	},
	{
		value: "orbit",
		label: "Orbit",
		hint: "One person at the centre, everyone else by how close they are",
		Icon: Orbit,
	},
];

export function ViewControls({
	mode,
	onMode,
	depth,
	onDepth,
	/** Orbit needs somebody to orbit, so it is unavailable when nobody is selected. */
	canOrbit,
}: {
	mode: ViewMode;
	onMode: (mode: ViewMode) => void;
	depth: boolean;
	onDepth: (depth: boolean) => void;
	canOrbit: boolean;
}) {
	return (
		<div className="flex items-center gap-1.5">
			<fieldset aria-label="Arrangement" className="kf-glass flex overflow-hidden rounded-lg">
				{MODES.map(({ value, label, hint, Icon }) => {
					// Orbit with no focus would have nothing at its centre, so the control says so
					// rather than switching to an empty canvas. Disabled here rather than hidden:
					// unlike the editor, this button becomes usable the moment you tap somebody, and
					// a control that appears on selection would be a surprise.
					const unavailable = value === "orbit" && !canOrbit;
					return (
						<button
							key={value}
							type="button"
							onClick={() => onMode(value)}
							disabled={unavailable}
							aria-pressed={mode === value}
							title={unavailable ? "Select a person first, then orbit around them" : hint}
							className={cn(
								"flex min-h-11 min-w-11 items-center justify-center gap-1.5 border-r border-hairline px-2.5 last:border-r-0",
								"font-mono text-[0.625rem] uppercase tracking-wider",
								"transition-colors duration-(--duration-fast) ease-(--ease-out)",
								mode === value
									? "bg-surface-raised text-accent-ink"
									: "text-ink-faint hover:bg-surface-raised hover:text-ink",
								unavailable &&
									"cursor-not-allowed opacity-40 hover:bg-transparent hover:text-ink-faint",
							)}
						>
							<Icon aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
							<span className="hidden sm:inline">{label}</span>
						</button>
					);
				})}
			</fieldset>

			{/*
			 * Depth is a switch, not a third arrangement: it composes with both.
			 *
			 * Off by default. A tilted plane is the more striking first impression and the worse
			 * default, because text on an 8 degree plane is harder to read and this canvas is
			 * mostly names -- so depth is offered rather than imposed.
			 */}
			<button
				type="button"
				onClick={() => onDepth(!depth)}
				aria-pressed={depth}
				title={depth ? "Lay the cards flat" : "Tilt the cards into depth"}
				className={cn(
					"kf-glass flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5",
					"font-mono text-[0.625rem] uppercase tracking-wider",
					"transition-colors duration-(--duration-fast) ease-(--ease-out)",
					depth ? "text-accent-ink" : "text-ink-faint hover:text-ink",
				)}
			>
				<Boxes aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
				<span className="hidden sm:inline">3D</span>
			</button>
		</div>
	);
}
