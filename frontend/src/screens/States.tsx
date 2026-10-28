/**
 * Loading and message screens.
 *
 * Styled with the app's own token classes rather than new ones, so a screen the SPA
 * shows and a screen the Next app shows cannot look like different products. The
 * lattice and the chip are the repo's own convention for a full-page state.
 */
import type { ReactNode } from "react";
import { Lattice } from "@/components/ui/Lattice";

// 44px, because most visitors arrive on a phone.
const secondary =
	"inline-flex min-h-11 items-center rounded-xl border border-hairline bg-surface px-4 text-sm text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink";
const primary =
	"inline-flex min-h-11 items-center rounded-xl border border-ink bg-ink px-4 text-sm font-medium text-canvas transition-colors hover:bg-ink/85";

/**
 * The full-page shell: canvas, lattice, content centred.
 *
 * The lattice is a layer of its own (see `Lattice`), never the class of this wrapper:
 * it is a mask, and on the wrapper it faded the message and its buttons with the dots.
 */
export function FullScreen({ children }: { children: ReactNode }) {
	return (
		<div className="relative isolate grid min-h-dvh place-items-center bg-canvas p-6">
			<Lattice />
			{children}
		</div>
	);
}

export function LoadingScreen() {
	return (
		<FullScreen>
			<p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-faint">
				Loading your graph
			</p>
		</FullScreen>
	);
}

/**
 * A sentence, the way back to the front door, and optionally the one action that would
 * fix it: the same request again, or a fresh copy of the app.
 */
export function MessageScreen({
	message,
	action,
}: {
	message: string;
	action?: { label: string; onClick: () => void };
}) {
	return (
		<FullScreen>
			<div className="max-w-sm text-center">
				<p className="text-ink-muted leading-relaxed">{message}</p>
				<div className="mt-6 flex flex-wrap justify-center gap-2">
					{action && (
						<button type="button" onClick={action.onClick} className={primary}>
							{action.label}
						</button>
					)}
					<a href={import.meta.env.BASE_URL} className={secondary}>
						Back
					</a>
				</div>
			</div>
		</FullScreen>
	);
}

/** What `LoadBoundary` shows for a whole page whose code failed to load or render. */
export function ReloadScreen() {
	return (
		<MessageScreen
			message="This page could not be shown. If Kinfolk was updated while it was open, reloading fetches the new version."
			action={{ label: "Reload", onClick: () => window.location.reload() }}
		/>
	);
}

/**
 * Shown instead of the app when another page has put it in a frame.
 *
 * Pages sends no `X-Frame-Options` and a meta CSP cannot carry `frame-ancestors`, so this
 * check at boot is the only thing stopping a page from laying its own controls over ours
 * and borrowing a signed-in visitor's clicks. A link out rather than a frame-busting
 * redirect: a sandboxed frame can refuse top-level navigation, and leaving the embedding
 * page should be the visitor's decision.
 */
export function FramedScreen() {
	return (
		<FullScreen>
			<div className="max-w-sm text-center">
				<p className="text-ink-muted leading-relaxed">
					Kinfolk does not open inside other pages, so that nobody can place their own controls over
					your family's records.
				</p>
				<div className="mt-6 flex justify-center">
					<a
						href={window.location.href}
						target="_blank"
						rel="noopener noreferrer"
						className={primary}
					>
						Open Kinfolk in its own tab
					</a>
				</div>
			</div>
		</FullScreen>
	);
}
