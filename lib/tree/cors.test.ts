import { describe, expect, it } from "vitest";
import { corsHeaders, isAllowedOrigin, preflightHeaders } from "./cors";

describe("corsHeaders", () => {
	it("allows the Pages origin", () => {
		const h = corsHeaders("https://sagargupta.online");
		expect(h["Access-Control-Allow-Origin"]).toBe("https://sagargupta.online");
	});

	it("omits Allow-Origin for anything else, rather than reflecting it", () => {
		for (const origin of [
			"https://evil.example",
			// A lookalike: a prefix match would let this through.
			"https://sagargupta.online.evil.example",
			"https://notsagargupta.online",
			// Right host, wrong scheme.
			"http://sagargupta.online",
			// A subdomain is a different origin.
			"https://kinfolk.sagargupta.online",
			null,
			"",
			"null",
		]) {
			const h = corsHeaders(origin);
			expect(h["Access-Control-Allow-Origin"], `should not allow ${origin}`).toBeUndefined();
		}
	});

	it("never answers with a wildcard", () => {
		for (const origin of ["https://sagargupta.online", "https://evil.example", null]) {
			expect(Object.values(corsHeaders(origin))).not.toContain("*");
		}
	});

	it("always sets Vary: Origin, so a CDN cannot cache one origin's answer for another", () => {
		for (const origin of ["https://sagargupta.online", "https://evil.example", null]) {
			expect(corsHeaders(origin).Vary).toBe("Origin");
		}
	});

	it("never allows credentials, which is what keeps the cookie SameSite=Lax", () => {
		// If this ever fails, the session cookie has to become SameSite=None and
		// loses its CSRF protection. The header's absence is the load-bearing part.
		for (const origin of ["https://sagargupta.online", "https://evil.example", null]) {
			expect(corsHeaders(origin)["Access-Control-Allow-Credentials"]).toBeUndefined();
			expect(preflightHeaders(origin)["Access-Control-Allow-Credentials"]).toBeUndefined();
		}
	});
});

describe("preflightHeaders", () => {
	it("permits the Authorization header, or every authenticated call fails", () => {
		const h = preflightHeaders("https://sagargupta.online");
		expect(h["Access-Control-Allow-Headers"]).toContain("Authorization");
		expect(h["Access-Control-Allow-Methods"]).toContain("POST");
		expect(h["Access-Control-Allow-Methods"]).toContain("GET");
	});

	it("does not leak the allowance to a disallowed origin", () => {
		const h = preflightHeaders("https://evil.example");
		expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
	});
});

describe("isAllowedOrigin", () => {
	it("agrees with corsHeaders", () => {
		expect(isAllowedOrigin("https://sagargupta.online")).toBe(true);
		expect(isAllowedOrigin("https://evil.example")).toBe(false);
		expect(isAllowedOrigin(null)).toBe(false);
	});
});
