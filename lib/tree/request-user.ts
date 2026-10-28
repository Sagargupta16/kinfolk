import { cookies, headers } from "next/headers";
import { sessionOrNull } from "@/auth";
import { userIdFromBearer } from "./bearer";
import { DEMO_COOKIE } from "./demo";

/**
 * Cookie and SPA requests use the same database session and permission checks.
 *
 * The cookie is tried FIRST so the server-rendered path is untouched. The bearer token
 * is for the Pages-hosted UI: that origin cannot send this app's cookie without it
 * becoming SameSite=None, so the SPA authenticates its calls with the session token
 * instead (see lib/tree/bearer.ts).
 */
export async function requestUserId(): Promise<string | null> {
	const session = await sessionOrNull();
	return session?.user?.id ?? userIdFromBearer((await headers()).get("authorization"));
}

/** Whether this request is browsing the sample family, which nothing may write to. */
export async function inDemo(): Promise<boolean> {
	return Boolean((await cookies()).get(DEMO_COOKIE));
}
