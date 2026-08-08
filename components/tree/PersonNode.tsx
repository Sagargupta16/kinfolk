"use client";

/**
 * A person on the canvas, at three levels of detail, plus the union junction.
 *
 * Design intent: an archive card, not a dashboard tile. Flat surface, 1px hairline,
 * mono metadata, one accent reserved for "this is you". Three things are encoded that
 * the eye reads before it reads any text, so each is deliberate rather than decorative:
 * how well attested the person is (the provenance tick and the rail), how connected
 * they are (the presence ring), and how much of them is drawn at all (the LOD).
 *
 * Two rules were earned the hard way and must not be undone:
 *
 *   - The name never wraps and never carries a glyph. Measured: a sex glyph plus its
 *     gap takes the name column from 142px to 105px and pushes 9 of 117 names from
 *     fitting into truncating. Glyphs that appear on EVERY card go on the metadata
 *     row; the name line carries only conditional marks.
 *   - Contact VALUES never reach the canvas. A card shows which channels exist and
 *     nothing more, because a canvas gets screenshotted -- and an accessible name is
 *     more exposed than the visible card, so it must not become the back door either.
 */
import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
	ChevronDown,
	ChevronUp,
	CircleDashed,
	Layers,
	Mars,
	ShieldQuestion,
	Transgender,
	Venus,
} from "lucide-react";
import { type CSSProperties, memo, type PointerEvent, useCallback, useEffect, useRef } from "react";
import type { Sex, Verification } from "@/lib/db/schema";
import { type Degree, RING_MIN_RANK } from "@/lib/tree/density";
import { displayName, type FusedPerson, lifespan } from "@/lib/tree/graph";
import type { Kinship } from "@/lib/tree/kinship";
import { type Lod, NODE_METRICS } from "@/lib/tree/layout";
import { cn } from "@/lib/utils";
import { QuickAddButton } from "./QuickAdd";

export type PersonNodeData = FusedPerson & {
	/** Highlights the viewer's own card. */
	isSelf?: boolean;
	/** How connected this person is; absent until density has run. */
	degree?: Degree;
	lod?: Lod;
	/** What this person is to the viewer: "grandmother", "second cousin", "friend". */
	kinship?: Kinship;
	/** Whether this person has anything to fold, per direction. */
	folds?: { down: boolean; up: boolean };
	/** Currently folded directions, so the control can say which way it points. */
	collapsed?: { down: boolean; up: boolean };
	/** How many people the folds on THIS card are hiding. */
	hidden?: number;
	/** Fold or unfold. Absent when this canvas has no collapse affordance. */
	onFold?: (personId: string, direction: "descendants" | "ancestors") => void;
	/**
	 * Open the quick-add sheet for this person. Absent on a read-only canvas, which is what
	 * hides the `+` entirely -- a disabled control advertises an action that cannot work.
	 *
	 * Handed the whole FusedPerson rather than an id and a name, because the canvas has to
	 * resolve WHICH source row the write targets: the fused id is the smallest member id, and
	 * on a person recorded by two families it belongs to the other family about half the time.
	 */
	onQuickAdd?: (person: FusedPerson) => void;
};

/**
 * How many stacked sheets a merged card may show.
 *
 * Two, because the sheets are 3px apart and a third is indistinguishable from the
 * second at any zoom this canvas reaches. The exact number of contributors is on the
 * metadata row as a count, which is the honest place for a number.
 */
const MAX_STACK = 2;

/** Deepest first, so the furthest sheet is painted before the ones over it. */
function stackDepths(sharedBy: number): number[] {
	const sheets = Math.min(sharedBy - 1, MAX_STACK);
	return Array.from({ length: Math.max(sheets, 0) }, (_, index) => sheets - index);
}

/**
 * Provenance marks, exported because TreeLegend explains them and must not restate
 * them. A missing entry is deliberate: `unverified` gets no mark, since the default
 * state needs no glyph, and `disputed` has its own dashed border.
 */
export const PROVENANCE: Partial<
	Record<Verification, { mark: string; title: string; tone: string }>
