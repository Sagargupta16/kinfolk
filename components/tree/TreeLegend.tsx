"use client";

/**
 * The key to the canvas.
 *
 * This graph encodes eight things without words: dash rhythm is the category of a
 * relation, stroke weight is how close it is, a 2px rail is living or dead, a tick is
 * how well attested somebody is, a ring is how connected they are, offset sheets are
 * how many families recorded them. Each was chosen because a mark is read faster than
 * a label -- which only holds once you know what the mark means, and until now nothing
 * on screen said.
 *
 * Three rules keep it honest, and they are the reason this is worth a file:
 *
 *   1. The rows are DERIVED. Categories come from `RELATION_KINDS`, dash patterns from
 *      the same `--kf-dash-*` tokens the edge rules read, provenance marks from the
 *      map the card renders. A legend hand-written next to the thing it describes
 *      drifts, and a drifted legend is worse than none: it is read once, believed, and
 *      never checked again.
 *   2. A row only appears when its encoding is ON THIS CANVAS. Not "when the app
 *      supports it" -- Kinfolk knows 17 relation kinds and no real family uses all of
 *      them, so a key listing every one sends a reader hunting for a line that is not
 *      there. `censusOf()` counts what is drawn and a zero drops the row.
 *   3. It is dismissable and starts closed. Anything permanently parked over a canvas
 *      is canvas taken from the graph, and this is read a handful of times and then
 *      never again.
 */
import { AtSign, KeyRound, Phone, ShieldQuestion, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useId, useState } from "react";
import type { TreeCensus } from "@/lib/tree/census";
import type { Lod } from "@/lib/tree/layout";
import { RELATION_KINDS, type RelationCategory } from "@/lib/tree/relations";
import { cn } from "@/lib/utils";
import { PROVENANCE, SEX_MARKS } from "./PersonNode";

/**
 * How each relation category is presented, keyed so a new category is a type error
 * here rather than a silently missing row.
 *
 * Ordered tightest dash to sparsest, matching the order the CSS claims maps onto
 * closeness-to-kinship. The dash is a `var()` rather than a literal: it is the same
 * token the edge rule reads, so a sample cannot describe a rhythm the canvas has
 * stopped drawing.
 */
const CATEGORIES: Record<RelationCategory, { label: string; dash: string }> = {
	kin: { label: "Extended kin", dash: "var(--kf-dash-kin)" },
	care: { label: "Care", dash: "var(--kf-dash-care)" },
	social: { label: "Social", dash: "var(--kf-dash-social)" },
	professional: { label: "Professional", dash: "var(--kf-dash-professional)" },
	other: { label: "Unspecified", dash: "var(--kf-dash-other)" },
};

const CATEGORY_ORDER = Object.keys(CATEGORIES) as RelationCategory[];

type Row = {
	sample: ReactNode;
	label: string;
	hint?: string;
	/**
	 * How many of these are on the canvas. Rendered as a count, and a zero drops the
	 * row entirely -- see rule 2 above.
	 */
	count: number;
	/** Levels of detail at which this encoding is drawn at all. Omitted means all. */
	lods?: Lod[];
};

/**
 * 28x8, the width a dash rhythm needs before it reads as a rhythm rather than a dash.
 *
 * Weights come from the `--kf-stroke-*` tokens for the same reason the dash patterns come
 * from `--kf-dash-*`: two readers depend on each value, and a sample drawn at a hardcoded
 * width is a key confidently describing a line the canvas no longer draws.
 */
function Line({
	dash,
	stroke = "var(--color-edge-soft)",
	width = "var(--kf-stroke-faint)",
	dot,
}: {
	dash?: string;
	stroke?: string;
	width?: string;
	/** A union node, drawn mid-line: the junction children hang from. */
	dot?: boolean;
}) {
	return (
		// `aria-hidden="true"` spelled out: the row's <dt> is this sample's accessible
		// name, so a <title> would announce every line twice. Biome's
		// noSvgWithoutTitle only recognises the string form, not the JSX shorthand.
		<svg aria-hidden="true" viewBox="0 0 28 8" className="h-2 w-7 shrink-0 overflow-visible">
			<line
				x1="0"
				y1="4"
				x2="28"
				y2="4"
				stroke={stroke}
				strokeLinecap="round"
				// Both inline, because a token has to resolve against this element's own
				// cascade; a Tailwind class could not carry an arbitrary var() here. Width
				// moved from the `strokeWidth` prop for that reason -- React would render
				// `stroke-width="var(...)"` as an attribute, which SVG does not resolve.
				style={{ strokeWidth: width, ...(dash ? { strokeDasharray: dash } : {}) }}
			/>
			{dot && <circle cx="14" cy="4" r="1.75" fill={stroke} />}
		</svg>
	);
}

