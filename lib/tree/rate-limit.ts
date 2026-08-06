/**
 * A per-user write budget, counted in the database.
 *
 * `/api/action/*` accepts authenticated writes with no ceiling, so one valid
 * token could create people until the Neon row limit stopped it. That is not a
 * hypothetical for a graph app: a loop in somebody's own client is enough.
 *
 * Counted in Postgres rather than in a Map, and that is forced rather than chosen.
 * Each serverless invocation is a fresh process, so an in-memory counter is
 * per-instance -- it would reset on every cold start and hold a different number
 * on each concurrent instance, which is worse than no limit because it looks like
 * one. The rows already exist and carry `createdAt`, so the budget is read off the
 * real data with no new table to keep in step.
 *
 * The limit is on PEOPLE CREATED, not on requests. A request count would refuse an
 * edit to an existing person, which is the ordinary use, while a runaway loop
 * creating rows is the thing actually worth stopping. Editing, deleting and
 * relating are all unbounded on purpose.
 */
import { and, count, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { people, trees } from "@/lib/db/schema";

/**
 * How many people one user may create per hour, across all their trees.
 *
 * 500 is deliberately far above real use and far below abuse. The sample tree is
 * 117 people and took a family two generations to describe; a batch add is capped
 * at 12 by `MAX_BATCH`. Somebody importing a large family by hand will not notice
 * this, and a loop will hit it in seconds.
 */
export const PEOPLE_PER_HOUR = 500;

const WINDOW_MS = 60 * 60 * 1000;

export type RateVerdict = { ok: true } | { ok: false; error: string };

/**
 * Whether this user may create `wanted` more people right now.
 *
 * Counts rows in trees the user OWNS. A tree reached through an editor grant is
 * somebody else's budget, and charging a guest's writes to the owner would let one
 * account exhaust another's -- which is a denial of service dressed as a quota.
 */
export async function checkPeopleBudget(userId: string, wanted = 1): Promise<RateVerdict> {
	const since = new Date(Date.now() - WINDOW_MS);

	const rows = await db
		.select({ n: count() })
		.from(people)
		.innerJoin(trees, eq(people.treeId, trees.id))
		.where(and(eq(trees.ownerId, userId), gt(people.createdAt, since)));

	const used = rows[0]?.n ?? 0;
	if (used + wanted <= PEOPLE_PER_HOUR) return { ok: true };

	// The message names the limit and the window, because a refusal a user cannot
	// act on is indistinguishable from a bug. It deliberately does not say how many
	// they have left: that is a counter worth watching, not worth publishing.
	return {
		ok: false,
		error: `That is more than ${PEOPLE_PER_HOUR} people added in an hour. Wait a little and carry on.`,
	};
}
