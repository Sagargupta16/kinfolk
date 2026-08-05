/**
 * Mount path, so the app can live at sagargupta.online/kinfolk beside the other
 * projects on that domain rather than on a hostname of its own.
 *
 * Read from the environment rather than hardcoded, because the same build has to serve
 * three places: `pnpm dev` at the root (empty), a Vercel preview at the root (empty),
 * and production under `/kinfolk`. Hardcoding it would make every local URL wrong.
 *
 * Next rewrites its own asset URLs, `<Link>` hrefs and router pushes through this, so
 * nothing in the app needs to know. What it does NOT rewrite is a hand-written string
 * in a fetch or a redirect -- there are none here, because every read is a server
 * component and every write a server action.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
	basePath,
	// Vercel serves assets from the deployment origin, and with a basePath the two have
	// to agree or every stylesheet 404s. Set explicitly rather than inferred.
	assetPrefix: basePath || undefined,

	// The in-app DevTools panel destabilises HMR on Windows + pnpm (same issue
	// as the kalchar repo); kept off as a dev-stability flag.
	devIndicators: false,

	experimental: {
		// TypeScript 7 removed the compiler API Next.js reaches for directly, so
		// Next must shell out to `tsc` instead. Without this, dev boot throws
		// "TypeScript 7.0.2 does not provide the compiler API required".
		// Remove once Next supports TS 7 natively.
		useTypeScriptCli: true,
	},
};

export default nextConfig;
