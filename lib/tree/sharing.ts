/**
 * Who can see a graph, as the Family access panel reads it.
 *
 * Shared by `share-actions.ts` and the SPA's shim for the same reason as `result.ts`:
 * one shape, checked on both sides of the HTTP boundary.
 */
export type ShareState = {
	/**
	 * Whether this viewer may invite, withdraw an invite or remove somebody.
	 *
	 * Only the owner. An editor shapes the family's records, but who sees them is the
	 * owner's decision: an editor who could invite would route around it, and one who
	 * could remove members could lock out a co-editor the owner chose.
	 */
	canManage: boolean;
	members: { userId: string; name: string; role: string; isOwner: boolean }[];
	invites: { id: string; addressedTo: string; role: string; expiresAt: string }[];
};
