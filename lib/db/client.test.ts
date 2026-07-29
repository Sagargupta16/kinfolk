import { describe, expect, it } from "vitest";

/**
 * The contract this module has to keep: importable with no DATABASE_URL (so
 * `pnpm build` works on a fresh clone), but a query without one fails loudly
 * rather than reaching out to a placeholder host.
 */
describe("db client without DATABASE_URL", () => {
	it("imports without throwing", async () => {
		delete process.env.DATABASE_URL;
		const mod = await import("./client");
		expect(mod.db).toBeDefined();
		expect(mod.hasDatabase()).toBe(false);
	});

	it("names the missing variable when a query is actually run", async () => {
		delete process.env.DATABASE_URL;
		const { db } = await import("./client");
		const { people } = await import("./schema");

		// Drizzle wraps a driver throw in its own "Failed query" error, so the
		// actionable message lands on `cause` rather than the top-level message.
		const error = await db
			.select()
			.from(people)
			.then(
				() => null,
				(e: Error) => e,
			);

		expect(error).toBeInstanceOf(Error);
		expect((error?.cause as Error | undefined)?.message).toMatch(/DATABASE_URL is not set/);
	});
});