/**
 * The closeness weights, stacked in one sample.
 *
 * One row rather than three: three near-identical lines listed separately would read
 * as three different encodings instead of one scale, which is the opposite of what a
 * key is for.
 */
function Weights() {
	return (
		<svg aria-hidden="true" viewBox="0 0 28 12" className="h-3 w-7 shrink-0">
			{["var(--kf-stroke-soft)", "var(--kf-stroke-skeleton)", "var(--kf-stroke-close)"].map(
				(width, index) => (
					<line
						key={width}
						x1="0"
						y1={1.5 + index * 4.5}
						x2="28"
						y2={1.5 + index * 4.5}
						// Accent, like the revealed relations these describe.
						stroke="var(--color-accent)"
						strokeLinecap="round"
						// The three steps of the closeness scale, read from the same tokens the
						// edge rules use. Hardcoded, this sample claimed a 0.75/1/1.4 scale for
						// months after those numbers changed -- and it would now be describing
						// the pre-reveal faint/soft/firm scale, which no relation is drawn at.
						style={{ strokeWidth: width }}
					/>
				),
			)}
		</svg>
	);
}

/** The 2px left edge of a card, at the width it is actually drawn. */
function Rail({ className }: { className: string }) {
	return <span aria-hidden className={cn("block h-3.5 w-0.5 shrink-0 rounded-full", className)} />;
}

function Dot({ className }: { className: string }) {
	return (
		<span aria-hidden className={cn("block size-2.5 shrink-0 rounded-full border", className)} />
	);
}

/** A miniature card, for the encodings that are properties of the box itself. */
function Card({ className, style }: { className?: string; style?: CSSProperties }) {
	return (
		<span
			aria-hidden
			className={cn(
				"block size-3 shrink-0 rounded-sm border border-hairline bg-surface",
				className,
			)}
			style={style}
		/>
	);
}

/**
 * Lines: the family skeleton, then the relation overlay.
 *
 * The overlay rows vanish with the overlay rather than greying out. A greyed row still
 * asserts "there is a rhythm for care" about a canvas that currently has no dashed
 * lines at all, which is a promise the reader cannot check.
 */
function lineRows(census: TreeCensus): Row[] {
	const rows: Row[] = [
		{
			sample: <Line stroke="var(--color-edge)" width="var(--kf-stroke-skeleton)" />,
			label: "Parent and child",
			hint: "The skeleton. Solid, and the only thing that sets a generation.",
			count: census.family,
		},
		{
			// Neutral, matching the canvas. This sample was `--color-accent-dim` back when 68
			// partner edges rendered amber; the skeleton is one colour now and a partnership is
			// told apart by running horizontally, which is what the dot in this sample shows.
			sample: <Line stroke="var(--color-edge)" width="var(--kf-stroke-skeleton)" dot />,
			label: "Partnership",
			hint: "Runs across, not down. Children hang from the dot.",
			count: census.partners,
		},
	];

	for (const category of CATEGORY_ORDER) {
		const { label, dash } = CATEGORIES[category];
		rows.push({
			// Accent and at skeleton weight, because that is how a REVEALED relation is drawn.
			// A grey hairline sample would describe the old permanent overlay.
			sample: <Line dash={dash} stroke="var(--color-accent)" width="var(--kf-stroke-skeleton)" />,
			label,
			// The kinds THIS tree contains, not every kind in the category: "professional"
			// is not what somebody is looking for, "colleague" is -- and listing
			// "employer" when nobody here has one is the same lie as listing an unused
			// category.
			hint: census.kinds[category].map((kind) => RELATION_KINDS[kind].label).join(", "),
			count: census.categories[category],
		});
	}

	rows.push(
		{
			// The taper, drawn with the same gradient the canvas uses rather than an
			// approximation of it. `Line` cannot express this: the sample needs its own
			// stops, and a second gradient id would be a second thing to keep in sync -- so
			// it references the one TreeCanvas defines, which is document-wide.
			sample: (
				<svg aria-hidden="true" viewBox="0 0 28 8" className="h-2 w-7 shrink-0">
					<line
						x1="0"
						y1="4"
						x2="28"
						y2="4"
						stroke="url(#kf-taper)"
						strokeLinecap="round"
						style={{
							strokeWidth: "var(--kf-stroke-soft)",
							strokeDasharray: "var(--kf-dash-professional)",
						}}
					/>
				</svg>
			),
			label: "Has a direction",
			hint: "Heavier where the role sits: A mentors B, not the other way round. Thins out towards the person it lands on.",
			count: census.directed,
		},
		{
			sample: <Weights />,
			label: "How close",
			hint: "Firmer line, closer tie. Weight only, so the dense core of somebody's world shows without reading a label.",
			// Zero when every relation here happens to share one weight, at which point
			// there is no scale on screen to explain.
			count: census.closenessLevels > 1 ? census.closenessLevels : 0,
		},
		{
			sample: <Line dash="var(--kf-dash-ended)" stroke="var(--color-edge-past)" />,
			label: "Over",
			hint: "A tie with an end date. Still recorded, drawn as history.",
			count: census.ended,
		},
	);

	return rows;
}

