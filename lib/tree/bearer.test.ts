import { describe, expect, it } from "vitest";
import { bearerToken } from "./bearer-header";

/**
 * The token itself is never validated here -- only the header is parsed. An
 * accepted string still has to match a live `sessions` row, so a lenient parser
 * cannot invent a session. It CAN widen what reaches the database as a lookup
 * key, which is reason enough to pin the shape.
 */
describe("bearerToken", () => {
	it("reads a well formed header", () => {
		expect(bearerToken("Bearer abc123")).toBe("abc123");
	});

	it("accepts a real Auth.js session token, which is a uuid", () => {
		const uuid = "3f8a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
		expect(bearerToken(`Bearer ${uuid}`)).toBe(uuid);
	});

	it("matches the scheme case-insensitively, per RFC 7235", () => {
		expect(bearerToken("bearer abc")).toBe("abc");
		expect(bearerToken("BEARER abc")).toBe("abc");
		expect(bearerToken("BeArEr abc")).toBe("abc");
	});

	it("tolerates surrounding whitespace", () => {
		expect(bearerToken("  Bearer abc  ")).toBe("abc");
	});

	it("refuses anything that is not exactly one Bearer token", () => {
		for (const header of [
			null,
			"",
			"   ",
			"Bearer",
			"Bearer ",
			"abc",
			"Basic abc",
			"Token abc",
			// A second value: taking the first would let a caller append junk and
			// still authenticate, so the whole header is rejected instead.
			"Bearer abc def",
			"Bearer  abc",
			"BearerAbc",
			// A cookie pasted into the wrong header.
			"kinfolk.session-token=abc",
		]) {
			expect(bearerToken(header), `should refuse ${JSON.stringify(header)}`).toBeNull();
		}
	});

	it("does not strip quotes or decode the token", () => {
		// The stored token is an opaque uuid, so a quoted or encoded value is not
		// one of ours. Unwrapping it here would accept a shape we never issued.
		expect(bearerToken('Bearer "abc"')).toBe('"abc"');
		expect(bearerToken("Bearer abc%20def")).toBe("abc%20def");
	});
});
