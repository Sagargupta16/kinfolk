/**
 * Where GitHub returns the visitor.
 *
 * This page existing on the visitor's OWN origin is the entire point of the flow:
 * `redirect_uri` names it, so the address bar never shows the API host. It reads the
 * code from its own URL, posts it for exchange, and moves on.
 *
 * It renders text rather than nothing, because a blank page during a network round
 * trip is indistinguishable from a broken redirect -- and this is the one moment a
 * visitor is most likely to think sign-in failed.
 */
import { useEffect, useState } from "react";
import type { CompletedSignIn } from "../auth";
import { MessageScreen } from "./States";

export function CallbackScreen({ complete }: { complete: () => Promise<CompletedSignIn> }) {
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			try {
				await complete();
				if (cancelled) return;
				// `replace`, not `assign`: the callback URL holds a spent code, and leaving
				// it in history means the back button lands on a request that cannot succeed
				// a second time.
				window.location.replace(`${import.meta.env.BASE_URL}tree`);
			} catch (caught) {
				if (cancelled) return;
				// The thrown message is written for a person to read -- "Sign-in was
				// cancelled", not an OAuth error code.
				setError(caught instanceof Error ? caught.message : "Could not complete sign-in.");
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [complete]);

	if (error) return <MessageScreen message={error} />;

	return (
		<div className="kf-lattice grid min-h-dvh place-items-center bg-canvas p-6">
			<p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-faint">
				Finishing sign in
			</p>
		</div>
	);
}
