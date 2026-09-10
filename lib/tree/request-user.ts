import { headers } from "next/headers";
import { sessionOrNull } from "@/auth";
import { userIdFromBearer } from "./bearer";

/** Cookie and SPA requests use the same database session and permission checks. */
export async function requestUserId(): Promise<string | null> {
	const session = await sessionOrNull();
	return session?.user?.id ?? userIdFromBearer((await headers()).get("authorization"));
}