/**
 * The presence ring, which is the one card encoding that survives every detail level.
 *
 * Shared rather than duplicated: the ring is drawn behind a dot exactly as it is drawn
 * behind a card (it comes off `ringSpread`, not off the card's box), so listing it in
 * one branch and forgetting it in the other would be a row that disagrees with the
 * canvas at whichever level was overlooked. It was, at dot level, until the rings on
 * screen were counted.
 *
 * Structured the way the card structures it -- a `relative` wrapper, ring first, shape
 * over the top -- and not as one span wearing `kf-presence` plus a shape class. That
 * shortcut fails twice: the class is `position: absolute; inset: 0`, so with no
 * positioned parent the sample escapes its row and pins itself to the panel's corner,
 * and its `border-radius` beats a Tailwind `rounded-*` because plain CSS outranks a
 * utility layer. The radius is therefore passed in rather than classed on.
 */
function ringRow(census: TreeCensus, round: boolean): Row {
	return {
		sample: (
			<span aria-hidden className="relative block size-3 shrink-0">
				<span
					className="kf-presence"
					// A 12px sample stands in for a 200px card, and the node radius does not
					// scale down with it: at this size `--radius-node` would round the square
					// variant into the round one. Matched to the shape instead.
					style={{ "--kf-spread": "3px", borderRadius: round ? "9999px" : "2px" } as CSSProperties}
				/>
				<span
					className={cn(
						"absolute inset-0 border border-hairline bg-surface",
						round ? "rounded-full" : "rounded-sm",
					)}
				/>
			</span>
		),
		label: "Well connected",
		hint: "The ring spreads with how many people somebody joins.",
		count: census.ringed,
	};
}

/**
 * People: what a card says before you read it.
 *
 * At dot level almost none of it is drawn, so that level gets its own rows rather than
 * a filtered copy of these -- the encoding genuinely differs there, with the fill
 * carrying what the rail carries at card sizes.
 */
