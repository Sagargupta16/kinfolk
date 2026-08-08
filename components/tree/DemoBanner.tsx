/**
 * Says "this is not your data" without stealing the canvas.
 *
 * A strip under the header rather than a floating pill: the canvas is pannable,
 * and anything overlaying it competes with the thing the page exists to show.
 * Sits in normal flow so it can never cover a node.
 */

import { Eye } from "lucide-react";
import Link from "next/link";
import { exitDemo } from "@/lib/tree/demo-actions";

export function DemoBanner() {
	return (
		<div className="kf-demo-banner flex shrink-0 items-center gap-2 border-b border-hairline bg-surface px-4 py-1.5 sm:gap-3 sm:px-6 sm:py-2">
			<Eye aria-hidden className="size-3.5 shrink-0 text-accent" strokeWidth={1.5} />
			{/* Truncates rather than wrapping. The full sentence is worth three lines
			    on a desktop and zero on a phone, where the tree needs the room. */}
			<p className="min-w-0 flex-1 truncate text-xs leading-relaxed text-ink-muted">
				<span className="text-ink">Sample data.</span>{" "}
				<span className="hidden sm:inline">
					Two families who each recorded the same grandparents, then agreed they were the same
					people.
				</span>
				<span className="sm:hidden">Not your records.</span>
			</p>

			<div className="flex shrink-0 items-center gap-1">
				<Link
					href="/signin"
					className="flex min-h-11 items-center rounded-md px-2.5 text-xs font-medium text-accent transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-surface-raised sm:px-3"
				>
					<span className="sm:hidden">Sign in</span>
					<span className="hidden sm:inline">Sign in to build yours</span>
				</Link>
				<form action={exitDemo}>
					<button
						type="submit"
						className="flex min-h-11 items-center rounded-md px-3 text-xs text-ink-faint transition-colors duration-(--duration-fast) ease-(--ease-out) hover:bg-surface-raised hover:text-ink-muted"
					>
						Exit
					</button>
				</form>
			</div>
		</div>
	);
}
