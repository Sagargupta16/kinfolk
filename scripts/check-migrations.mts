/**
 * Verify that the live Drizzle history is an exact prefix of the committed migrations.
 *
 * This database began with `db:push`, so migration 0000 had to be baselined by hand.
 * Running `db:migrate` against a database with no history would try to recreate every
 * existing table. This check fails before that can happen and also catches an applied
 * migration whose committed SQL was edited later.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required to check migration state.");

type Journal = {
	entries: { idx: number; when: number; tag: string }[];
};

const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as Journal;
const files = await readdir("drizzle");
const committed = await Promise.all(
	journal.entries.map(async (entry) => {
		const prefix = `${String(entry.idx).padStart(4, "0")}_`;
		const matches = files.filter((file) => file.startsWith(prefix) && file.endsWith(".sql"));
		if (matches.length !== 1) {
			throw new Error(`Expected one SQL file for migration ${entry.idx}, found ${matches.length}.`);
		}

		const file = matches[0] as string;
		const contents = await readFile(`drizzle/${file}`);
		return {
			file,
			hash: createHash("sha256").update(contents).digest("hex"),
			createdAt: entry.when,
		};
	}),
);

const sql = neon(url);
const [tracking] = await sql.query(
	"select to_regclass('drizzle.__drizzle_migrations')::text as name",
	[],
);
if (!tracking?.name) {
	throw new Error(
		"Migration tracking is missing. Refusing to run the baseline against existing tables.",
	);
}

const applied = (await sql.query(
	"select hash, created_at::text as created_at from drizzle.__drizzle_migrations order by created_at",
	[],
)) as { hash: string; created_at: string }[];

if (applied.length === 0) throw new Error("Migration tracking exists but contains no baseline.");
if (applied.length > committed.length) {
	throw new Error("The database contains migrations that are not present in this checkout.");
}

for (const [index, row] of applied.entries()) {
	const expected = committed[index];
	if (!expected || row.hash !== expected.hash || Number(row.created_at) !== expected.createdAt) {
		throw new Error(
			`Migration ${index} does not match ${expected?.file ?? "this checkout"}; refusing to continue.`,
		);
	}
}

const requireComplete = process.argv.includes("--complete");
if (requireComplete && applied.length !== committed.length) {
	throw new Error(
		`Only ${applied.length} of ${committed.length} committed migrations are applied.`,
	);
}

console.log(
	`Migration history verified: ${applied.length}/${committed.length} committed migrations applied.`,
);
