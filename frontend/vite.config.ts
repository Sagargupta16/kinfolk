import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

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
export default defineConfig(({ command, mode }) => {
	const configuredApi =
		process.env.VITE_API_BASE_URL ??
		loadEnv(mode, import.meta.dirname, "VITE_").VITE_API_BASE_URL ??
		"";
	let apiOrigin = "";
	if (configuredApi) {
		let url: URL;
		try {
			url = new URL(configuredApi);
		} catch {
			throw new Error("VITE_API_BASE_URL must be an HTTPS origin.");
		}
		if (
			(url.protocol !== "https:" &&
				!(
					command === "serve" &&
					url.protocol === "http:" &&
					["localhost", "127.0.0.1"].includes(url.hostname)
				)) ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		) {
			throw new Error("VITE_API_BASE_URL must be an HTTPS origin without credentials or a path.");
		}
		apiOrigin = url.origin;
	}
	if (isGitHubPages && !apiOrigin) {
		throw new Error("VITE_API_BASE_URL is required for a Pages build.");
	}
	const productionConnectSources = `'self'${apiOrigin ? ` ${apiOrigin}` : ""}`;
	const developmentConnectSources = `${productionConnectSources} http://localhost:3007 https://localhost:3007 ws://localhost:5173`;

	return {
		// Pages serves this from /kinfolk/ under the custom domain, matching how
		// /ledger-sync/ is served. Local dev is at the root, so a hardcoded base would
		// make every asset URL wrong in exactly one of the two places.
		base: isGitHubPages ? "/kinfolk/" : "/",
		define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiOrigin) },

		plugins: [
			{
				name: "kinfolk-csp-connect-sources",
				transformIndexHtml(html) {
					const connectSources =
						command === "build" ? productionConnectSources : developmentConnectSources;
					return html
						.replace("__KINFOLK_CONNECT_SOURCES__", connectSources)
						.replace(
							"__KINFOLK_COMMIT__",
							/^[a-f0-9]{40}$/i.test(process.env.GITHUB_SHA ?? "")
								? (process.env.GITHUB_SHA ?? "")
								: "development",
						);
				},
			},
			react(),
			tailwindcss(),
		],

		server: {
			/**
			 * Local dev serves /api from the same origin, exactly as src/api.ts documents:
			 * API_BASE is empty in dev, so every fetch is relative and this proxy hands it
			 * to the Next app. No CORS locally, and the request shape matches production,
			 * where Pages calls the Vercel origin instead.
			 */
			proxy: {
				"/api": {
					target: "http://localhost:3007",
					changeOrigin: true,
				},
			},
		},

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
					find: /^@\/lib\/tree\/(edit-actions|share-actions|demo-actions|link-actions|contact-state)$/,
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
			// Pages publishes only build output. Source maps stay off to avoid shipping
			// readable implementation source and to keep the artifact small.
			sourcemap: false,
			manifest: "asset-manifest.json",
		},
	};
});
