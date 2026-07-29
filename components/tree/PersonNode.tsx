"use client";

/**
 * A person on the canvas, at one of three levels of detail.
 *
 * Design intent: this is an archive card, not a dashboard tile. Flat surface,
 * 1px hairline, mono metadata, one accent reserved for "this is you". The left
 * edge carries a 2px living/deceased rail because that is the single fact you
 * scan a tree for, and a rail reads faster than a badge.
 *
 * Three things are encoded here that the eye reads before it reads any text, so
 * each is deliberate rather than decorative:
 *
 *   - how well attested the person is (the provenance tick and the rail)
 *   - how connected they are (the presence ring, from lib/tree/density)
 *   - how much of them is drawn at all (the level of detail)
 *
 * Provenance is a tick, not a word: "verified" printed on most cards would be a
 * word repeated across most of the canvas, costing the width a name needs and
 * separating nobody. Glyph plus tooltip, and never colour alone.
 */
import { Handle, Position } from "@xyflow/react";
import { CircleDashed, Mars, ShieldQuestion, Transgender, Users, Venus } from "lucide-react";
import type { CSSProperties } from "react";
import type { Person } from "@/lib/db/schema";
import { type Degree, RING_MIN_RANK } from "@/lib/tree/density";
import { displayName, type FusedPerson, lifespan } from "@/lib/tree/graph";
import type { Kinship } from "@/lib/tree/kinship";
import { type Lod, NODE_METRICS } from "@/lib/tree/layout";
import { cn } from "@/lib/utils";

export type PersonNodeData = FusedPerson & {
	/** Highlights the viewer's own card. */
	isSelf?: boolean;
	/** How connected this person is; absent until density has run. */
	degree?: Degree;
	lod?: Lod;
	/**
	 * What this person is to the viewer: "grandmother", "second cousin", "friend".
	 *
	 * The card's second line, and it replaced a birth surname plus two channel
	 * icons. Those were on most cards and separated nobody -- Cambridge
	 * Intelligence: "avoid repeating words if they appear across most nodes". A
	 * kinship term is different on nearly every card and is the one fact a viewer
	 * cannot recover by looking, since counting six edges up and four back down is
	 * precisely what the eye will not do.
	 */
	kinship?: Kinship;
};

/**
 * Offset hairlines behind a merged card, one per extra record.
 *
 * Capped at two: past that the offset reaches into the neighbouring card, and
 * "several families" is the whole message anyway. Ordered deepest first so the
 * nearer sheet paints over the further one, the way a real stack sits.
 */
const MAX_STACK = 2;

function stackDepths(sharedBy: number): number[] {
	const sheets = Math.min(Math.max(sharedBy - 1, 0), MAX_STACK);
	return Array.from({ length: sheets }, (_, i) => sheets - i);
}

/**
 * What each verification level says, and how firmly it is drawn.
 *
 * Weight ascends with confidence so the marks read as a scale at a glance. The
 * label is what a reader gets on hover, and it is phrased as the EVIDENCE rather
 * than a status, because "documented" tells you what you could go and check
 * whereas "verified" only tells you somebody was satisfied.
 *
 * Exported for the legend, which lists these marks. Declaration order is strongest
 * evidence first, and the legend reads it in that order -- a scale explained from the
 * weak end reads as a list of unrelated glyphs. The two blank marks are skipped
 * there, so adding a level with no glyph needs no change to the legend.
 */
export const PROVENANCE: Record<
	FusedPerson["trust"]["level"],
	{ mark: string; title: string; className: string }
> = {
	documented: { mark: "✓✓", title: "documented in a record", className: "text-living" },
	self_confirmed: { mark: "✓", title: "confirmed by this person", className: "text-living" },
	family_recalled: { mark: "○", title: "recalled by a relative", className: "text-ink-faint" },
	unverified: { mark: "", title: "", className: "" },
	disputed: { mark: "", title: "", className: "" },
};

