import { describe, expect, it } from "vitest";
import { normalizeGitHubLogin, parseInviteRole } from "./invite";

describe("parseInviteRole", () => {
	it("defaults a missing role to viewer", () => {
		expect(parseInviteRole(null)).toBe("viewer");
		expect(parseInviteRole(undefined)).toBe("viewer");
	});

	it("accepts only grantable roles", () => {
		expect(parseInviteRole("viewer")).toBe("viewer");
		expect(parseInviteRole("editor")).toBe("editor");
		expect(parseInviteRole("owner")).toBeNull();
		expect(parseInviteRole("")).toBeNull();
	});
});

describe("normalizeGitHubLogin", () => {
	it("normalizes case, whitespace, and a leading at-sign", () => {
		expect(normalizeGitHubLogin("  @SomeOne  ")).toBe("someone");
	});

	it("returns null for an empty login", () => {
		expect(normalizeGitHubLogin(null)).toBeNull();
		expect(normalizeGitHubLogin(" @ ")).toBeNull();
	});
});
