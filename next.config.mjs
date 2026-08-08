/**
 * Response headers for the server-rendered app and API.
 *
 * The Next runtime requires inline bootstrap scripts and styles, so the CSP states
 * those allowances explicitly while still blocking arbitrary network, frame, object,
 * and base-URL targets. Development alone permits localhost connections for HMR.
 */
const production = process.env.NODE_ENV === "production";
const contentSecurityPolicy = [
	"default-src 'self'",
	"base-uri 'self'",
	production
		? "connect-src 'self'"
		: "connect-src 'self' http://localhost:* ws://localhost:* https://localhost:* wss://localhost:*",
	"font-src 'self' data:",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"img-src 'self' data: https://avatars.githubusercontent.com",
	"media-src 'none'",
	"object-src 'none'",
	production
		? "script-src 'self' 'unsafe-inline'"
		: "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"worker-src 'self' blob:",
	...(production ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
	{ key: "Content-Security-Policy", value: contentSecurityPolicy },
	{ key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "X-Frame-Options", value: "DENY" },
	...(production
		? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
		: []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
	async headers() {
		return [{ source: "/:path*", headers: securityHeaders }];
	},

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
