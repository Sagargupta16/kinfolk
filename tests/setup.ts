import { beforeEach, vi } from "vitest";

beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Tests must mock network requests.");
		}),
	);
});