function personRows(census: TreeCensus, lod: Lod, hasSelf: boolean): Row[] {
	if (lod === "dot") {
		return [
			{
				sample: <Dot className="border-living bg-living/40" />,
				label: "Living",
				count: census.living,
			},
			{
				sample: <Dot className="border-past bg-canvas" />,
				label: "Deceased",
				hint: "Hollow, not recoloured: at this size the fill is the only channel still readable.",
				count: census.deceased,
			},
			{
				sample: <Dot className="border-hairline-strong bg-canvas" />,
				label: "Not recorded",
				count: census.livingUnknown,
			},
			ringRow(census, true),
			{
				sample: (
					<span
						aria-hidden
						className="block size-2.5 shrink-0 rounded-full bg-accent ring-1 ring-accent ring-offset-2 ring-offset-canvas"
					/>
				),
				label: "You",
				hint: "The widest mark on the canvas, so it survives being scaled down.",
				count: hasSelf ? 1 : 0,
			},
		];
	}

	const rows: Row[] = [
		{ sample: <Rail className="bg-living" />, label: "Living", count: census.living },
		{ sample: <Rail className="bg-past" />, label: "Deceased", count: census.deceased },
		{
			sample: <Rail className="bg-hairline-strong" />,
			label: "Not recorded",
			hint: "A real answer, not a missing one. Genealogy is mostly incomplete.",
			count: census.livingUnknown,
		},
	];

	// The sex glyphs, derived from SEX_MARKS rather than restated, and using the SAME
	// icon component the card renders. A hand-drawn approximation here would be a key
	// describing a glyph the canvas does not use, which is the one failure a legend
	// cannot survive.
	//
	// `unknown` gets a row like any other, and on most real graphs it will have the
	// largest count. That is the honest reading: it says how much of this record is
	// unfilled, where omitting it would imply the field is always known.
	for (const [value, { Icon, title }] of Object.entries(SEX_MARKS)) {
		rows.push({
			sample: <Icon aria-hidden className="size-3 shrink-0 text-ink-faint" strokeWidth={1.5} />,
			label: title.charAt(0).toUpperCase() + title.slice(1),
			count: census.sex[value as keyof TreeCensus["sex"]],
			// Not drawn at dot or compact level: the metadata line the glyph sits on only
			// exists on a full card.
			lods: ["full"],
		});
	}

	// PROVENANCE is declared strongest evidence first, which is the order a scale
	// should be read in. Filtered on the mark, so a level that draws nothing needs no
	// row -- and a future level with no glyph needs no change here.
	for (const [level, { mark, title, className }] of Object.entries(PROVENANCE)) {
		if (!mark) continue;
		rows.push({
			sample: (
				<span aria-hidden className={cn("font-mono text-[0.5625rem]", className)}>
					{mark}
				</span>
			),
			label: title.charAt(0).toUpperCase() + title.slice(1),
			count: census.provenance[level as keyof TreeCensus["provenance"]],
		});
	}

	rows.push(
		{
			sample: (
				<ShieldQuestion aria-hidden className="size-3 shrink-0 text-accent" strokeWidth={1.5} />
			),
			label: "Families disagree",
			hint: "Two records give different dates. The border goes dashed as well, so it is never colour alone.",
			count: census.conflicted,
		},
		{
			// The resting offset of the fusion reveal, at the offset the card uses.
			sample: (
				<span aria-hidden className="relative block size-3 shrink-0">
					<Card className="absolute inset-0 bg-transparent" style={{ translate: "3px -3px" }} />
					<Card className="absolute inset-0" />
				</span>
			),
			label: "Recorded by several families",
			hint: "One sheet per extra family. Nobody's records were overwritten to get there.",
			count: census.merged,
		},
		ringRow(census, false),
		{
			sample: (
				<span aria-hidden className="flex gap-1 text-ink-faint">
					<Phone className="size-3" strokeWidth={1.5} />
					<AtSign className="size-3" strokeWidth={1.5} />
				</span>
			),
			label: "Contact on file",
			hint: "Which channels exist, never the numbers: a canvas gets screenshotted.",
			count: Math.max(census.withPhone, census.withHandle),
			lods: ["full"],
		},
		{
			sample: (
				<span aria-hidden className="font-mono text-[0.5rem] uppercase tracking-wider text-accent">
					you
				</span>
			),
			label: "You",
			count: hasSelf ? 1 : 0,
			lods: ["full"],
		},
	);

	return rows;
}

