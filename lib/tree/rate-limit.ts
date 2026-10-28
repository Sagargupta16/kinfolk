/**
 * A durable, atomic creation budget for one tree.
 *
 * Serverless instances cannot share an in-memory counter, and a count followed by an
 * insert lets concurrent requests all pass together. One conditional Postgres upsert
 * reserves capacity instead, so the database serializes every instance on the tree row.
 */
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
	contactDetails,
	people,
	peopleCreationBudgets,
	personLinks,
	personRelations,
	treeInvites,
	unions,
} from "@/lib/db/schema";
import { postgresCode } from "./pg-error";

const PEOPLE_PER_HOUR = 500;

const WINDOW_MS = 60 * 60 * 1000;
const UNDEFINED_TABLE = "42P01";

type RateVerdict = { ok: true } | { ok: false; error: string };

function refused(): RateVerdict {
	return {
		ok: false,
		error: `That would exceed this graph's ${PEOPLE_PER_HOUR}-person creation budget for the current hour. Wait a little and try again.`,
	};
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

/**
 * Ceilings for the rows that people are not, per hour.
 *
 * A count rather than the atomic reservation people get. Nothing in the UI adds these in
 * bulk -- partnerships, connections and children come from the action API one at a time,
 * invites and link proposals one at a time from their panels -- so each ceiling exists to
 * stop a script filling the shared database, not to meter a busy form. Concurrent
 * requests can pass a count together, but only by their own number, which a ceiling this
 * far above real use absorbs.
 */
const HOURLY = {
	/** Per graph. */
	unions: 500,
	/** Per graph. */
	relations: 500,
	/** Per graph. */
	invites: 50,
	/** Per proposer: a proposal can name any record they can see, in any family. */
	proposals: 100,
} as const;

type HourlyBudget = keyof typeof HOURLY;

const NOUNS: Record<HourlyBudget, string> = {
	unions: "partnerships",
	relations: "connections",
	invites: "invites",
	proposals: "link proposals",
};

async function recentRows(kind: HourlyBudget, scopeId: string, since: Date): Promise<number> {
	const [row] =
		kind === "unions"
			? await db
					.select({ n: count() })
					.from(unions)
					.where(and(eq(unions.treeId, scopeId), gt(unions.createdAt, since)))
			: kind === "relations"
				? await db
						.select({ n: count() })
						.from(personRelations)
						.where(and(eq(personRelations.treeId, scopeId), gt(personRelations.createdAt, since)))
				: kind === "invites"
					? await db
							.select({ n: count() })
							.from(treeInvites)
							.where(and(eq(treeInvites.treeId, scopeId), gt(treeInvites.createdAt, since)))
					: await db
							.select({ n: count() })
							.from(personLinks)
							.where(and(eq(personLinks.proposedById, scopeId), gt(personLinks.createdAt, since)));
	return row?.n ?? 0;
}

/** Whether one more row of this kind fits the current hour, for a graph or a proposer. */
export async function withinHourlyBudget(
	kind: HourlyBudget,
	scopeId: string,
): Promise<RateVerdict> {
	const since = new Date(Date.now() - WINDOW_MS);
	if ((await recentRows(kind, scopeId, since)) < HOURLY[kind]) return { ok: true };
	return {
		ok: false,
		error: `That is more ${NOUNS[kind]} than one hour allows (${HOURLY[kind]}). Wait a little and try again.`,
	};
}

/**
 * Contact details one person may carry.
 *
 * A ceiling rather than a rate: nobody has fifty phone numbers, and without it a script
 * could attach unlimited distinct values to one record, each under the 2,000-character
 * cap and each passing the unique index.
 */
const CONTACTS_PER_PERSON = 50;

export async function withinContactLimit(personId: string): Promise<RateVerdict> {
	const [row] = await db
		.select({ n: count() })
		.from(contactDetails)
		.where(eq(contactDetails.personId, personId));
	if ((row?.n ?? 0) < CONTACTS_PER_PERSON) return { ok: true };
	return {
		ok: false,
		error: `One person can carry up to ${CONTACTS_PER_PERSON} contact details. Remove one before adding another.`,
	};
}
