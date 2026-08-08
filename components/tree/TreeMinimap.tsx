"use client";

/**
 * Where you are in a canvas 10760px wide.
 *
 * At any zoom you can read a name at, a phone shows about 4% of this tree and a
 * laptop about 13%. Panning from there is dead reckoning: every direction looks the
 * same, and there is nothing to say whether the rest of the family is left, right, or
 * already behind you. The `You` button rescues a viewer who is lost, but only by
 * throwing away where they were.
 *
 * ## Why this is not `<MiniMap>`
 *
 * React Flow ships one, and it was the first implementation here. Two things ruled it
 * out, both measured on this tree rather than assumed:
 *
 *   1. **Its frame moves.** The projection is built from
 *      `getBoundsOfRects(nodeBounds, viewBB)` -- the graph unioned with the CURRENT
 *      viewport -- so zooming out grows the box and shrinks the tree inside it. At the
 *      fit zoom this canvas opens at, the tree occupied 42% of the width and 17% of the
 *      height, drifting as the viewer zoomed. An overview whose frame changes is not a
 *      reference point; the one thing it owes you is that the shape stays put.
 *   2. **Its box is a fixed 200x150.** This graph is 9.5:1 as cards and 3.1:1 as dots,
 *      so a fixed panel spends most of its area on nothing at whichever level it was
 *      not tuned for. Ours is shaped to the extent, and fills 97% of the width.
 *
 * All the arithmetic lives in lib/tree/overview.ts, where it is unit-testable -- both
 * bugs it has already had were invisible in the file and obvious in a measurement.
 *
 * Nodes carry the canvas's own meaning: the living/deceased/unknown palette the dots
 * use, with the viewer in accent. A second colour language in the corner would be one
 * more thing to learn, and the value of an overview is being read without study.
 */
