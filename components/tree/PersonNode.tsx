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
import { AtSign, Phone, ShieldQuestion, Users } from "lucide-react";
import type { CSSProperties } from "react";
import type { Degree } from "@/lib/tree/density";
import { displayName, type FusedPerson, lifespan } from "@/lib/tree/graph";
import type { Lod } from "@/lib/tree/layout";
import { cn } from "@/lib/utils";

export type PersonNodeData = FusedPerson & {
	/** Highlights the viewer's own card. */
	isSelf?: boolean;
	/** How connected this person is; absent until density has run. */
	degree?: Degree;
	lod?: Lod;
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
 */
const PROVENANCE: Record<
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
 * Ring radius for how connected somebody is.
 *
 * A hub gets a visibly wider halo than a leaf; the floor is 0 so a person with
 * no recorded connections gets no ring at all rather than a faint one that reads
 * as a rendering artefact. Capped low on purpose -- this is a hint that sits
 * behind the card, and a big glow would out-shout the name.
 */
function ringSpread(rank: number): number {
	if (rank <= 0.2) return 0;
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

	// The card shows only WHICH channels exist, never the values. A canvas is
	// screenshotted and shared; a phone number should take a deliberate click.
	const contacts = data.contacts ?? [];
	const hasPhone = contacts.some((c) => c.kind === "phone" || c.kind === "whatsapp");
	const hasHandle = contacts.some((c) => c.kind !== "phone" && c.kind !== "whatsapp");

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
	 */
	const ring =
		spread > 0 ? (
			<span
				aria-hidden
				className="kf-presence"
				style={{ "--kf-spread": `${spread}px` } as CSSProperties}
			/>
		) : null;

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
						"size-2.5 rounded-full border transition-transform duration-[--duration-fast]",
						"ease-[--ease-out] hover:scale-150",
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
		<div className={cn("relative", lod === "compact" ? "w-[168px]" : "w-[200px]")}>
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
					"group relative flex overflow-hidden rounded-[--radius-node] border bg-surface",
					"transition-[border-color,transform,box-shadow] duration-[--duration-fast] ease-[--ease-out]",
					"hover:-translate-y-px hover:border-hairline-strong",
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
						dates && (
							<span className="tabular font-mono text-[0.625rem] text-ink-muted">{dates}</span>
						)
					) : (
						<>
							{person.birthFamilyName && (
								<p className="truncate text-xs leading-tight text-ink-faint">
									born {person.birthFamilyName}
								</p>
							)}

							<div className="mt-1.5 flex items-center gap-1.5">
								{dates && (
									<span className="tabular font-mono text-[0.6875rem] text-ink-muted">{dates}</span>
								)}
								{data.isSelf && (
									<span className="font-mono text-[0.625rem] uppercase tracking-wider text-accent">
										you
									</span>
								)}
							</div>

							{(sharedBy > 1 || contacts.length > 0) && (
								<div className="mt-1.5 flex items-center gap-2.5 text-ink-faint">
									{sharedBy > 1 && (
										<span
											className="flex items-center gap-1"
											title={`recorded by ${sharedBy} families`}
										>
											<Users aria-hidden className="size-3" strokeWidth={1.5} />
											<span className="tabular font-mono text-[0.625rem]">{sharedBy}</span>
										</span>
									)}
									{hasPhone && (
										<Phone
											aria-label="has a phone number on file"
											className="size-3"
											strokeWidth={1.5}
										/>
									)}
									{hasHandle && (
										<AtSign
											aria-label="has an email or social handle on file"
											className="size-3"
											strokeWidth={1.5}
										/>
									)}
								</div>
							)}
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
 */
export function UnionNode({ data }: { data: { union: { status: string } } }) {
	const dissolved = ["separated", "divorced"].includes(data.union.status);

	return (
		<div className="relative flex size-3 items-center justify-center">
			<Handle type="target" position={Position.Top} />
			<Handle type="source" position={Position.Bottom} />
			<span
				aria-hidden
				className={cn("size-1.5 rounded-full", dissolved ? "bg-hairline-strong" : "bg-accent-dim")}
			/>
		</div>
	);
}