/**
 * The glyph for a person's recorded sex, and what makes it safe: it renders the STORED
 * value and nothing else.
 *
 * `unknown` is the schema default and by far the most common value in a real genealogy,
 * so it gets a mark of its own -- a dashed circle, which reads as "an outline nobody has
 * filled in" -- rather than falling back to a male default the way most family-tree
 * software does. That default is exactly the corruption `sexEnum` exists to avoid, and it
 * is the reason the gender-required layout libraries were rejected.
 *
 * Nothing here consults the name. Inferring sex from "Alexandra" would write a guess into
 * the one channel a reader trusts to be recorded fact, and unlike a kinship term (which is
 * recomputed every render) a glyph looks equally confident whether or not anybody said so.
 *
 * Exported for the legend, which lists these marks and must not restate them.
 */
export const SEX_MARKS: Record<Person["sex"], { Icon: typeof Venus; title: string }> = {
	female: { Icon: Venus, title: "recorded female" },
	male: { Icon: Mars, title: "recorded male" },
	other: { Icon: Transgender, title: "recorded as other" },
	unknown: { Icon: CircleDashed, title: "sex not recorded" },
};

/**
 * Ring radius for how connected somebody is.
 *
 * A hub gets a visibly wider halo than a leaf; the floor is 0 so a person with
 * no recorded connections gets no ring at all rather than a faint one that reads
 * as a rendering artefact. Capped low on purpose -- this is a hint that sits
 * behind the card, and a big glow would out-shout the name.
 *
 * 0 means an invisible ring, not an absent one: the focus glow in globals.css blooms
 * out of this same box (`.kf-lit .kf-presence`), so dropping the element for the
 * quietest people would leave exactly them unable to answer a hover.
 */
function ringSpread(rank: number): number {
	if (rank <= RING_MIN_RANK) return 0;
	return Math.round(2 + rank * 8);
}

