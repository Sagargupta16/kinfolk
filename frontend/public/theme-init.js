(function applyStoredTheme() {
	try {
		const theme = localStorage.getItem("kinfolk.theme") || "system";
		const motion = localStorage.getItem("kinfolk.motion") || "on";
		const dark =
			theme === "dark" ||
			(theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

		document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
		document.documentElement.setAttribute("data-motion", motion);
	} catch {}
})();
