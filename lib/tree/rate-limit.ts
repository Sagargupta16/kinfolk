/**
 * A durable, atomic creation budget for one tree.
 *
 * Serverless instances cannot share an in-memory counter, and a count followed by an
 * insert lets concurrent requests all pass together. One conditional Postgres upsert
 * reserves capacity instead, so the database serializes every instance on the tree row.
 */
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { people, peopleCreationBudgets } from "@/lib/db/schema";

export const PEOPLE_PER_HOUR = 500;

const WINDOW_MS = 60 * 60 * 1000;
const UNDEFINED_TABLE = "42P01";

export type RateVerdict = { ok: true } | { ok: false; error: string };

function refused(): RateVerdict {
	return {
		ok: false,
		error: `That would exceed this graph's ${PEOPLE_PER_HOUR}-person creation budget for the current hour. Wait a little and try again.`,
	};
}

/** Read a Postgres code through Drizzle's nested error without logging its contents. */
function postgresCode(error: unknown): string | null {
	let current = error;
	for (let depth = 0; depth < 3; depth += 1) {
		if (!current || typeof current !== "object") return null;
		const candidate = current as { code?: unknown; cause?: unknown };
		if (typeof candidate.code === "string") return candidate.code;
		current = candidate.cause;
	}
	return null;
}

/** Temporary compatibility path while deployment applies the additive counter table. */
async function checkExistingPeople(treeId: string, wanted: number): Promise<RateVerdict> {
	const since = new Date(Date.now() - WINDOW_MS);
	const rows = await db
		.select({ n: count() })
		.from(people)
		.where(and(eq(people.treeId, treeId), gt(people.createdAt, since)));

	return (rows[0]?.n ?? 0) + wanted <= PEOPLE_PER_HOUR ? { ok: true } : refused();
}

/** Reserve capacity for `wanted` people in this tree's current hour-long window. */
export async function reservePeopleBudget(treeId: string, wanted = 1): Promise<RateVerdict> {
	if (!Number.isSafeInteger(wanted) || wanted < 1 || wanted > PEOPLE_PER_HOUR) {
		return refused();
	}

	try {
		const expired = sql`${peopleCreationBudgets.windowStartedAt} <= now() - interval '1 hour'`;
		const rows = await db
			.insert(peopleCreationBudgets)
			.values({ treeId, used: wanted })
			.onConflictDoUpdate({
				target: peopleCreationBudgets.treeId,
				set: {
					windowStartedAt: sql`case when ${expired} then now() else ${peopleCreationBudgets.windowStartedAt} end`,
					used: sql<number>`case when ${expired} then ${wanted} else ${peopleCreationBudgets.used} + ${wanted} end`,
				},
				setWhere: sql`${expired} or ${peopleCreationBudgets.used} + ${wanted} <= ${PEOPLE_PER_HOUR}`,
			})
			.returning({ treeId: peopleCreationBudgets.treeId });

		return rows.length > 0 ? { ok: true } : refused();
	} catch (error) {
		// Deploy and migration workflows start independently. Until the additive table
		// exists, retain the prior durable check rather than breaking every creation.
		if (postgresCode(error) === UNDEFINED_TABLE) {
			return checkExistingPeople(treeId, wanted);
		}
		throw error;
	}
}