import { useReactFlow, useStore } from "@xyflow/react";
import { Map as MapIcon, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { Box } from "@/lib/tree/layout";
import {
	OVERVIEW_WIDTH,
	type OverviewNode,
	type OverviewTone,
	overviewHeight,
	overviewPoint,
	overviewProjection,
	overviewViewport,
} from "@/lib/tree/overview";
import { cn } from "@/lib/utils";

/**
 * Fill per tone. See `OverviewTone` for why the vocabulary is this short.
 *
 * `living` is deliberately NOT green here, for the reason the card's rail is not either:
 * 93 of the 152 rects are living people, so a saturated fill made the whole map a strip
 * of green dashes and the ONE accent rect that marks the viewer -- the single landmark
 * this panel exists to provide -- had to compete with it. Measured on the screenshot
 * rather than per element, which is the only way a 93-against-1 ratio shows up.
 *
 * So the majority state takes the neutral ink and the accent stays unique. `past` keeps
 * its own quieter grey, since deceased is the minority and the contrast between the two
 * greys still reads at 4px. `unsure` and `junction` share it: they used the hairline
 * token, which on this panel's opaque surface measured ~1.6:1 -- present in the DOM and
 * invisible on the map, where every mark owes the 3:1 a meaningful graphic does.
 */
const TONE_FILL: Record<OverviewTone, string> = {
	self: "var(--color-accent)",
	living: "var(--color-edge)",
	past: "var(--color-past)",
	unsure: "var(--color-past)",
	junction: "var(--color-past)",
};

/**
 * The tree as boxes. Its own MEMOISED component so it re-renders only when positions
 * change and not on every pan or panel toggle: the viewport rectangle below is the part
 * that tracks the viewer, and these 152 rects are the part that does not.
 */
const OverviewShapes = memo(function OverviewShapes({
	nodes,
	extent,
	height,
}: {
	nodes: OverviewNode[];
	extent: Box;
	height: number;
}) {
	const { scale, offsetX, offsetY } = overviewProjection(extent, height);
	if (scale <= 0) return null;

	return (
		<g>
			{nodes.map((node) => (
				<rect
					key={node.id}
					x={offsetX + (node.x - extent.x) * scale}
					y={offsetY + (node.y - extent.y) * scale}
					// Floored at 1px, not scaled down to nothing: at dot level a 12px union
					// projects to 0.3px, and a sub-pixel rect paints nothing at all -- so the
					// couples would lose the junction that makes them a couple.
					width={Math.max(node.width * scale, 1)}
					height={Math.max(node.height * scale, 1)}
					fill={TONE_FILL[node.tone]}
					// A person is ~4px wide here. Anti-aliasing that box across two device
					// pixels turns the palette into mud, which is the one thing the map
					// carries.
					shapeRendering="crispEdges"
				/>
			))}
		</g>
	);
});

/**
 * The viewer's window on the tree.
 *
 * Subscribed to the transform in its own component so a pan re-renders this one
 * rectangle instead of all 151 boxes above it.
 */
function ViewportRect({ extent, height }: { extent: Box; height: number }) {
	const transform = useStore((state) => state.transform);
	const flowWidth = useStore((state) => state.width);
	const flowHeight = useStore((state) => state.height);

	const rect = overviewViewport(extent, height, transform, {
		width: flowWidth,
		height: flowHeight,
	});
	if (!rect) return null;

	return (
		<rect
			x={rect.x}
			y={rect.y}
			width={rect.width}
			height={rect.height}
			// Outlined rather than filled. A wash over everything outside the viewport is
			// what React Flow draws, and on a strip this thin it buries the very nodes it is
			// meant to locate you among. An accent outline is the same information with
			// nothing hidden -- and being the accent it owes 3:1 as a meaningful graphic,
			// which the token already carries.
			fill="none"
			stroke="var(--color-accent)"
			strokeWidth={1}
			rx={1}
			pointerEvents="none"
		/>
	);
}

export function TreeMinimap({ nodes, extent }: { nodes: OverviewNode[]; extent: Box }) {
	/**
	 * Closed on a touch screen, open on a pointer device.
	 *
	 * Not a taste call in either direction. A laptop has corner space going spare and an
	 * overview is only useful if it is already there when you get lost. A phone does not:
	 * 200px of a 375px screen is over half the width, parked over the tree it describes.
	 * So it starts collapsed there and stays one tap away.
	 *
	 * Read in an effect rather than during render, because the server has no `matchMedia`
	 * and a guess would make the first paint disagree with the markup it hydrates.
	 */
	const [open, setOpen] = useState(false);

	useEffect(() => {
		setOpen(!window.matchMedia("(pointer: coarse)").matches);
	}, []);

	const height = overviewHeight(extent);
	const { setCenter, getZoom } = useReactFlow();
	const svgRef = useRef<SVGSVGElement>(null);

	/**
	 * Click or drag to travel there, at the zoom the viewer is already using.
	 *
	 * Centre-on-point rather than React Flow's `pannable`, which translates the viewport
	 * by the pointer's delta: on a projection this coarse one panel pixel is ~54 graph
	 * units, so a 2px twitch throws the canvas half a generation sideways. Aiming
	 * absolutely means the thing you pointed at is the thing you get.
	 *
	 * The zoom is deliberately preserved. An overview answers "where", and a viewer who
	 * has chosen a reading zoom did not ask to leave it.
	 */
	const travel = useCallback(
		(event: React.PointerEvent<SVGSVGElement>) => {
			const svg = svgRef.current;
			if (!svg) return;

			const rect = svg.getBoundingClientRect();
			const point = overviewPoint(
				extent,
				height,
				event.clientX - rect.left,
				event.clientY - rect.top,
			);
			if (!point) return;

			void setCenter(point.x, point.y, { zoom: getZoom(), duration: 260 });
		},
		[extent, height, setCenter, getZoom],
	);

	return (
		<div className="pointer-events-auto flex flex-col items-end gap-1.5">
			{open && (
				/*
				 * An OPAQUE panel, like the legend. The svg alone floated its 152 dashes
				 * directly over whatever cards happened to be in the corner, which read as
				 * rendering garbage rather than as an overview -- the map only works as a
				 * reference if it owns its own quiet surface.
				 */
				<div className="rounded-lg border border-hairline-strong bg-surface p-1 shadow-(--kf-shadow-panel)">
					<svg
						ref={svgRef}
						width={OVERVIEW_WIDTH}
						height={height}
						viewBox={`0 0 ${OVERVIEW_WIDTH} ${height}`}
						className="kf-overview block"
						onPointerDown={travel}
						// Dragging keeps aiming, so a viewer can sweep along a generation and watch
						// the canvas follow. Keyed on `buttons` rather than a captured flag: a
						// pointerup outside the panel would leave a boolean stuck on.
						onPointerMove={(event) => {
							if (event.buttons === 1) travel(event);
						}}
						role="img"
						aria-label="Overview of the whole graph. Click to travel there."
					>
						<title>Overview of the whole graph. Click to travel there.</title>
						<OverviewShapes nodes={nodes} extent={extent} height={height} />
						<ViewportRect extent={extent} height={height} />
					</svg>
				</div>
			)}

			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				title={open ? "Hide the overview" : "Show the overview"}
				className={cn(
					"flex min-h-11 items-center gap-1.5 rounded-md border px-2.5",
					"bg-surface/90 font-mono text-[0.625rem] uppercase tracking-wider backdrop-blur-sm",
					"transition-colors duration-(--duration-fast) ease-(--ease-out)",
					open
						? // `accent-ink`, not the raw accent: 10px type owes 4.5:1, which the
							// graphic-grade accent does not clear on this surface.
							"border-hairline-strong text-accent-ink"
						: "border-hairline text-ink-faint hover:border-hairline-strong hover:text-ink",
				)}
			>
				{open ? (
					<X aria-hidden className="size-3.5" strokeWidth={1.5} />
				) : (
					<MapIcon aria-hidden className="size-3.5" strokeWidth={1.5} />
				)}
				Map
			</button>
		</div>
	);
}