> = {
	documented: { mark: "✓✓", title: "Backed by a record", tone: "text-living" },
	self_confirmed: { mark: "✓", title: "Confirmed by this person", tone: "text-living" },
	family_recalled: { mark: "○", title: "Recalled by a relative", tone: "text-ink-faint" },
};

/** Sex glyphs, also read by the legend. `unknown` is a stored value, so it has a mark. */
export const SEX_MARKS: Record<Sex, { Icon: typeof Venus; title: string }> = {
	female: { Icon: Venus, title: "Female" },
	male: { Icon: Mars, title: "Male" },
	other: { Icon: Transgender, title: "Other" },
	unknown: { Icon: CircleDashed, title: "Not recorded" },
};

/**
 * Ring spread from connectedness rank.
 *
 * Capped at 6px, and the ring colour sits at 28% rather than the 80% it started at. A
 * screenshot is what caught it: 96 of 117 people clear the ring floor, so four cards in
 * five wore a grey halo and the canvas read as fog with cards in it. Per-element
 * measurement said every value was fine, because nothing per-element can see that 96
 * rings share a canvas.
 */
function ringSpread(rank: number): number {
	if (rank <= RING_MIN_RANK) return 0;
	return Math.round(2 + rank * 4);
}

/**
 * The pointer-tracked wash, written as custom properties on the element.
 *
 * Never React state. A state write re-renders the node, and React Flow answers a render
 * by re-measuring -- across 117 cards on every pointermove that is ruinous.
 * `clientX/clientY` are read EAGERLY, before the rAF: the event object is pooled, so
 * reading it inside the callback can yield a stale or nulled value.
 */
function usePointerWash() {
	const ref = useRef<HTMLDivElement>(null);
	const frame = useRef(0);

	// A frame scheduled just before unmount would otherwise fire against a detached
	// node -- harmless today, but it is exactly the shape of callback that grows a
	// state write later and becomes an update-after-unmount.
	useEffect(() => () => cancelAnimationFrame(frame.current), []);

	const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const node = ref.current;
		if (!node) return;
		const { clientX, clientY } = event;

		cancelAnimationFrame(frame.current);
		frame.current = requestAnimationFrame(() => {
			const box = node.getBoundingClientRect();
			node.style.setProperty("--kf-mx", `${clientX - box.left}px`);
			node.style.setProperty("--kf-my", `${clientY - box.top}px`);
		});
	}, []);

	return { ref, onPointerMove };
}

