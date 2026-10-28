/*
 * THEME_SCRIPT from lib/theme.ts, for the static app, whose CSP refuses inline script.
 *
 * Same keys, same fallbacks and the same two theme-color values, because a page whose
 * first paint disagrees with the Next app's is the white flash that script exists to
 * prevent. A static file cannot import, so change the two together.
 */
(function applyStoredTheme() {
	try {
		let theme = localStorage.getItem("kinfolk.theme");
		if (theme !== "light" && theme !== "dark" && theme !== "system") theme = "system";
		let scheme = theme;
		if (theme === "system") {
			scheme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
		}

		const root = document.documentElement;
		root.setAttribute("data-theme", scheme);
		root.style.colorScheme = scheme;

		// The phone's address bar, which follows the in-app choice rather than the OS.
		let meta = document.querySelector('meta[name="theme-color"]');
		if (!meta) {
			meta = document.createElement("meta");
			meta.name = "theme-color";
			document.head.append(meta);
		}
		meta.content = scheme === "light" ? "#f5f7f8" : "#0b1012";

		const motion = localStorage.getItem("kinfolk.motion");
		root.setAttribute("data-motion", motion === "off" ? "off" : "on");
	} catch {}
})();
