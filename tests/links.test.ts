import { describe, expect, it } from "vitest";
import { proposalStatusEnum } from "@/lib/db/schema";
import {
	isLinkDecision,
	LINK_STATUS_AFTER,
	type LinkStatus,
	linkDecisions,
	REPROPOSABLE,
} from "@/lib/tree/links";

const nobody = { decides: false, proposed: false };

describe("link proposal lifecycle", () => {
	it("names every status the database stores", () => {
		const statuses: LinkStatus[] = ["pending", "accepted", "rejected", "revoked"];
		expect([...proposalStatusEnum.enumValues].sort()).toEqual([...statuses].sort());
	});

	it("lets only the missing side's owner decide a pending proposal", () => {
		expect(linkDecisions("pending", { decides: true, proposed: false })).toEqual([
			"accept",
			"reject",
		]);
		expect(linkDecisions("pending", nobody)).toEqual([]);
	});

	it("lets the proposer withdraw a pending proposal, and an owner of both sides do either", () => {
		expect(linkDecisions("pending", { decides: false, proposed: true })).toEqual(["revoke"]);
		expect(linkDecisions("pending", { decides: true, proposed: true })).toEqual([
			"accept",
			"reject",
			"revoke",
		]);
	});

	it("lets either owner unlink an accepted link, and nobody act on a closed one", () => {
		expect(linkDecisions("accepted", nobody)).toEqual(["revoke"]);
		expect(linkDecisions("rejected", { decides: true, proposed: true })).toEqual([]);
		expect(linkDecisions("revoked", { decides: true, proposed: true })).toEqual([]);
	});

	it("moves each decision to its status, and only a closed link may be proposed again", () => {
		expect(LINK_STATUS_AFTER).toEqual({
			accept: "accepted",
			reject: "rejected",
			revoke: "revoked",
		});
		expect(REPROPOSABLE).toEqual(["rejected", "revoked"]);
		for (const status of REPROPOSABLE) expect(linkDecisions(status, nobody)).toEqual([]);
	});

	it("recognises a decision posted by a form", () => {
		expect(["accept", "reject", "revoke"].every(isLinkDecision)).toBe(true);
		expect(["approve", "", "constructor", "toString"].some(isLinkDecision)).toBe(false);
	});
});