function PersonNodeInner({ data, selected }: NodeProps & { data: PersonNodeData }) {
	const lod = data.lod ?? "full";
	const person = data.primary;
	const name = displayName(person);
	const dates = lifespan(person);
	const sharedBy = data.contributingTreeIds.length;
	const spread = ringSpread(data.degree?.rank ?? 0);
	const wash = usePointerWash();

	/*
	 * The dot level: a mark plus a FIRST NAME.
	 *
	 * It used to be the mark alone, on the argument that this level answers "what shape is
	 * this family" and 117 names would be noise. Half right: the shape was legible and the
	 * graph was not, so finding anybody meant switching back to cards and losing the very
	 * overview you came here for. A first name is the smallest thing that makes a dot
	 * identifiable, and it is what fits -- measured across all 117 people at 9px mono, a first
	 * name needs 45px at p90 where a full name needs 84px and would make this level nearly as
	 * wide as the compact row.
	 */
	if (lod === "dot") {
		// First word only. `displayName` falls back to a nickname or "Unknown", so this is never
		// empty -- and splitting a fallback still yields something to print.
		const firstName = name.split(/\s+/)[0] ?? name;

		return (
			<div
				className="flex flex-col items-center justify-start gap-1"
				style={{ width: NODE_METRICS.dot.width, height: NODE_METRICS.dot.height }}
			>
				<Handle type="target" position={Position.Top} isConnectable={false} />
				<div
					className={cn(
						"kf-dot size-2.5 shrink-0 rounded-full border transition-transform",
						"duration-(--duration-fast) ease-(--ease-spring) hover:scale-175",
						data.isSelf
							? "border-accent bg-accent ring-1 ring-accent ring-offset-2 ring-offset-canvas"
							: person.living === "deceased"
								? // Hollow, which is the distinction that survives at 3px: filled or not,
									// rather than one hue against another.
									"border-past bg-canvas"
								: person.living === "unknown"
									? "border-ink-faint bg-canvas"
									: // Living is 93 of 117 dots, so it takes the NEUTRAL ink and the accent
										// stays the only colour on the canvas. Filled green here made dots mode
										// -- the view whose entire job is showing the shape of the family --
										// into a green mass with one amber pixel in it, so the single landmark
										// competed with the majority state. Same defect as the card rail and
										// the minimap, and only a screenshot could show it.
										"border-edge bg-edge",
						selected && "ring-2 ring-accent ring-offset-2 ring-offset-canvas",
					)}
				/>
				{/*
				 * Truncated rather than wrapped: a second line would double this level's height
				 * for a surname it is deliberately not showing. The full name is on the card
				 * level, the panel, and this node's own accessible label.
				 */}
				<span
					className={cn(
						"max-w-full truncate font-mono text-[0.5625rem] leading-none",
						data.isSelf ? "text-accent-ink" : "text-ink-muted",
					)}
				>
					{firstName}
				</span>
				<Handle type="source" position={Position.Bottom} isConnectable={false} />
			</div>
		);
	}

	const provenance = PROVENANCE[data.trust.level];
	const sex = SEX_MARKS[person.sex];
	const compact = lod === "compact";

	return (
		/*
		 * Card width AND height both come from NODE_METRICS, because ELK reserves both.
		 *
		 * Setting only the width let the card size itself to content, so raising the
		 * reserved height to fit a two-line kinship term bought nothing on screen and left
		 * the layout and the card disagreeing by 16px (reserved 92, rendered 78, measured
		 * live). The inner card needs `size-full` for the same reason.
		 *
		 * `group/node` is what the fold controls hang their hover off, and it has to be the
		 * WRAPPER rather than the card: the controls sit outside the card's box.
		 */
		<div
			className="group/node relative"
			style={{ width: NODE_METRICS[lod].width, height: NODE_METRICS[lod].height }}
		>
			{spread > 0 && (
				<div className="kf-presence" style={{ "--kf-spread": `${spread}px` } as CSSProperties} />
			)}

			{/* Stacked sheets: this person is described by more than one family. */}
			{stackDepths(sharedBy).map((depth) => (
				<div
					key={depth}
					className="kf-stack kf-stack--fuse"
					style={
						{
							transform: `translate(${depth * 3}px, ${depth * -3}px) rotate(${depth * 0.6}deg)`,
							"--kf-stack": depth,
						} as CSSProperties
					}
				/>
			))}

			<div
				ref={wash.ref}
				onPointerMove={wash.onPointerMove}
				className={cn(
					"kf-card flex size-full flex-col overflow-hidden rounded-(--radius-node)",
					"border bg-surface hover:-translate-y-0.5 hover:border-hairline-strong",
					"hover:shadow-(--kf-shadow-card)",
					selected ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-hairline",
					data.trust.conflicted && "kf-conflicted",
				)}
			>
				<Handle type="target" position={Position.Top} isConnectable={false} />

				{/*
				 * Living status as a 2px rail, and `living` gets NO colour.
				 *
				 * Found by screenshotting the whole canvas: 94 of 117 people are living, so a
				 * green rail put a saturated 7.36:1 stripe on 80% of the cards -- brighter than
				 * the NAME above it (the rail's luminance is 0.366 against the card's 0.0065),
				 * and at fit zoom the tree read as rows of green dashes rather than as a family.
				 * That is the same defect as the presence-ring fog, reached from the other side:
				 * a mark carried by four cards in five separates nobody, and this one was also
				 * spending a second colour against the one-accent rule.
				 *
				 * So the rail now marks only what is UNCOMMON. Deceased is the minority (23) and
				 * keeps its quiet grey; `unknown` keeps the hairline, since an unrecorded status
				 * is a real stored value and worth showing. Living is the default state, so it
				 * gets the default treatment: nothing. Per-element measurement cleared the green
				 * at every step -- only the picture showed that 94 of them shared a canvas.
				 */}
				<div
					className={cn(
						"h-0.5 w-full shrink-0",
						person.living === "deceased"
							? "bg-past"
							: person.living === "unknown"
								? "bg-hairline-strong"
								: "bg-transparent",
					)}
				/>

				<div className="flex min-h-0 flex-1 flex-col justify-center gap-0.5 px-2.5 py-1">
					{/* The name line. Truncates, never wraps, and carries only CONDITIONAL marks. */}
					<div className="flex items-center gap-1">
						<span
							className={cn(
								"min-w-0 flex-1 truncate text-[0.9375rem] font-medium leading-tight",
								data.isSelf ? "text-accent-ink" : "text-ink",
							)}
						>
							{name}
						</span>
						{provenance && (
							// `role="img"` is what lets this carry an accessible name: the mark is a
							// GLYPH standing for a sentence ("✓✓" means "backed by a record"), and a
							// bare span is a generic container that ARIA gives no name to -- so a
							// screen reader would read the tick literally, or skip it. Biome's
							// useAriaPropsSupportedByRole is right to insist.
							<span
								role="img"
								title={provenance.title}
								aria-label={provenance.title}
								className={cn("shrink-0 font-mono text-[0.5625rem] leading-none", provenance.tone)}
							>
								{provenance.mark}
							</span>
						)}
						{data.trust.conflicted && (
							<ShieldQuestion
								className="size-3 shrink-0 text-accent-dim"
								strokeWidth={1.75}
								aria-label="Families disagree on the dates"
							/>
						)}
					</div>

					{compact ? (
						/* One line, and the kinship term outranks the dates: it is the fact that
						   cannot be recovered by looking at the picture. */
						<span className="truncate font-mono text-[0.625rem] leading-tight text-ink-faint">
							{data.kinship?.label ?? dates}
						</span>
					) : (
						<>
							{data.kinship && (
								<span
									className={cn(
										"kf-relation font-mono text-[0.625rem] leading-tight",
										// An INFERRED kinship is drawn a step fainter than a proven one:
										// `in_law` and `relation` are read off a partner's line or a stored
										// relation rather than proven by the ancestor walk, the same
										// how-firmly-drawn-tracks-how-well-known hierarchy as the tick.
										data.kinship.via === "in_law" || data.kinship.via === "relation"
											? "text-ink-faint"
											: "text-ink-muted",
									)}
								>
									{data.kinship.label}
								</span>
							)}

							<div className="flex items-center gap-1.5 text-ink-faint">
								{/* On the metadata row, never the name line: this glyph is on EVERY card. */}
								<sex.Icon className="size-2.5 shrink-0" strokeWidth={2} aria-label={sex.title} />
								{dates && (
									<span className="tabular truncate text-[0.625rem] leading-none">{dates}</span>
								)}
								{sharedBy > 1 && (
									<span
										className="ml-auto flex shrink-0 items-center gap-0.5 text-[0.625rem] leading-none"
										title={`Described by ${sharedBy} families`}
									>
										<Layers className="size-2.5" strokeWidth={2} aria-hidden="true" />
										<span className="tabular">{sharedBy}</span>
									</span>
								)}
							</div>
						</>
					)}
				</div>

				<Handle type="source" position={Position.Bottom} isConnectable={false} />
			</div>

			{/*
			 * The `+`, on the card's TRAILING edge.
			 *
			 * The fold chevrons already own the top and bottom centre with 44px targets, so the
			 * right-hand edge is the one side of a card carrying no control. Always visible for
			 * the SELECTED card, which is how a touch or keyboard user reaches it at all; on
			 * hover otherwise, like the chevrons.
			 */}
			{data.onQuickAdd && (
				<QuickAddButton
					visible={Boolean(selected)}
					// The whole FusedPerson, not `data.id`. The subject of a quick-add has to be a
					// source row the viewer may write to, and the fused id is the smallest member id
					// -- which on a merged person is the far family's row about half the time, so
					// `addRelative` would refuse with "you may not change this graph" about somebody's
					// own grandmother. The canvas resolves it through `editTarget`.
					onOpen={() => data.onQuickAdd?.(data)}
					className="absolute -right-2.5 top-1/2 z-10 size-6 -translate-y-1/2"
				/>
			)}

			{/*
			 * Fold controls, OUTSIDE the card and only where there is something to fold.
			 *
			 * Outside because the card is already at its measured content height, so a control
			 * inside would either steal a line from the kinship term or overflow the box ELK
			 * reserved. Absolutely positioned against the wrapper instead, which costs no
			 * layout at all.
			 *
			 * A direction with nothing in it draws no button: a control that cannot do
			 * anything reads as a broken feature rather than an inapplicable one.
			 */}
			{data.onFold && data.folds?.up && (
				<FoldButton
					direction="ancestors"
					folded={Boolean(data.collapsed?.up)}
					personId={data.id}
					name={name}
					hidden={data.hidden}
					cardWidth={NODE_METRICS[lod].width}
					cardHeight={NODE_METRICS[lod].height}
					onFold={data.onFold}
				/>
			)}
			{data.onFold && data.folds?.down && (
				<FoldButton
					direction="descendants"
					folded={Boolean(data.collapsed?.down)}
					personId={data.id}
					name={name}
					hidden={data.hidden}
					cardWidth={NODE_METRICS[lod].width}
					cardHeight={NODE_METRICS[lod].height}
					onFold={data.onFold}
				/>
			)}
		</div>
	);
}

