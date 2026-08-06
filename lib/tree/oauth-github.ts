/**
 * The GitHub half of an OAuth flow the SPA can drive.
 *
 * Auth.js owns the flow for the server-rendered app and keeps doing so. This
 * exists because a static frontend needs the browser to come back to ITSELF rather
 * than to the API host: the `redirect_uri` points at the SPA, which reads the code
 * from its own URL and posts it here for exchange. That is the pattern in
 * `apps/ledger-sync` (`backend/src/ledger_sync/api/oauth.py`), and it is the only
 * way the address bar stays on the visitor's own domain for the whole sign-in.
 *
 * PKCE is deliberately absent. It exists so a PUBLIC client -- one that cannot keep
 * a secret, like a pure SPA -- can prove it started the flow it is finishing. Here
 * the exchange happens on the server with `AUTH_GITHUB_SECRET`, so this is a
 * CONFIDENTIAL client and the secret already provides that proof. The code never
 * touches the browser except as an opaque string in a URL, and `state` covers CSRF.
 *
 * The network calls are here rather than in the route so the route reads as a
 * sequence of decisions, and so a failure at each hop can be told apart.
 */

const AUTHORIZE = "https://github.com/login/oauth/authorize";
const TOKEN = "https://github.com/login/oauth/access_token";
const API = "https://api.github.com";

/** Only what this app stores. GitHub returns far more. */
export type GitHubProfile = {
	providerAccountId: string;
	login: string;
	name: string | null;
	email: string | null;
	avatarUrl: string | null;
};

function clientId(): string {
	const value = process.env.AUTH_GITHUB_ID;
	if (!value) throw new Error("AUTH_GITHUB_ID is not set.");
	return value;
}

function clientSecret(): string {
	const value = process.env.AUTH_GITHUB_SECRET;
	if (!value) throw new Error("AUTH_GITHUB_SECRET is not set.");
	return value;
}

/**
 * Where to send the visitor to authorise.
 *
 * `scope` matches what Auth.js's GitHub provider asks for, so both flows produce
 * accounts with the same permissions and a user who has authorised once is not
 * prompted again by the other route.
 */
export function authorizeUrl(state: string, redirectUri: string): string {
	const url = new URL(AUTHORIZE);
	url.searchParams.set("client_id", clientId());
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("scope", "read:user user:email");
	url.searchParams.set("state", state);
	return url.toString();
}

/**
 * Trade a code for an access token.
 *
 * `redirect_uri` is sent again because GitHub checks it matches the one that
 * started the flow -- omitting it is the classic cause of a `redirect_uri_mismatch`
 * at exchange time rather than at authorise time, which is confusing to debug.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
	const response = await fetch(TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			client_id: clientId(),
			client_secret: clientSecret(),
			code,
			redirect_uri: redirectUri,
		}),
	});
	if (!response.ok) return null;

	// GitHub answers 200 with `{error: "bad_verification_code"}` for a spent or
	// forged code, so the status alone is not the check.
	const body = (await response.json()) as { access_token?: string; error?: string };
	return body.access_token ?? null;
}

/**
 * The profile, with the same email fallback Auth.js performs.
 *
 * A GitHub account can have no PUBLIC email, in which case `/user` returns null for
 * it and the address has to come from `/user/emails`. Without this, a user whose
 * email is private arrives with none -- which is exactly the case `users.email` was
 * made nullable for, and the reason the fallback is worth copying rather than
 * assuming the first call is enough.
 */
export async function fetchProfile(accessToken: string): Promise<GitHubProfile | null> {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		Accept: "application/vnd.github+json",
		"User-Agent": "kinfolk",
	};

	const response = await fetch(`${API}/user`, { headers });
	if (!response.ok) return null;
	const user = (await response.json()) as {
		id?: number;
		login?: string;
		name?: string | null;
		email?: string | null;
		avatar_url?: string | null;
	};
	if (!user.id || !user.login) return null;

	let email = user.email ?? null;
	if (!email) {
		const emails = await fetch(`${API}/user/emails`, { headers });
		if (emails.ok) {
			const list = (await emails.json()) as {
				email: string;
				primary: boolean;
				verified: boolean;
			}[];
			// Primary and verified first. An unverified address is somebody's claim
			// rather than a proven identity, and this one is used to match invites.
			const best = list.find((e) => e.primary && e.verified) ?? list.find((e) => e.verified);
			email = best?.email ?? null;
		}
	}

	return {
		providerAccountId: String(user.id),
		login: user.login,
		name: user.name ?? null,
		email,
		avatarUrl: user.avatar_url ?? null,
	};
}
