import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The static UI, for GitHub Pages.
 *
 * Same shape as `apps/ledger-sync/frontend`: a Vite SPA published to Pages, talking
 * to the Vercel deployment over the JSON API in `app/api/`. The Next app stays as
 * the API and the server-rendered fallback -- it is not deleted, because sign-in
 * needs a server (`signIn()` is an OAuth redirect) and `/api/auth/*` cannot exist
 * in a static file.
 *
 * Components and graph maths are ALIASED from the repo root rather than copied.
 * Two canvases would drift, and the whole value of `lib/tree/` being free of React
 * and database imports is that it can be reused exactly like this.
 */
const isGitHubPages = process.env.GITHUB_PAGES === "true";

export default defineConfig({
	// Pages serves this from /kinfolk/ under the custom domain, matching how
	// /ledger-sync/ is served. Local dev is at the root, so a hardcoded base would
	// make every asset URL wrong in exactly one of the two places.
	base: isGitHubPages ? "/kinfolk/" : "/",

	plugins: [react(), tailwindcss()],

	resolve: {
		/**
		 * Order matters: Vite matches these in sequence, so the three REPLACEMENTS have
		 * to come before the general `@` rule or `@/lib/tree/edit-actions` would resolve
		 * to the real server actions and pull `next/headers` into the browser bundle.
		 *
		 * These four aliases are what let the components be shared rather than copied.
		 * Two canvases would drift; `lib/tree/` staying free of React and database
		 * imports is precisely what makes one canvas possible.
		 */
		alias: [
			{
				find: /^@\/lib\/tree\/(edit-actions|share-actions|demo-actions)$/,
				replacement: path.resolve(import.meta.dirname, "src/shims/edit-actions.ts"),
			},
			{
				find: /^next\/link$/,
				replacement: path.resolve(import.meta.dirname, "src/shims/next-link.tsx"),
			},
			{
				find: /^next\/navigation$/,
				replacement: path.resolve(import.meta.dirname, "src/shims/next-navigation.ts"),
			},
			{ find: /^@\//, replacement: `${path.resolve(import.meta.dirname, "..")}/` },
		],
	},

	build: {
		outDir: "dist",
		// Pages has no server, so a source map would publish readable source for a
		// private repo. The trade is worse stack traces in production.
		sourcemap: false,
	},
});
