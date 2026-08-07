export type InviteRole = "viewer" | "editor";

/** Only roles that may be granted through an invite. */
export function parseInviteRole(value: unknown): InviteRole | null {
	if (value === null || value === undefined) return "viewer";
	return value === "viewer" || value === "editor" ? value : null;
}

/** GitHub logins are case-insensitive and are stored without a leading @. */
export function normalizeGitHubLogin(value: string | null | undefined): string | null {
	const login = value?.trim().replace(/^@/, "").toLowerCase() ?? "";
	return login || null;
}
