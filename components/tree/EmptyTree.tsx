/**
 * Signed in, no tree yet.
 *
 * A genealogy app's empty state is worse than most: there is nothing to show and
 * the first step (enter your grandparents) is real work. So it offers the sample
 * tree as the low-commitment option rather than dropping someone onto a blank
 * canvas with an "Add person" button and no sense of where it leads.
 *
 * The editor does not exist yet, so this states that plainly instead of linking
 * to a route that would 404.
 */
import { enterDemo } from "@/lib/tree/demo-actions";

export function EmptyTree({ name }: { name: string | null }) {
	const firstName = name?.split(" ")[0];

	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-6 py-16">
			<div className="space-y-3">
				<p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-accent">
					Kinfolk
				</p>
				<h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink">
					{firstName ? `Welcome, ${firstName}.` : "Welcome."} Your tree is empty.
				</h1>
				<p className="text-sm leading-relaxed text-ink-muted">
					Most people start with the oldest relative they can name and work forward. You do not need
					complete dates -- "about 1918" is a real answer here, and so is "unknown".
				</p>
			</div>

			<div className="space-y-3">
				<form action={enterDemo}>
					<button
						type="submit"
						className="flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4 text-sm font-medium text-canvas transition-transform duration-[--duration-fast] ease-[--ease-out] hover:-translate-y-px active:translate-y-0"
					>
						See a sample tree first
					</button>
				</form>
				<p className="text-xs leading-relaxed text-ink-faint">
					The editor is not built yet, so there is nowhere to add your own people for the moment.
					The sample tree shows what the combined view does once two families link up.
				</p>
			</div>
		</main>
	);
}
