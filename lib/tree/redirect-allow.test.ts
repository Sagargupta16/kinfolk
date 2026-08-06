import { describe, expect, it } from "vitest";
import { allowedRedirect } from "./redirect-allow";

describe("allowedRedirect", () => {
	it("allows the Pages origin the SPA is served from", () => {
		expect(allowedRedirect("https://sagargupta.online/kinfolk/")).toBe(
			"https://sagargupta.online/kinfolk/",
		);
	});

	it("keeps the path and query, so the SPA returns where it left off", () => {
		expect(allowedRedirect("https://sagargupta.online/kinfolk/tree?combined=0")).toBe(
			"https://sagargupta.online/kinfolk/tree?combined=0",
		);
	});

	it("strips a fragment, because the token is appended as one", () => {
		expect(allowedRedirect("https://sagargupta.online/kinfolk/#stale")).toBe(
			"https://sagargupta.online/kinfolk/",
		);
	});

	it("refuses a lookalike host, which a prefix check would accept", () => {
		// The whole reason this compares parsed origins. Every one of these begins
		// with an allowed string, and none of them is our host.
		for (const value of [
			"https://sagargupta.online.evil.example/",
			"https://sagargupta.online@evil.example/",
			"https://sagargupta.onlineevil.example/",
			"https://notsagargupta.online/",
			"https://evil.example/?x=https://sagargupta.online",
		]) {
			expect(allowedRedirect(value), `must refuse ${value}`).toBeNull();
		}
	});

	it("refuses a different scheme on the right host", () => {
		// http would send the token in clear, and javascript: would execute it.
		expect(allowedRedirect("http://sagargupta.online/")).toBeNull();
		expect(allowedRedirect("javascript:alert(1)")).toBeNull();
		expect(allowedRedirect("data:text/html,<script>")).toBeNull();
	});

	it("refuses a subdomain, which is a different origin", () => {
		expect(allowedRedirect("https://kinfolk.sagargupta.online/")).toBeNull();
	});

	it("refuses a relative path or junk", () => {
		for (const value of [null, "", "   ", "/kinfolk/", "//evil.example", "not a url"]) {
			expect(allowedRedirect(value), `must refuse ${JSON.stringify(value)}`).toBeNull();
		}
	});

	it("allows the two localhost origins used to exercise the flow", () => {
		expect(allowedRedirect("http://localhost:5173/")).toBe("http://localhost:5173/");
		expect(allowedRedirect("http://localhost:3007/tree")).toBe("http://localhost:3007/tree");
		// A different port is a different origin.
		expect(allowedRedirect("http://localhost:9999/")).toBeNull();
	});
});
