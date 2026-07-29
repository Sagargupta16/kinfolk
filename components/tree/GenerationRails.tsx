"use client";

/**
 * Horizontal rails, one per generation, drawn underneath the graph.
 *
 * Without them a family tree renders as a generic node graph: you can see who
 * connects to whom but not that a row IS a generation. The rails make the rows
 * legible as rows, which is the one piece of structure a pedigree has that an
 * arbitrary graph does not.
 *
 * Geometry comes inline because it is data (ELK's output). Colour comes from
 * globals.css because it is design.
 */
import { ViewportPortal } from "@xyflow/react";
import type { GenerationBand } from "@/lib/tree/layout";

/** Roman numerals read as an archive index; Arabic ones read as a table row. */
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** How far a rail runs past the widest row, so it reads as continuing. */
const BLEED = 72;
/** Half the inter-row gap, leaving a visible gutter between adjacent rails. */
const BAND_PAD = 20;

export function GenerationRails({ bands }: { bands: GenerationBand[] }) {
	if (bands.length === 0) return null;

	// Every rail spans the whole graph, not just its own row. Ragged-right rails
	// would read as bar charts of how many people are in each generation.
	const left = Math.min(...bands.map((band) => band.left)) - BLEED;
	const right = Math.max(...bands.map((band) => band.right)) + BLEED;

	return (
		// The portal puts these inside React Flow's transformed viewport, so the
		// coordinates below are graph coordinates and pan and zoom come for free.
		<ViewportPortal>
			{/* Behind the edges and cards. Rails are ground, not figure. */}
			<div className="kf-rails">
				{bands.map((band, index) => (
					<div
						key={band.top}
						className={index % 2 === 1 ? "kf-rail kf-rail--alt" : "kf-rail"}
						style={{
							left,
							top: band.top - BAND_PAD,
							width: right - left,
							height: band.bottom - band.top + BAND_PAD * 2,
						}}
					>
						<span className="kf-rail__label">
							<span className="kf-rail__numeral">{NUMERALS[index] ?? index + 1}</span>
							{band.count}
						</span>
					</div>
				))}
			</div>
		</ViewportPortal>
	);
}
