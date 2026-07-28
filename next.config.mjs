/** @type {import('next').NextConfig} */
const nextConfig = {
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
