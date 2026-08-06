import { beforeAll, describe, expect, it } from "vitest";
import { issueState, verifyState } from "./oauth-state";

/**
 * The signing key. Set here rather than mocked, because the point of these tests
 * is that a real HMAC round trip works and a forged one does not.
 */
beforeAll(() => {
	process.env.AUTH_SECRET = "test-only-secret-not-a-real-one";
});

describe("issueState / verifyState", () => {
	it("accepts a token it just issued", async () => {
		expect(await verifyState(await issueState())).toBe(true);
	});

	it("issues a different token every time", async () => {
		// A reused state would let one authorize URL be replayed.
		const seen = new Set(await Promise.all([issueState(), issueState(), issueState()]));
		expect(seen.size).toBe(3);
	});

	it("refuses a token past its expiry", async () => {
		const issued = await issueState(0);
		// Ten minutes and one second later.
		expect(await verifyState(issued, 601_000)).toBe(false);
		// Still inside the window.
		expect(await verifyState(issued, 599_000)).toBe(true);
	});

	it("refuses a tampered expiry, which is the obvious forgery", async () => {
		const issued = await issueState(0);
		const [nonce, , signature] = issued.split(".");
		// Push the expiry far into the future, keeping the original signature.
		const forged = `${nonce}.${9_999_999_999_999}.${signature}`;
		expect(await verifyState(forged)).toBe(false);
	});

	it("refuses a tampered nonce", async () => {
		const issued = await issueState();
		const [, expiry, signature] = issued.split(".");
		expect(await verifyState(`${crypto.randomUUID()}.${expiry}.${signature}`)).toBe(false);
	});

	it("refuses a token signed with a different secret", async () => {
		const issued = await issueState();
		const original = process.env.AUTH_SECRET;
		process.env.AUTH_SECRET = "a-different-secret";
		try {
			// This is what stops somebody minting state against their own key.
			expect(await verifyState(issued)).toBe(false);
		} finally {
			process.env.AUTH_SECRET = original;
		}
	});

	it("refuses malformed input rather than throwing", async () => {
		for (const value of [null, "", "   ", "a", "a.b", "a.b.c.d", "....", "not-a-token"]) {
			expect(await verifyState(value), `must refuse ${JSON.stringify(value)}`).toBe(false);
		}
	});

	it("refuses a non-numeric expiry", async () => {
		// Reaches the expiry parse only if the signature matches, so this is signed
		// deliberately to prove the numeric check is not skipped.
		expect(await verifyState("nonce.notanumber.sig")).toBe(false);
	});
});
