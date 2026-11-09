type LinkCandidate = {
	id: string;
	name: string;
	treeId: string;
	treeName: string;
	owned: boolean;
};

/** A record link's lifecycle, as `person_links.status` stores it. */
export type LinkStatus = "pending" | "accepted" | "rejected" | "revoked";

/** What an owner can do to a link. `revoke` withdraws a pending proposal or unlinks an accepted one. */
export type LinkDecision = "accept" | "reject" | "revoke";

/** The status each decision moves a link to. */
export const LINK_STATUS_AFTER: Record<LinkDecision, LinkStatus> = {
	accept: "accepted",
	reject: "rejected",
	revoke: "revoked",
};

/** The statuses a fresh proposal may replace: a refused or ended link can be proposed again. */
export const REPROPOSABLE: readonly LinkStatus[] = ["rejected", "revoked"];

/** Whether a posted value names a decision. `hasOwn`, so "constructor" is not one. */
export function isLinkDecision(value: string): value is LinkDecision {
	return Object.hasOwn(LINK_STATUS_AFTER, value);
}

/**
 * The decisions one person may make on one link: the ONE table of the lifecycle.
 *
 *   pending  -- accept, reject: the owner whose consent is still missing (`decides`)
 *            -- revoke:         the proposer, withdrawing it
 *   accepted -- revoke:         either owner, unlinking (only owners reach a link at all)
 *   rejected, revoked: closed; a fresh proposal replaces them (`REPROPOSABLE`)
 *
 * It used to be written twice, once for the panel's buttons in `linkState` and once for the
 * checks in `decideLink`, with nothing keeping the two the same -- so a change to who may
 * withdraw a proposal could leave the panel offering a button the server then refused.
 */
export function linkDecisions(
	status: LinkStatus,
	actor: { decides: boolean; proposed: boolean },
): LinkDecision[] {
	switch (status) {
		case "pending": {
			const open: LinkDecision[] = actor.decides ? ["accept", "reject"] : [];
			if (actor.proposed) open.push("revoke");
			return open;
		}
		case "accepted":
			return ["revoke"];
		case "rejected":
		case "revoked":
			return [];
	}
}

export type LinkState = {
	candidates: LinkCandidate[];
	proposals: {
		id: string;
		a: string;
		b: string;
		note: string | null;
		status: LinkStatus;
		canDecide: boolean;
		canRevoke: boolean;
	}[];
};