/**
 * One fold control.
 *
 * The count is the whole affordance: "12" beside a chevron says there is something to
 * open and roughly how much, where a bare chevron says only that a control exists.
 */
function FoldButton({
	direction,
	folded,
	personId,
	name,
	hidden,
	cardWidth,
	cardHeight,
	onFold,
}: {
	direction: "descendants" | "ancestors";
	folded: boolean;
	personId: string;
	name: string;
	hidden?: number;
	/** The card's own box, so the hit area can never grow larger than what it belongs to. */
	cardWidth: number;
	cardHeight: number;
	onFold: (personId: string, direction: "descendants" | "ancestors") => void;
}) {
	const up = direction === "ancestors";
	// Points the way it will TRAVEL: a folded branch offers to open outward, an open one
	// offers to close back toward the card.
	const Icon = folded ? (up ? ChevronUp : ChevronDown) : up ? ChevronDown : ChevronUp;
	const label = `${folded ? "Show" : "Hide"} ${name}'s ${up ? "ancestors" : "descendants"}`;

	return (
		<button
			type="button"
			onClick={(event) => {
				// The canvas would otherwise treat this as a card click and pin the person.
				event.stopPropagation();
				onFold(personId, direction);
			}}
			// React Flow starts a drag on pointerdown; without this, pressing the button
			// drags the card instead of firing the click. `nodrag` covers the same ground for
			// their own handler, and both are cheap.
			onPointerDown={(event) => event.stopPropagation()}
			title={label}
			aria-label={label}
			aria-expanded={!folded}
			className={cn(
				/*
				 * The TARGET is 44px; the visible pill is not.
				 *
				 * Measured at 375px: the pill alone was 20x14, so on a phone the primary collapse
				 * gesture was a third of the 44px floor -- and it sits between two cards, where a
				 * miss taps a person and pins them instead. But growing the pill to 44px would put
				 * a control the size of a third of a card into the gap between generations, and
				 * those gaps are where the sibling bars read.
				 *
				 * So the button is a transparent square that centres a small pill. The border,
				 * fill and shadow move to the inner span, so the touch area is honest at every
				 * zoom while the mark stays 20px.
				 */
				"nodrag absolute left-1/2 z-10 flex -translate-x-1/2 items-center justify-center",
				"transition-opacity duration-(--duration-fast) ease-(--ease-out)",
				// Revealed on hover of the wrapper, so the control appears with the card rather
				// than having to be hunted for. Always visible once FOLDED, because a hidden
				// branch behind a hidden control is unrecoverable.
				folded ? "opacity-100" : "opacity-0 group-hover/node:opacity-100 focus-visible:opacity-100",
			)}
			/*
			 * Sized INLINE against the live zoom, not with a Tailwind arbitrary-value utility.
			 *
			 * `size-(--kf-hit)` looked right and measured 35px: a utility resolves its variable
			 * where the variable is DECLARED, so it read the `:root` definition with the
			 * `var(--kf-zoom, 1)` fallback rather than the zoom published onto the viewport.
			 * Reading `--kf-zoom` here, on an element inside that viewport, is what makes the
			 * cascade deliver the live value.
			 *
			 * CAPPED at the card's own size, and that cap is a bug fix rather than caution. A
			 * 44px screen target divided by a 0.4 zoom is 110 layout pixels, which at that zoom
			 * is wider than the whole card -- measured live, the button covered a 32x17 card
			 * completely and `elementFromPoint` at the card's centre returned the BUTTON, so
			 * clicking a person opened a fold instead of their panel. A control may overhang its
			 * card's edge; it may never eclipse it.
			 */
			style={{
				width: `min(calc(44px / var(--kf-zoom, 1)), ${cardWidth * 0.5}px)`,
				height: `min(calc(44px / var(--kf-zoom, 1)), ${cardHeight * 0.6}px)`,
				...(up
					? { top: `max(calc(-22px / var(--kf-zoom, 1)), -${cardHeight * 0.3}px)` }
					: { bottom: `max(calc(-22px / var(--kf-zoom, 1)), -${cardHeight * 0.3}px)` }),
			}}
		>
			<span
				className={cn(
					"flex items-center gap-0.5 rounded-full border border-hairline bg-surface-raised",
					"px-1.5 py-0.5 text-ink-faint shadow-(--kf-shadow-card)",
					"transition-colors duration-(--duration-fast) ease-(--ease-out)",
					"group-hover/node:border-hairline-strong",
				)}
			>
				<Icon className="size-3" strokeWidth={2.5} aria-hidden="true" />
				{folded && hidden ? (
					<span className="tabular text-[0.5625rem] leading-none">{hidden}</span>
				) : null}
			</span>
		</button>
	);
}

