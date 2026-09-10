import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, hasDatabase } from "@/lib/db/client";
import { version } from "@/package.json";

export const dynamic = "force-dynamic";

/** Readiness without family rows, credentials, or database errors in the response. */
export async function GET() {
	let database = "unavailable";
	if (hasDatabase()) {
		try {
			// LIMIT 0 still resolves these tables and columns and reaches Postgres.
			// It never reads or returns a person's record or a session token.
			await db.execute(sql`
				SELECT users.github_login, sessions.expires, trees.root_person_id,
					tree_members.role, tree_invites.status, people.living, people.verification,
					unions.partner_a_id, union_children.role, person_relations.kind,
					contact_details.visibility, person_links.status, people_creation_budgets.used
				FROM users, sessions, trees, tree_members, tree_invites, people, unions,
					union_children, person_relations, contact_details, person_links, people_creation_budgets
				LIMIT 0
			`);
			database = "ready";
		} catch {
			console.error("[health] database readiness failed");
		}
	}
	const auth =
		process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
			? "configured"
			: "unavailable";
	const ready = database === "ready" && auth === "configured";
	return NextResponse.json(
		{
			status: ready ? "ready" : "degraded",
			version,
			commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
			database,
			auth,
		},
		{ status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
	);
}
