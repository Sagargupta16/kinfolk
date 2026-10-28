"use server";

/**
 * Entering and leaving demo mode.
 *
 * A cookie rather than a client store: the view is built in a server component,
 * so the flag has to be readable there. It also keeps `sample.ts` out of the
 * client bundle entirely -- the demo tree is only ever serialised as the same
 * node/edge payload real data produces.
 *
 * Session-scoped (no `maxAge`), so closing the browser ends the demo. Nobody
 * should come back a week later to sample data they have forgotten is fake.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_COOKIE } from "./demo";

export async function enterDemo() {
	const store = await cookies();
	store.set(DEMO_COOKIE, "1", {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		secure: process.env.NODE_ENV === "production",
	});
	// Asked for by name, so it wins over a session: a signed-in person pressing "Explore the
	// sample family" saw their OWN family, because /tree resolves a session first.
	redirect("/tree?demo=1");
}

export async function exitDemo() {
	const store = await cookies();
	store.delete(DEMO_COOKIE);
	redirect("/");
}