/**
 * Memoised, and that matters more here than anywhere else in the app.
 *
 * Focus rewrites className on every node through `setNodes`, so all 117 nodes receive a
 * new props object on each hover. Without a memo every one of them re-renders and React
 * Flow re-measures the lot.
 */
export const PersonNode = memo(PersonNodeInner);

/**
 * The union junction, sitting ON the marriage line.
 *
 * Layout places it at the couple's mid-card height (see `placeUnionJunctions`),
 * so the bead reads as a point on the line rather than a third node -- which is
 * why it takes the line's own colour. Status is drawn with the genogram's
 * conventions, because they are the ones relatives who have seen a family chart
 * already know: a divorce or separation is two slashes THROUGH the line, a
 * widowing hollows the bead, and an intact partnership is a solid point.
 *
 * Never draggable and never a tab stop -- a junction is structural, not somebody
 * you can visit.
 */
function UnionNodeInner({ data }: NodeProps & { data: { union: { status?: string } } }) {
	const status = data.union.status;
	const ended = status === "separated" || status === "divorced";
	const widowed = status === "widowed";

	return (
		<div className="group flex size-3 items-center justify-center">
			<Handle type="target" position={Position.Top} isConnectable={false} />
			{ended ? (
				// The genogram double-slash: the line is interrupted, which is the fact.
				<span
					aria-hidden
					className="relative block h-3 w-3 transition-transform duration-(--duration-fast) ease-(--ease-spring) group-hover:scale-150"
				>
					<span className="absolute left-0.5 top-1/2 h-3 w-px -translate-y-1/2 rotate-[28deg] bg-past" />
					<span className="absolute right-0.5 top-1/2 h-3 w-px -translate-y-1/2 rotate-[28deg] bg-past" />
				</span>
			) : (
				<div
					className={cn(
						"size-1.5 rounded-full transition-transform duration-(--duration-fast)",
						"ease-(--ease-spring) group-hover:scale-200",
						// Hollow for a widowed partnership: one side of the line has ended
						// without the line itself being severed.
						widowed ? "border border-edge bg-canvas" : "bg-edge",
					)}
				/>
			)}
			<Handle type="source" position={Position.Bottom} isConnectable={false} />
		</div>
	);
}

export const UnionNode = memo(UnionNodeInner);