function Section({
	title,
	rows,
	lod,
	note,
}: {
	title: string;
	rows: Row[];
	lod: Lod;
	/**
	 * One line about WHEN these marks are on screen, for a section whose rows describe
	 * something the resting canvas does not draw.
	 *
	 * The relation rows need it and would otherwise be the one failure a census-driven
	 * legend is built to prevent: every count is truthful about the graph, but a reader
	 * looking for a dashed amber line on the resting canvas will not find one, because it
	 * appears only for the person they point at. A key whose marks cannot be located
	 * discredits the rest of itself.
	 */
	note?: string;
}) {
	const visible = rows.filter((row) => row.count > 0 && (!row.lods || row.lods.includes(lod)));
	if (visible.length === 0) return null;

	return (
		<section className="border-b border-hairline px-3 py-2.5 last:border-b-0">
			<h3 className="mb-2 font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-ink-faint">
				{title}
			</h3>
			{note && <p className="-mt-1 mb-2 text-[0.625rem] leading-snug text-ink-faint">{note}</p>}
			<dl className="space-y-2">
				{visible.map((row) => (
					<div key={row.label} className="flex items-start gap-2.5">
						{/* Fixed width so every sample sits on one column whatever it is drawn
						    with -- an svg, a rail, a glyph. Height matches the first line of
						    the label rather than the row, so a two-line hint does not drag
						    the sample down the block. */}
						<span className="flex h-4 w-7 shrink-0 items-center justify-center">{row.sample}</span>
						<div className="min-w-0 flex-1">
							<dt className="flex items-baseline gap-1.5 text-[0.6875rem] leading-tight text-ink">
								<span className="min-w-0 flex-1">{row.label}</span>
								{/* The count, which turns the key into a census: how much of this
								    graph is friendship rather than parentage is a question the
								    header has no room for, and it is already computed here to
								    decide whether the row exists at all. */}
								<span className="tabular shrink-0 font-mono text-[0.625rem] text-ink-faint">
									{row.count}
								</span>
							</dt>
							{row.hint && (
								<dd className="mt-0.5 text-[0.625rem] leading-snug text-ink-faint">{row.hint}</dd>
							)}
						</div>
					</div>
				))}
			</dl>
		</section>
	);
}

export function TreeLegend({
	census,
	lod,
	hasSelf,
}: {
	census: TreeCensus;
	lod: Lod;
	/** Whether anybody on this canvas is the viewer, which the "you" rows depend on. */
	hasSelf: boolean;
}) {
	const [open, setOpen] = useState(false);
	const panelId = useId();

	/**
	 * `?` opens it, Escape closes it.
	 *
	 * `?` is the convention for "what am I looking at" everywhere it exists, and this
	 * panel is the answer. Guarded on the event target the same way search guards `/`:
	 * a question mark typed into the search box is a search, not a shortcut.
	 */
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
				return;
			}
			if (event.key !== "?" || event.metaKey || event.ctrlKey) return;
			const target = event.target as HTMLElement | null;
			if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
			if (target?.isContentEditable) return;
			event.preventDefault();
			setOpen((current) => !current);
		};

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				aria-controls={panelId}
				title="What the marks mean (?)"
				className={cn(
					"flex min-h-11 items-center gap-1.5 rounded-md border px-2.5",
					"bg-surface/90 font-mono text-[0.625rem] uppercase tracking-wider backdrop-blur-sm",
					"transition-colors duration-(--duration-fast) ease-(--ease-out)",
					open
						? "border-hairline-strong text-accent"
						: "border-hairline text-ink-faint hover:border-hairline-strong hover:text-ink",
				)}
			>
				{open ? (
					<X aria-hidden className="size-3.5" strokeWidth={1.5} />
				) : (
					<KeyRound aria-hidden className="size-3.5" strokeWidth={1.5} />
				)}
				Key
			</button>

			{open && (
				<div
					id={panelId}
					/*
					 * Opaque, unlike the trigger above it. This is a block of 10px text read
					 * against whatever cards happen to sit behind it, and a translucent
					 * surface put a name straight through the middle of a sentence.
					 *
					 * Scrolls rather than growing: the full key is taller than a phone, and a
					 * panel running off the bottom of the canvas hides its own last rows with
					 * no way to reach them. `overscroll-contain` stops a flick at the end of
					 * the list turning into a pan of the tree underneath.
					 */
					className={cn(
						"absolute right-0 top-[calc(100%+0.375rem)] w-[min(17rem,calc(100vw-1.5rem))]",
						"max-h-[min(60vh,30rem)] overflow-y-auto overscroll-contain rounded-md",
						"border border-hairline-strong bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
					)}
				>
					<Section
						title="Connections"
						rows={lineRows(census)}
						lod={lod}
						// Only when this graph HAS relations to reveal. Census-driven like every
						// count here: on a pure pedigree the note would explain an interaction
						// that produces nothing.
						note={
							Object.values(census.categories).some((count) => count > 0)
								? "The amber lines below appear for one person at a time. Point at somebody, or tap them to keep them up."
								: undefined
						}
					/>
					<Section title="People" rows={personRows(census, lod, hasSelf)} lod={lod} />
				</div>
			)}
		</div>
	);
}
