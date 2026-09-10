import { describe, expect, it, vi } from "vitest";
import { checkApi, checkSpa } from "../scripts/check-production.mjs";

const api = "https://api.example.invalid";
const spa = "https://family.example.invalid/kinfolk/";
const commit = "a".repeat(40);

function mockApi(servingCommit = commit) {
	const implementation: typeof fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname === "/api/health")
			return Response.json({
				status: "ready",
				database: "ready",
				auth: "configured",
				commit: servingCommit,
			});
		if (url.pathname === "/") return new Response("Kinfolk _next/static");
		if (url.pathname === "/signin") return new Response("Sign in");
		if (url.pathname === "/tree")
			return new Response(null, { status: 307, headers: { location: `${api}/signin` } });
		if (url.pathname === "/api/auth/providers")
			return Response.json({
				github: { id: "github", callbackUrl: `${api}/api/auth/callback/github` },
			});
		if (url.search === "?demo=1")
			return Response.json({ view: { isDemo: true, nodes: [{}], stats: { people: 1 } } });
		return new Response(null, { status: 401 });
	};
	vi.mocked(fetch).mockImplementation(implementation);
	return implementation;
}

function mockSpa(missingCanvas = false) {
	const implementation: typeof fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname.endsWith("asset-manifest.json"))
			return Response.json({
				"index.html": {
					file: "assets/index.js",
					css: ["assets/index.css"],
					assets: ["assets/family-font.woff2"],
				},
				canvas: { file: "assets/TreeWorkspace.js" },
			});
		if (url.pathname === "/kinfolk/" || url.pathname === "/kinfolk/tree")
			return new Response(
				`<title>Kinfolk</title><meta name="kinfolk-commit" content="${commit}"><div id="root"></div>`,
				{ status: url.pathname.endsWith("/tree") ? 404 : 200 },
			);
		if (missingCanvas && url.pathname.endsWith("TreeWorkspace.js"))
			return new Response(null, { status: 404 });
		return new Response("synthetic asset", {
			headers: {
				"content-type": url.pathname.endsWith(".css") ? "text/css" : "application/javascript",
			},
		});
	};
	vi.mocked(fetch).mockImplementation(implementation);
	return implementation;
}

describe("production safeguards", () => {
	it.each([
		"http://api.example.invalid",
		"ftp://localhost",
		"https://name:password@api.example.invalid",
	])("rejects an unsafe verification URL before making a request: %s", async (url) => {
		await expect(checkApi(url)).rejects.toThrow("HTTPS URL");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects a healthy deployment serving the previous commit", async () => {
		mockApi("b".repeat(40));
		await expect(checkApi(api, commit)).rejects.toThrow("another commit");
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("checks readiness, auth configuration, protected reads and sample data", async () => {
		mockApi();
		await expect(checkApi(api, commit)).resolves.toBeUndefined();
		expect(fetch).toHaveBeenCalledTimes(7);
	});

	it("rejects a sign-in redirect to another origin", async () => {
		const implementation = mockApi();
		vi.mocked(fetch).mockImplementation(async (...args) =>
			new URL(String(args[0])).pathname === "/tree"
				? new Response(null, {
						status: 307,
						headers: { location: "https://other.example.invalid/signin" },
					})
				: implementation(...args),
		);
		await expect(checkApi(api, commit)).rejects.toThrow("does not redirect to sign-in");
	});

	it("checks the lazy canvas and theme assets as well as the landing page", async () => {
		mockSpa();
		await expect(checkSpa(spa, commit)).resolves.toBeUndefined();
		expect(
			vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("TreeWorkspace.js")),
		).toBe(true);
		expect(
			vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("family-font.woff2")),
		).toBe(true);
	});

	it("rejects a stock Pages error at a tree deep link", async () => {
		const implementation = mockSpa();
		vi.mocked(fetch).mockImplementation(async (...args) =>
			new URL(String(args[0])).pathname === "/kinfolk/tree"
				? new Response("Page not found", { status: 404 })
				: implementation(...args),
		);
		await expect(checkSpa(spa, commit)).rejects.toThrow("deep link");
	});

	it("fails when Pages serves HTML but the canvas chunk is missing", async () => {
		mockSpa(true);
		await expect(checkSpa(spa, commit)).rejects.toThrow("404");
	});
});
