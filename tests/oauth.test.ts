import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeSignIn, signOut, startSignIn } from "../frontend/src/auth";

const stored = new Map<string, string>();
const assign = vi.fn();
const storage = {
	getItem: vi.fn((key: string) => stored.get(key) ?? null),
	setItem: vi.fn((key: string, value: string) => stored.set(key, value)),
	removeItem: vi.fn((key: string) => stored.delete(key)),
};

beforeEach(() => {
	stored.clear();
	vi.stubGlobal("sessionStorage", storage);
	vi.stubGlobal("window", {
		location: {
			origin: "http://localhost:5173",
			search: "?code=synthetic-code&state=initiating-state",
			assign,
		},
	});
});

describe("SPA OAuth browser binding", () => {
	it.each([null, "different-state"])("refuses a callback with expected state %s", async (state) => {
		if (state) stored.set("kinfolk.oauth-state", state);
		await expect(completeSignIn()).rejects.toThrow("could not be verified");
		expect(fetch).not.toHaveBeenCalled();
		expect(stored.has("kinfolk.token")).toBe(false);
	});

	it("refuses a callback when storage cannot be read", async () => {
		storage.getItem.mockImplementationOnce(() => {
			throw new Error("Storage unavailable");
		});
		await expect(completeSignIn()).rejects.toThrow("could not be verified");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("exchanges a matching callback and consumes its local state", async () => {
		stored.set("kinfolk.oauth-state", "initiating-state");
		vi.mocked(fetch).mockResolvedValue(
			Response.json({
				token: "synthetic-session",
				user: { name: "Test", email: null, image: null },
			}),
		);
		await expect(completeSignIn()).resolves.toMatchObject({ user: { name: "Test" } });
		expect(fetch).toHaveBeenCalledOnce();
		expect(stored.get("kinfolk.token")).toBe("synthetic-session");
		expect(stored.has("kinfolk.oauth-state")).toBe(false);
	});

	it("does not leave for GitHub when state cannot be saved", async () => {
		vi.mocked(fetch).mockResolvedValue(
			Response.json({ url: "https://github.com/login/oauth/authorize", state: "state" }),
		);
		storage.setItem.mockImplementationOnce(() => {
			throw new Error("Storage unavailable");
		});
		await expect(startSignIn()).rejects.toThrow("Allow session storage");
		expect(assign).not.toHaveBeenCalled();
	});

	it("revokes a new session instead of reporting success when token storage fails", async () => {
		stored.set("kinfolk.oauth-state", "initiating-state");
		storage.setItem.mockImplementationOnce(() => {
			throw new Error("Quota exceeded");
		});
		vi.mocked(fetch)
			.mockResolvedValueOnce(Response.json({ token: "synthetic-session" }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		await expect(completeSignIn()).rejects.toThrow("could not save the session");
		expect(stored.has("kinfolk.token")).toBe(false);
		expect(fetch).toHaveBeenLastCalledWith(
			expect.stringContaining("/api/oauth/signout"),
			expect.objectContaining({
				method: "POST",
				headers: { Authorization: "Bearer synthetic-session" },
			}),
		);
	});

	it("keeps the token available for retry when sign-out fails", async () => {
		stored.set("kinfolk.token", "synthetic-session");
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
		await expect(signOut()).rejects.toThrow("Could not sign out");
		expect(stored.get("kinfolk.token")).toBe("synthetic-session");
	});

	it("clears the local token only after revocation succeeds", async () => {
		stored.set("kinfolk.token", "synthetic-session");
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
		await signOut();
		expect(stored.has("kinfolk.token")).toBe(false);
	});
});
