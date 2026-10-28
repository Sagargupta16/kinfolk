/**
 * The SPA entry point.
 *
 * `app/globals.css` is imported directly rather than copied, so the design tokens,
 * the React Flow overrides and every `.kf-*` rule are the SAME file the Next app
 * uses. A second stylesheet would drift, and this repo's whole contrast and stroke
 * discipline lives in that one place.
 *
 * StrictMode is deliberately absent. It double-invokes effects in development, and
 * `TreeCanvas` runs ELK layout in an effect -- so every data change would lay the
 * graph out twice locally and behave differently from production, which is the
 * opposite of what a development warning should do.
 */
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import "@xyflow/react/dist/style.css";
import { LoadBoundary } from "@/components/ui/LoadBoundary";
import { MotionPreference } from "@/components/ui/MotionPreference";
import { App } from "./App";
import { FramedScreen, ReloadScreen } from "./screens/States";

/**
 * One automatic reload when a chunk from an older deploy has gone.
 *
 * Pages replaces the whole site on every deploy, so a tab opened before one asks for
 * chunk names that no longer exist the next time it lazily loads a surface. Vite raises
 * this event before the import rejects; reloading fetches the current build, which is
 * what the visitor would otherwise have to work out to do.
 *
 * At most once a minute, remembered across the reload, so a build that is broken rather
 * than replaced falls through to `LoadBoundary` and its button instead of reloading in a
 * loop. Never while offline: the reload would swap a canvas that still works for the
 * browser's own error page.
 */
const RELOADED_AT = "kinfolk.reloaded-for-update";
window.addEventListener("vite:preloadError", (event) => {
	if (!navigator.onLine) return;
	try {
		if (Date.now() - Number(sessionStorage.getItem(RELOADED_AT) ?? 0) < 60_000) return;
		sessionStorage.setItem(RELOADED_AT, String(Date.now()));
	} catch {
		// No storage, no loop guard -- so no automatic reload either.
		return;
	}
	event.preventDefault();
	window.location.reload();
});

const root = document.getElementById("root");
if (!root) throw new Error("No #root element to mount into.");

createRoot(root).render(
	// Framed by another page: render the way out and nothing else (see FramedScreen).
	window.top !== window.self ? (
		<FramedScreen />
	) : (
		<MotionPreference>
			<LoadBoundary fallback={<ReloadScreen />}>
				<App />
			</LoadBoundary>
		</MotionPreference>
	),
);
