/**
 * Sign-in, driven entirely from the visitor's own origin.
 *
 * The shape is ledger-sync's: ask the API for an authorize URL, send the browser to
 * GitHub, and GitHub returns it HERE -- to a page served from `sagargupta.online`,
 * not to the API host. The code is then posted back for exchange.
 *
 * The address bar therefore reads the visitor's own domain for the entire flow
 * except the moment they are on GitHub authorising, which is the one hop that
 * cannot be anywhere else.
 */
import { API_BASE, clearToken, getToken, setToken } from "./api";

/**
 * Where GitHub returns the visitor.
 *
 * Built from the page's own origin plus Vite's `BASE_URL`, so it is correct in dev
 * (`localhost:5173/auth/callback/github`) and in production
 * (`sagargupta.online/kinfolk/auth/callback/github`) without a second constant to
 * keep in step. It must match a callback registered on the GitHub OAuth app AND an
 * entry in the API's origin allow list.
 */
export function callbackUrl(): string {
	const base = import.meta.env.BASE_URL.replace(/\/$/, "");
	return `${window.location.origin}${base}/auth/callback/github`;
}

const STATE_KEY = "kinfolk.oauth-state";

/** Send the visitor to GitHub. */
export async function startSignIn(): Promise<void> {
	// Anchored on the page's own origin so the DEV case works: API_BASE is empty
	// there, and `new URL("/api/...")` with no base throws TypeError before any
	// request is made -- a sign-in button that does nothing. With an absolute
	// API_BASE (production) the base argument is ignored per the URL spec.
	const url = new URL(`${API_BASE}/api/oauth/authorize`, window.location.origin);
	url.searchParams.set("redirect_uri", callbackUrl());

	const response = await fetch(url, { headers: { Accept: "application/json" } });
	if (!response.ok) {
		throw new Error("Sign-in is unavailable right now.");
	}
	const { url: authorize, state } = (await response.json()) as { url: string; state: string };

	// Kept so the return leg can compare. The server verifies the state by signature
	// regardless -- this is the cheaper check that catches a link opened in a
	// different tab before a network round trip.
	try {
		sessionStorage.setItem(STATE_KEY, state);
	} catch {
		// Storage unavailable. The server-side check still applies, so the flow works.
	}

	window.location.assign(authorize);
}

export type CompletedSignIn = {
	isNewUser: boolean;
	user: { name: string | null; email: string | null; image: string | null };
};

type SignInResponse = {
	token?: unknown;
	error?: unknown;
	cause?: unknown;
	isNewUser?: boolean;
	user?: CompletedSignIn["user"];
};

async function readSignInResponse(response: Response): Promise<SignInResponse | null> {
	try {
		const body: unknown = await response.json();
		if (!body || typeof body !== "object" || Array.isArray(body)) return null;
		return body as SignInResponse;
	} catch {
		return null;
	}
}

/**
 * Finish the flow on the callback page.
 *
 * Reads `code` and `state` from the current URL, posts them for exchange, and stores
 * the returned token. Throws with a readable message on failure, because the caller
 * renders it -- an OAuth error the visitor cannot interpret is indistinguishable
 * from a broken site.
 */
export async function completeSignIn(): Promise<CompletedSignIn> {
	const params = new URLSearchParams(window.location.search);

	// GitHub reports a refusal in the query rather than by status.
	const denied = params.get("error");
	if (denied) {
		throw new Error(
			denied === "access_denied"
				? "Sign-in was cancelled."
				: "GitHub could not complete the sign-in.",
		);
	}

	const code = params.get("code");
	const state = params.get("state");
	if (!code || !state) throw new Error("That sign-in link is incomplete.");

	let expected: string | null = null;
	try {
		expected = sessionStorage.getItem(STATE_KEY);
	} catch {}
	if (expected && expected !== state) {
		throw new Error("That sign-in was started in a different tab. Try again.");
	}

	const response = await fetch(`${API_BASE}/api/oauth/callback`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		// POST, so the code never lands in a log, in history or in a Referer.
		body: JSON.stringify({ code, state, redirect_uri: callbackUrl() }),
	});

	if (!response.ok) {
		const body = await readSignInResponse(response);
		const error =
			typeof body?.error === "string" && body.error.trim()
				? body.error.trim()
				: "Could not complete sign-in.";
		const cause = typeof body?.cause === "string" && body.cause.trim() ? body.cause.trim() : null;

		// `cause` is appended when the API sends one. Drizzle nests the real Postgres
		// error there while `message` holds only the statement, so showing the message
		// alone reports a symptom and withholds the diagnosis -- which cost a round of
		// this exact investigation.
		throw new Error(cause ? `${error} -- ${cause}` : error);
	}

	const body = await readSignInResponse(response);
	if (!body || typeof body.token !== "string" || !body.token) {
		throw new Error("Could not complete sign-in.");
	}

	setToken(body.token);
	try {
		sessionStorage.removeItem(STATE_KEY);
	} catch {}

	return {
		isNewUser: body.isNewUser ?? false,
		user: body.user ?? { name: null, email: null, image: null },
	};
}

/**
 * Sign out, server-side as well as locally.
 *
 * Keep the bearer token until the server confirms revocation. If the request fails,
 * retaining it lets the visitor retry instead of reporting success while a copied
 * token remains valid for the rest of its thirty-day lifetime. The endpoint is
 * idempotent, so retrying after a lost success response is safe.
 */
export async function signOut(): Promise<void> {
	const token = getToken();
	if (!token) return;

	const response = await fetch(`${API_BASE}/api/oauth/signout`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!response.ok) throw new Error("Could not sign out. Try again.");

	clearToken();
}
