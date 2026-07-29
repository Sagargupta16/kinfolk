"use client";

/**
 * A person card on the canvas.
 *
 * Design intent: this is an archive card, not a dashboard tile. Flat surface,
 * 1px hairline, mono metadata, one accent reserved for "this is you". The left
 * edge carries a 2px living/deceased rail because that is the single fact you
 * scan a tree for, and a rail reads faster than a badge.
 *
 * A card also has to say how much it is trusted: when two families describe the
 * same person, the footer says so rather than silently picking a winner.
 */
import { Handle, Position } from "@xyflow/react";
import { AtSign, Phone, Users } from "lucide-react";
import type { CSSProperties } from "react";
import { displayName, type FusedPerson, lifespan } from "@/lib/tree/graph";
import { cn } from "@/lib/utils";

export type PersonNodeData = FusedPerson & {
	/** Highlights the viewer's own card. */
	isSelf?: boolean;
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

export function PersonNode({ data, selected }: { data: PersonNodeData; selected?: boolean }) {
	const person = data.primary;
	const name = displayName(person);
	const dates = lifespan(person);
	const isDeceased = Boolean(person.deathDate ?? person.deathDateApprox);
	const sharedBy = data.contributingTreeIds.length;

	// The card shows only WHICH channels exist, never the values. A canvas is
	// screenshotted and shared; a phone number should take a deliberate click.
	const contacts = data.contacts ?? [];
	const hasPhone = contacts.some((c) => c.kind === "phone" || c.kind === "whatsapp");
	const hasHandle = contacts.some((c) => c.kind !== "phone" && c.kind !== "whatsapp");

	return (
		// A wrapper, because the card itself clips to its rounded corners and the
		// stacked sheets have to escape it.
		<div className="relative w-[200px]">
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
				)}
			>
				{/* Layout needs handles, but they are visually suppressed in globals.css. */}
				<Handle type="target" position={Position.Top} />
				<Handle type="source" position={Position.Bottom} />

				{/* Living / deceased rail. */}
				<span aria-hidden className={cn("w-0.5 shrink-0", isDeceased ? "bg-past" : "bg-living")} />

				<div className="min-w-0 flex-1 px-3 py-2.5">
					<p className="truncate text-[0.9375rem] font-medium leading-tight tracking-[-0.01em] text-ink">
						{name}
					</p>

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
								<span className="flex items-center gap-1">
									<Users aria-hidden className="size-3" strokeWidth={1.5} />
									<span className="font-mono text-[0.625rem]">{sharedBy} families</span>
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
