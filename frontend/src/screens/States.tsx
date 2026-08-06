/**
 * Loading and message screens.
 *
 * Styled with the app's own token classes rather than new ones, so a screen the SPA
 * shows and a screen the Next app shows cannot look like different products. The
 * lattice and the chip are the repo's own convention for a full-page state.
 */

export function LoadingScreen() {
	return (
		<div className="kf-lattice grid min-h-dvh place-items-center bg-canvas p-6">
			<p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-faint">
				Loading your graph
			</p>
		</div>
	);
}

export function MessageScreen({ message }: { message: string }) {
	return (
		<div className="kf-lattice grid min-h-dvh place-items-center bg-canvas p-6">
			<div className="max-w-sm text-center">
				<p className="text-ink-muted leading-relaxed">{message}</p>
				<a
					href={import.meta.env.BASE_URL}
					// 44px, because most visitors arrive on a phone.
					className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-hairline bg-surface px-4 text-sm text-ink-muted transition-colors hover:border-hairline-strong hover:text-ink"
				>
					Back
				</a>
			</div>
		</div>
	);
}