export function PersonNode({ data, selected }: { data: PersonNodeData; selected?: boolean }) {
	const person = data.primary;
	const lod = data.lod ?? "full";
	const name = displayName(person);
	const dates = lifespan(person);
	// The stored value, not a guess from the death date: "unknown" is a real
	// answer in genealogy and rendering it as alive would assert something nobody
	// recorded. Only an explicit "deceased" gets the past rail.
	const isDeceased = person.living === "deceased";
	const isUnknown = person.living === "unknown";
	const sharedBy = data.contributingTreeIds.length;
	const trust = data.trust;
	const provenance = PROVENANCE[trust.level];
	const spread = ringSpread(data.degree?.rank ?? 0);
	const sexMark = SEX_MARKS[person.sex];

	/**
	 * The second line: who this person is to the viewer.
	 *
	 * Nothing when there is no viewer -- a signed-out visitor and mine-only demo mode
	 * both get a bare name, which is honest, where "relative" would not be. The
	 * channel icons this replaced are gone entirely rather than moved: what a card
	 * owes is identity, and whether a phone number exists is a question for the person
	 * you already found.
	 */
	const relation = data.kinship?.label;

	const rail = (
		<span
			aria-hidden
			className={cn(
				"w-0.5 shrink-0",
				isDeceased ? "bg-past" : isUnknown ? "bg-hairline-strong" : "bg-living",
			)}
		/>
	);

	/**
	 * The presence ring: connectedness, drawn behind everything.
	 *
	 * A ring rather than a size change, because ELK has already allocated this
	 * node's box -- growing the busiest cards would either overlap their
	 * neighbours or force the whole layout to reserve the maximum.
	 *
	 * Always rendered, even at spread 0 where it draws nothing. It is also the surface
	 * the focus glow blooms from, and a zero-radius box-shadow on a positioned span
	 * costs a paint of nothing -- where dropping the element would mean the least
	 * connected people are the ones a hover cannot answer.
	 */
	const ring = (
		<span
			aria-hidden
			className="kf-presence"
			style={{ "--kf-spread": `${spread}px` } as CSSProperties}
		/>
	);

	if (lod === "dot") {
		return (
			<div
				className="relative flex size-4 items-center justify-center"
				title={`${name}${dates ? `, ${dates}` : ""}`}
			>
				<Handle type="target" position={Position.Top} />
				<Handle type="source" position={Position.Bottom} />
				{ring}
				{/* At this size the whole node IS the status: nothing else fits, so the
				    living rail becomes the fill, and deceased is a HOLLOW dot rather
				    than a differently coloured one -- at a 0.2 scale overview the fill
				    is the only channel still readable.

				    "You" gets a ring, not just the accent. A union dot is also drawn in
				    accent, and at this zoom a 10px accent fill and a 6px accent-dim one
				    are the same two amber pixels -- so the viewer could not find
				    themselves in the one view whose entire purpose is orientation. The
				    ring makes it the widest mark on the canvas, which is a difference in
				    SIZE and survives being scaled down. */}
				<span
					className={cn(
						// Springs to 1.75x. At the overview zoom a dot is ~3 screen pixels, so
						// the growth is the only channel a hover has -- there is no border
						// colour to shift and no text to brighten. The overshoot buys a mark
						// that small the extra frame of visibility it needs to register.
						"size-2.5 rounded-full border transition-transform duration-(--duration-base)",
						"ease-(--ease-spring) hover:scale-175",
						data.isSelf
							? "border-accent bg-accent ring-1 ring-accent ring-offset-2 ring-offset-canvas"
							: isDeceased
								? "border-past bg-canvas"
								: isUnknown
									? "border-hairline-strong bg-canvas"
									: "border-living bg-living/40",
						selected && !data.isSelf && "ring-1 ring-accent",
					)}
				/>
			</div>
		);
	}

	return (
		// A wrapper, because the card itself clips to its rounded corners and the
		// stacked sheets have to escape it.
		//
		// Width read from NODE_METRICS rather than written as a utility class. ELK has
		// already reserved a box of exactly this size, so a card that disagrees either
		// overlaps its neighbour or leaves a gap ELK is holding open for nothing -- and
		// two numbers that must match are one number.
		<div className="relative" style={{ width: NODE_METRICS[lod].width }}>
			{ring}

			{/* The fusion reveal: sheets slide in from further out and settle onto the
			    stack, so the combined view SHOWS two records becoming one instead of
			    only claiming it in the footer. The resting offset stays, so it still
			    reads as merged long after the animation is over. */}
			{stackDepths(sharedBy).map((depth) => (
				<span
					key={depth}
					aria-hidden
					className="kf-stack kf-stack--fuse"
					style={{ "--kf-stack": depth } as CSSProperties}
				/>
			))}

			<div
				className={cn(
					"group relative flex overflow-hidden rounded-(--radius-node) border bg-surface",
					// Spring, and a 2px lift rather than 1. The card is the thing under the
					// pointer, so the overshoot reads as it responding; at 1px with a plain
					// ease-out the lift was below the threshold where a hover feels answered at
					// all, which is the whole job of the gesture. Transform on the INNER card
					// only -- React Flow owns the wrapper's transform for positioning.
					"transition-[border-color,transform,box-shadow] duration-(--duration-base)",
					"ease-(--ease-spring) hover:-translate-y-0.5 hover:border-hairline-strong",
					selected ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : "border-hairline",
					// Families disagreeing is the one state worth interrupting the
					// monochrome for, and it is drawn as a dashed border rather than a
					// colour so it survives being read without colour vision.
					trust.conflicted && "kf-conflicted",
				)}
			>
				{/* Layout needs handles, but they are visually suppressed in globals.css. */}
				<Handle type="target" position={Position.Top} />
				<Handle type="source" position={Position.Bottom} />

				{rail}

				<div className={cn("min-w-0 flex-1", lod === "compact" ? "px-2.5 py-1.5" : "px-3 py-2.5")}>
					<div className="flex items-baseline gap-1.5">
						<p className="truncate text-[0.9375rem] font-medium leading-tight tracking-[-0.01em] text-ink">
							{name}
						</p>
						{provenance.mark && (
							<span
								title={provenance.title}
								className={cn(
									"shrink-0 font-mono text-[0.5625rem] leading-none",
									provenance.className,
								)}
							>
								{provenance.mark}
							</span>
						)}
						{trust.conflicted && (
							<ShieldQuestion
								aria-label="families disagree about this person"
								className="size-3 shrink-0 text-accent"
								strokeWidth={1.5}
							/>
						)}
					</div>

					{lod === "compact" ? (
						// One line of metadata, and the relationship outranks the dates: at this
						// size a viewer is scanning for WHO, and a birth year does not answer it.
						(relation || dates) && (
							<span className="truncate text-[0.6875rem] leading-tight text-ink-muted">
								{relation ?? <span className="tabular font-mono">{dates}</span>}
							</span>
						)
					) : (
						<>
							{relation && (
								<p
									className={cn(
										"truncate text-xs leading-tight",
										// An in-law rung is inferred from a partner's line rather than
										// read off the graph, so it is drawn a step fainter than a term
										// the ancestor walk proved. Same hierarchy the provenance tick
										// uses: how firmly a thing is drawn tracks how well it is known.
										data.kinship?.via === "in_law" || data.kinship?.via === "relation"
											? "text-ink-faint"
											: "text-ink-muted",
									)}
								>
									{relation}
								</p>
							)}

							<div className="mt-1.5 flex items-center gap-1.5 text-ink-faint">
								{/*
								 * Leads the metadata line rather than sitting beside the name.
								 *
								 * The name line already carries the provenance tick and the conflict
								 * glyph, and a third mark there would make the row a badge shelf --
								 * the name is what a viewer scans for and every glyph beside it is
								 * width taken from it. Down here it sits with the other recorded
								 * facts, which is what it is.
								 */}
								<sexMark.Icon
									aria-label={sexMark.title}
									className="size-3 shrink-0"
									strokeWidth={1.5}
								/>
								{dates && <span className="tabular font-mono text-[0.6875rem]">{dates}</span>}
								{sharedBy > 1 && (
									<span
										className="flex items-center gap-1"
										title={`recorded by ${sharedBy} families`}
									>
										<Users aria-hidden className="size-3" strokeWidth={1.5} />
										<span className="tabular font-mono text-[0.625rem]">{sharedBy}</span>
									</span>
								)}
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * The junction between partners. Deliberately tiny: a couple should read as two
 * cards joined by a point, not as three boxes in a row.
 *
 * It answers a hover, unlike before. This dot is the node the sibling bar drops from and
 * every child edge originates at, so on a dense canvas "which junction does this family
 * hang off" is a real question -- and a 6px mark that does not respond reads as decoration
 * rather than as part of the graph. Scale only, because there is no room for anything
 * else at this size and growth is the one channel that survives being zoomed out.
 */
export function UnionNode({ data }: { data: { union: { status: string } } }) {
	const dissolved = ["separated", "divorced"].includes(data.union.status);

	return (
		<div className="group relative flex size-3 items-center justify-center">
			<Handle type="target" position={Position.Top} />
			<Handle type="source" position={Position.Bottom} />
			<span
				aria-hidden
				className={cn(
					"size-1.5 rounded-full",
					// Spring, matching the card's lift and the dot LOD's growth: all three are
					// responses to a gesture the viewer just made, and a different curve on each
					// would read as three different products.
					"transition-transform duration-(--duration-base) ease-(--ease-spring)",
					"group-hover:scale-200",
					dissolved ? "bg-hairline-strong" : "bg-accent-dim",
				)}
			/>
		</div>
	);
}
