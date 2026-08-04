/**
 * Theme and motion preference, as stored values rather than media queries.
 *
 * ## Why theme is tri-state and motion is not
 *
 * `system` is a real theme choice: an OS that switches at dusk should take the canvas
 * with it, and that is the default. So the stored value is one of three and only two
 * of them are colours.
 *
 * Motion is a plain on/off with NO system arm, and that is deliberate. This app's
 * animations carry information -- the entrance stagger shows generations assembling
 * oldest first, the draw-on shows the skeleton growing downwards, the pulse shows
 * which way parentage runs -- so `prefers-reduced-motion` would silently delete a
 * data channel for anybody who set that flag years ago to stop advertising banners
 * jumping. An explicit in-app switch asks about THIS canvas, which is the only
 * question whose answer is knowable.
 *
 * Both are written to `localStorage` and mirrored onto `<html>` as attributes, because
 * CSS is what consumes them and an attribute selector costs nothing to read.
 */

export const THEMES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEMES)[number];
/** What `system` resolves to; the only two values CSS ever sees. */
export type Scheme = "light" | "dark";

export const THEME_KEY = "kinfolk.theme";
export const MOTION_KEY = "kinfolk.motion";

export const THEME_ATTR = "data-theme";
export const MOTION_ATTR = "data-motion";

export function isThemeChoice(value: unknown): value is ThemeChoice {
	return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * The script that runs before first paint.
 *
 * Inlined into `<head>` and deliberately synchronous. Themes live in `localStorage`,
 * which a server render cannot read, so without this the first paint is whatever the
 * markup says and the correct theme lands one frame later -- a white flash on the way
 * into a dark canvas, which is the single most-noticed bug in any theme
 * implementation.
 *
 * Written as a string rather than a function because it must not be bundled, hoisted
 * or deferred: it has to execute where it sits, above the body.
 *
 * Wrapped in try/catch because `localStorage` throws outright in a Safari private
 * window rather than returning null. An exception here would abort the whole inline
 * script and leave the document with no theme at all, so the fallback is the
 * attribute the server already wrote.
 */
export const THEME_SCRIPT = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(t!=="light"&&t!=="dark"&&t!=="system")t="system";
var s=t==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):t;
var e=document.documentElement;
e.setAttribute(${JSON.stringify(THEME_ATTR)},s);
e.style.colorScheme=s;
var m=localStorage.getItem(${JSON.stringify(MOTION_KEY)});
e.setAttribute(${JSON.stringify(MOTION_ATTR)},m==="off"?"off":"on");
}catch(_){}})();`;

/** What a stored choice means right now, resolving `system` against the OS. */
export function resolveScheme(choice: ThemeChoice): Scheme {
	if (choice !== "system") return choice;
	if (typeof window === "undefined") return "dark";
	return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Write the resolved scheme where CSS can see it. */
export function applyScheme(scheme: Scheme): void {
	const root = document.documentElement;
	root.setAttribute(THEME_ATTR, scheme);
	// Also the real CSS property, so form controls, scrollbars and the browser's own
	// chrome follow. An attribute alone leaves a dark canvas with white scrollbars.
	root.style.colorScheme = scheme;
}

export function applyMotion(enabled: boolean): void {
	document.documentElement.setAttribute(MOTION_ATTR, enabled ? "on" : "off");
}
