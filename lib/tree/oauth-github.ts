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
 * How long any one GitHub call may take. A stalled response would otherwise hold the
 * callback open until the platform's function limit, with the visitor watching a
 * spinner the whole time.
 */
const GITHUB_TIMEOUT_MS = 10_000;

/**
 * A code traded for a token, or why GitHub refused.
 *
 * The reason is GitHub's own error code (or `http_<status>`), because the three ways
 * this fails need three different answers: a spent code is the visitor's to retry, a
 * rejected client secret or redirect is ours to fix, and an outage is nobody's. When
 * every refusal was `null`, a rotated secret broke every sign-in while telling each
 * visitor their code was bad, and left nothing in the logs.
 */
type CodeExchange = { ok: true; accessToken: string } | { ok: false; reason: string };

/** A spent, forged or expired code: the one refusal a fresh sign-in fixes. */
export const SPENT_CODE = "bad_verification_code";

/**
 * Trade a code for an access token.
 *
 * `redirect_uri` is sent again because GitHub checks it matches the one that
 * started the flow -- omitting it is the classic cause of a `redirect_uri_mismatch`
 * at exchange time rather than at authorise time, which is confusing to debug.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<CodeExchange> {
	const response = await fetch(TOKEN, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			client_id: clientId(),
			client_secret: clientSecret(),
			code,
			redirect_uri: redirectUri,
		}),
		signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
	});
	if (!response.ok) return { ok: false, reason: `http_${response.status}` };

	// GitHub answers 200 with `{error: "bad_verification_code"}` for a spent or
	// forged code, so the status alone is not the check.
	const body = (await response.json()) as { access_token?: string; error?: string };
	if (body.access_token) return { ok: true, accessToken: body.access_token };
	// Only a bare error code is kept: it is logged, and a free-form string from
	// upstream has no business in a log line.
	const reason =
		typeof body.error === "string" && /^[a-z_]{1,64}$/.test(body.error) ? body.error : "no_token";
	return { ok: false, reason };
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
	const response = await fetch(`${API}/user`, {
		headers: githubHeaders(accessToken),
		signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
	});
	if (!response.ok) return null;
	const user = (await response.json()) as {
		id?: number;
		login?: string;
		name?: string | null;
		email?: string | null;
		avatar_url?: string | null;
	};
	if (!user.id || !user.login) return null;

	return {
		providerAccountId: String(user.id),
		login: user.login,
		name: user.name ?? null,
		// A public profile email is always one GitHub has verified, so only its absence
		// needs the fallback.
		email: user.email ?? (await verifiedEmail(accessToken)),
		avatarUrl: user.avatar_url ?? null,
	};
}

function githubHeaders(accessToken: string): Record<string, string> {
	return {
		Authorization: `Bearer ${accessToken}`,
		Accept: "application/vnd.github+json",
		"User-Agent": "kinfolk",
	};
}

/**
 * The account's best VERIFIED address: primary first, then any verified one.
 *
 * An unverified address is somebody's claim rather than a proven identity, and this one
 * is used to match invites. Auth.js's own GitHub provider takes the primary or the first
 * address without asking, so auth.ts uses this for the server-rendered sign-in too.
 */
async function verifiedEmail(accessToken: string): Promise<string | null> {
	const response = await fetch(`${API}/user/emails`, {
		headers: githubHeaders(accessToken),
		signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
	});
	if (!response.ok) return null;
	const list = (await response.json()) as { email: string; primary: boolean; verified: boolean }[];
	const best = list.find((e) => e.primary && e.verified) ?? list.find((e) => e.verified);
	return best?.email ?? null;
}

/**
 * The raw `/user` profile Auth.js maps into a user, with the address chosen by
 * `verifiedEmail` rather than by Auth.js's unverified pick.
 */
export async function githubUserinfo(accessToken: string): Promise<Record<string, unknown>> {
	const response = await fetch(`${API}/user`, {
		headers: githubHeaders(accessToken),
		signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`GitHub /user answered ${response.status}`);
	const profile = (await response.json()) as Record<string, unknown>;
	if (!profile.email) profile.email = await verifiedEmail(accessToken);
	return profile;
}
