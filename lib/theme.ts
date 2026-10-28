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

const THEMES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEMES)[number];
/** What `system` resolves to; the only two values CSS ever sees. */
type Scheme = "light" | "dark";

export const THEME_KEY = "kinfolk.theme";
export const MOTION_KEY = "kinfolk.motion";

export const THEME_ATTR = "data-theme";
export const MOTION_ATTR = "data-motion";

function isThemeChoice(value: unknown): value is ThemeChoice {
	return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * The browser's own chrome per scheme: the address bar and status bar on a phone.
 *
 * These are `--kf-canvas` from the two `[data-theme]` blocks in app/globals.css, so the
 * chrome continues the canvas instead of framing it; change them together. ONE
 * `<meta name="theme-color">` carries the value and is rewritten whenever the scheme is,
 * because the usual pair of metas with media queries follows the OS and ignores the
 * Light or Dark choice made inside the app. `frontend/public/theme-init.js` repeats the
 * two values, since a static file cannot import them.
 */
const THEME_COLOR: Record<Scheme, string> = { dark: "#0b1012", light: "#f5f7f8" };

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
 *
 * The theme-color meta is CREATED here rather than rendered by the layout. React 19
 * matches a hydrating `<meta>` by its `content`, so one whose content this script had
 * already changed would not match, and React would add a second meta beside it.
 */
export const THEME_SCRIPT = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(t!=="light"&&t!=="dark"&&t!=="system")t="system";
var s=t==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):t;
var e=document.documentElement;
e.setAttribute(${JSON.stringify(THEME_ATTR)},s);
e.style.colorScheme=s;
var c=document.querySelector('meta[name="theme-color"]');
if(!c){c=document.createElement("meta");c.name="theme-color";document.head.appendChild(c);}
c.content=s==="light"?${JSON.stringify(THEME_COLOR.light)}:${JSON.stringify(THEME_COLOR.dark)};
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
	// And the phone's address bar, which neither the attribute nor the property reaches.
	let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (!meta) {
		meta = document.createElement("meta");
		meta.name = "theme-color";
		document.head.append(meta);
	}
	meta.content = THEME_COLOR[scheme];
}

/**
 * The choice made in this tab.
 *
 * Kept beside storage rather than instead of it, for a browser whose storage refuses
 * writes: without it the OS listener below would read nothing back, take the choice for
 * `system`, and undo a Dark picked a minute earlier at the next dusk.
 */
let chosen: ThemeChoice | null = null;

/** What the visitor chose: this tab's pick, else the stored value, else `system`. */
export function storedTheme(): ThemeChoice {
	if (chosen) return chosen;
	try {
		const stored = localStorage.getItem(THEME_KEY);
		if (isThemeChoice(stored)) return stored;
	} catch {
		// A private window can throw rather than return null; `system` is the default.
	}
	return "system";
}

/** Apply a theme choice and keep it. */
export function chooseTheme(choice: ThemeChoice): void {
	chosen = choice;
	applyScheme(resolveScheme(choice));
	try {
		localStorage.setItem(THEME_KEY, choice);
	} catch {
		// Unwritable storage costs persistence, not the switch: the attribute is applied,
		// and `chosen` holds the choice for the rest of this tab.
	}
}

/**
 * Keep a `system` theme following the OS while a page is open. Returns the cleanup.
 *
 * Called from `MotionPreference`, the one client component both runtimes mount on every
 * page. The listener used to live in the Appearance menu, which exists only while it is
 * open, so a canvas left open through dusk kept the scheme it was opened in -- the one
 * thing `system` promises not to do. The choice is read when the OS changes, not when
 * this starts, so picking Light or Dark later needs no re-subscription.
 */
export function followSystemScheme(): () => void {
	const query = window.matchMedia("(prefers-color-scheme: light)");
	const onChange = () => {
		if (storedTheme() === "system") applyScheme(resolveScheme("system"));
	};
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

export function applyMotion(enabled: boolean): void {
	document.documentElement.setAttribute(MOTION_ATTR, enabled ? "on" : "off");
}
