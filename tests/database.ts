import { readFile } from "node:fs/promises";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";

type Query = { query: string; params: unknown[] };

async function createTestDatabase() {
	const engine = new PGlite();
	const journal = JSON.parse(
		await readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
	) as { entries: { tag: string }[] };
	for (const entry of journal.entries) {
		await engine.exec(
			await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), "utf8"),
		);
	}

	const controls = { beforeBatch: null as (() => Promise<void>) | null };
	async function execute(connection: Pick<Transaction, "query">, statement: Query) {
		const result = await connection.query<unknown[]>(statement.query, statement.params, {
			rowMode: "array",
		});
		return {
			fields: result.fields,
			rowCount: result.rowCount ?? result.affectedRows ?? result.rows.length,
			rows: result.rows.map((row) =>
				row.map((value, column) => {
					if (value === null) return null;
					if (value instanceof Date) {
						const iso = value.toISOString();
						return result.fields[column]?.dataTypeID === 1082 ? iso.slice(0, 10) : iso;
					}
					if (typeof value === "boolean") return value ? "t" : "f";
					return typeof value === "object" ? JSON.stringify(value) : String(value);
				}),
			),
		};
	}

	// Exercise the real Neon/Drizzle batch protocol, with every request handled in memory.
	neonConfig.fetchFunction = async (_url: unknown, init: RequestInit) => {
		const body = JSON.parse(String(init.body)) as Query | { queries: Query[] };
		try {
			if ("queries" in body) {
				const beforeBatch = controls.beforeBatch;
				controls.beforeBatch = null;
				await beforeBatch?.();
				const results = await engine.transaction(async (transaction) => {
					const results = [];
					for (const query of body.queries) results.push(await execute(transaction, query));
					return results;
				});
				return Response.json({ results });
			}
			return Response.json(await execute(engine, body));
		} catch (error) {
			const failure = error as { message: string; code?: string };
			return Response.json({ message: failure.message, code: failure.code }, { status: 400 });
		}
	};
	const url = ["postgresql://", "synthetic", ":", "synthetic", "@unit.invalid/test"].join("");
	const db = drizzle(neon(url), { schema });
	return { db, engine, controls };
}

let instance: ReturnType<typeof createTestDatabase> | undefined;

export function testDatabase() {
	instance ??= createTestDatabase();
	return instance;
}

export function id(value: number): string {
	return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
