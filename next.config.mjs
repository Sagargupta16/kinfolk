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

/**
 * Security headers.
 *
 * Vercel already sends HSTS, so it is not repeated here. Everything else was
 * absent, verified by reading the live response rather than assumed.
 */
const securityHeaders = [
	// Stops a browser second-guessing a declared Content-Type, which is what turns
	// an uploaded file into a script.
	{ key: "X-Content-Type-Options", value: "nosniff" },
	// Send the origin to other sites, the full URL only to ourselves. A tree URL can
	// carry a person id, which is not something to hand to every third party.
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	// Nothing here needs a camera, a microphone or a location.
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
	// Clickjacking. `frame-ancestors` in the CSP is the modern form and covers this,
	// but X-Frame-Options is still what older browsers read.
	{ key: "X-Frame-Options", value: "DENY" },
	{
		key: "Content-Security-Policy",
		value: [
			"default-src 'self'",
			// `'unsafe-inline'`, deliberately, after two stricter attempts were measured
			// in a real browser and both broke the app. The weakening is real and worth
			// stating plainly rather than dressing up.
			//
			// Attempt 1, `'strict-dynamic'`: that keyword disables host-based
			// allowlisting by design, so `'self'` stopped applying and every
			// `/_next/static/chunks/*.js` was blocked. The shell rendered and the canvas
			// came up with ZERO nodes -- a failure that reads as a data bug, not a policy
			// one. It also cannot work here: `'strict-dynamic'` bootstraps from a nonce,
			// and these pages are cached rather than rendered per request, so a nonce
			// would be stale for the second visitor.
			//
			// Attempt 2, a sha256 hash of the theme script alongside `'unsafe-inline'`:
			// the browser said it outright -- "'unsafe-inline' is ignored if either a
			// hash or nonce value is present". Adding the hash therefore BLOCKS every
			// other inline script instead of narrowing anything.
			//
			// And those other scripts are React's streaming payload, emitted per render,
			// so they cannot be hashed at build time. Moving OUR theme script to an
			// external file would not help either: Next's own inline bootstrap would
			// still need `'unsafe-inline'`, so the hash buys nothing while costing a
			// round trip before first paint.
			//
			// What this policy still buys, which is not nothing: `default-src 'self'`,
			// a `connect-src` that names the only two hosts this app may talk to,
			// `frame-ancestors 'none'`, `object-src 'none'` and `base-uri 'self'`. An
			// injected script cannot exfiltrate to an arbitrary origin, reframe the page,
			// or rewrite relative URLs. Tightening `script-src` further needs Next to
			// support hashing its own inline bootstrap, or every page rendered
			// dynamically so a nonce is possible -- which would cost the static landing
			// page its caching.
			"script-src 'self' 'unsafe-inline'",
			// Tailwind emits a stylesheet, but React Flow and the pointer-tracked card
			// wash set style properties on elements, which counts as inline style.
			"style-src 'self' 'unsafe-inline'",
			// Avatars are initials today; GitHub's CDN is allowed because that is where
			// an OAuth profile image comes from once `photoKey` has a route.
			"img-src 'self' data: https://avatars.githubusercontent.com",
			"font-src 'self' data:",
			// The app talks to itself and to Neon over HTTPS. No wildcard: a graph that
			// can call anywhere is a graph that can exfiltrate anywhere.
			"connect-src 'self' https://*.neon.tech",
			"form-action 'self'",
			"frame-ancestors 'none'",
			"base-uri 'self'",
			// Blocks a plugin or applet embed outright.
			"object-src 'none'",
			"upgrade-insecure-requests",
		].join("; "),
	},
];

/** @type {import('next').NextConfig} */
const nextConfig = {
	basePath,

	async headers() {
		return [{ source: "/:path*", headers: securityHeaders }];
	},
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
