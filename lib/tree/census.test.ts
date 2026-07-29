/**
 * The census exists so the legend never explains a mark that is not on screen. Every
 * test here is a version of that one property: a count of zero must mean "this tree
 * does not use that encoding", never "we forgot to look".
 */
import { describe, expect, it } from "vitest";
import type { ContactDetail, RelationKind, Verification } from "../db/schema";
import { censusOf } from "./census";
import { degrees } from "./density";
import type { FlowEdge, FlowNode, FusedPerson } from "./graph";
import { visibleEdges } from "./graph";

function personNode(
	id: string,
	overrides: {
		living?: "living" | "deceased" | "unknown";
		verification?: Verification;
		conflicted?: boolean;
		trees?: number;
		contacts?: ContactDetail["kind"][];
	} = {},
): FlowNode {
	const trees = overrides.trees ?? 1;
	return {
		id,
		type: "person",
		data: {
			id,
			primary: { id, living: overrides.living ?? "living" },
			sources: [],
			contributingTreeIds: Array.from({ length: trees }, (_, i) => `t${i}`),
			contacts: (overrides.contacts ?? []).map((kind) => ({ kind })),
			trust: {
				level: overrides.verification ?? "unverified",
				corroborators: trees,
				conflicted: overrides.conflicted ?? false,
			},
		} as unknown as FusedPerson,
	};
}

function unionNode(id: string): FlowNode {
	return { id, type: "union", data: { union: { id } } as unknown as never };
}

function childEdge(id: string, source: string, target: string): FlowEdge {
	return { id, source, target, kind: "child", layout: true };
}

function partnerEdge(id: string, source: string, target: string): FlowEdge {
	return { id, source, target, kind: "partner", layout: true };
}

function relationEdge(
	id: string,
	source: string,
	target: string,
	kind: RelationKind,
	extra: { closeness?: 1 | 2 | 3; ended?: boolean } = {},
): FlowEdge {
	return {
		id,
		source,
		target,
		kind: "relation",
		layout: false,
		relationKind: kind,
		closeness: extra.closeness ?? 2,
		ended: extra.ended,
	};
}

describe("censusOf", () => {
	it("separates parentage from partnership", () => {
		const nodes = [personNode("mum"), personNode("dad"), unionNode("u1"), personNode("kid")];
		const c = censusOf(nodes, [
			partnerEdge("p1", "mum", "u1"),
			partnerEdge("p2", "dad", "u1"),
			childEdge("c1", "u1", "kid"),
		]);

		expect(c).toMatchObject({ partners: 2, family: 1 });
	});

	it("counts relations into their category, not their kind", () => {
		const nodes = [personNode("a"), personNode("b"), personNode("c")];
		const c = censusOf(nodes, [
			relationEdge("r1", "a", "b", "cousin"),
			relationEdge("r2", "a", "c", "in_law"),
			relationEdge("r3", "b", "c", "colleague"),
		]);

		expect(c.categories).toMatchObject({ kin: 2, professional: 1, social: 0, care: 0, other: 0 });
	});

	/** The whole reason this module exists. */
	it("leaves an unused category at zero so the legend can drop its row", () => {
		const nodes = [personNode("a"), personNode("b")];
		const c = censusOf(nodes, [relationEdge("r1", "a", "b", "friend")]);

		expect(c.categories.other).toBe(0);
		expect(c.kinds.other).toEqual([]);
		expect(c.categories.social).toBe(1);
	});

	it("lists only the kinds present, so a hint cannot name a missing one", () => {
		const nodes = [personNode("a"), personNode("b")];
		const c = censusOf(nodes, [
			relationEdge("r1", "a", "b", "friend"),
			relationEdge("r2", "b", "a", "friend"),
		]);

		// Deduped: two friendships are one kind to explain, not two.
		expect(c.kinds.social).toEqual(["friend"]);
	});

	it("counts an ended relation as history rather than as a live weight", () => {
		const nodes = [personNode("a"), personNode("b"), personNode("c")];
		const c = censusOf(nodes, [
			relationEdge("r1", "a", "b", "colleague", { closeness: 1, ended: true }),
			relationEdge("r2", "a", "c", "colleague", { closeness: 1 }),
		]);

		expect(c.ended).toBe(1);
		// Only the live edge contributes a weight: an ended one is drawn in the past
		// rhythm, so its closeness is not part of the scale the legend explains.
		expect(c.closenessLevels).toBe(1);
	});

	it("reports one closeness level when every tie shares a weight", () => {
		// The legend uses this to hide the scale row: three identical lines are not a
		// scale, and a key claiming otherwise sends a reader looking for a difference.
		const nodes = [personNode("a"), personNode("b"), personNode("c")];
		const c = censusOf(nodes, [
			relationEdge("r1", "a", "b", "friend", { closeness: 2 }),
			relationEdge("r2", "a", "c", "friend", { closeness: 2 }),
		]);

		expect(c.closenessLevels).toBe(1);
	});

	it("splits people by living status, treating unknown as its own answer", () => {
		const c = censusOf(
			[
				personNode("a", { living: "living" }),
				personNode("b", { living: "deceased" }),
				personNode("c", { living: "unknown" }),
			],
			[],
		);

		expect(c).toMatchObject({ living: 1, deceased: 1, livingUnknown: 1 });
	});

	it("counts each provenance level separately", () => {
		const c = censusOf(
			[
				personNode("a", { verification: "documented" }),
				personNode("b", { verification: "documented" }),
				personNode("c", { verification: "family_recalled" }),
			],
			[],
		);

		expect(c.provenance).toMatchObject({
			documented: 2,
			family_recalled: 1,
			self_confirmed: 0,
			unverified: 0,
		});
	});

	it("counts merged people from their contributing trees", () => {
		const c = censusOf([personNode("a", { trees: 2 }), personNode("b", { trees: 1 })], []);
		expect(c.merged).toBe(1);
	});

	it("groups contact channels the way the card draws them", () => {
		// WhatsApp shares the phone glyph; everything else shares the handle glyph.
		const c = censusOf(
			[
				personNode("a", { contacts: ["whatsapp"] }),
				personNode("b", { contacts: ["email"] }),
				personNode("c", { contacts: ["phone", "instagram"] }),
			],
			[],
		);

		expect(c).toMatchObject({ withPhone: 2, withHandle: 2 });
	});

	it("counts only people whose ring actually clears the floor", () => {
		// A hub and a leaf. The leaf's rank is under RING_MIN_RANK, so it draws no ring
		// and must not be counted -- the row would otherwise claim a mark on a card
		// that has none.
		const nodes = [
			personNode("hub"),
			personNode("a"),
			personNode("b"),
			personNode("c"),
			personNode("d"),
			personNode("e"),
		];
		const edges = [
			relationEdge("r1", "hub", "a", "friend", { closeness: 3 }),
			relationEdge("r2", "hub", "b", "friend", { closeness: 3 }),
			relationEdge("r3", "hub", "c", "friend", { closeness: 3 }),
			relationEdge("r4", "hub", "d", "friend", { closeness: 3 }),
			relationEdge("r5", "hub", "e", "friend", { closeness: 3 }),
		];

		const c = censusOf(nodes, edges, degrees(nodes, edges));
		expect(c.ringed).toBe(1);
	});

	it("ignores union dots when counting people", () => {
		const c = censusOf([personNode("a"), unionNode("u1")], []);
		expect(c.living + c.deceased + c.livingUnknown).toBe(1);
	});

	/**
	 * The overlay toggle, end to end.
	 *
	 * With social links off there are no dashed lines on the canvas, so every relation
	 * row in the legend has to disappear. Counting the PROJECTED edges instead of the
	 * drawn ones would leave the key confidently describing rhythms nobody can see --
	 * and relations are always projected, precisely so layout can place a person who
	 * has no family.
	 */
	it("reports no relations at all when the overlay is off", () => {
		const nodes = [personNode("a"), personNode("b"), unionNode("u1"), personNode("kid")];
		const edges = [
			partnerEdge("p1", "a", "u1"),
			childEdge("c1", "u1", "kid"),
			relationEdge("r1", "a", "b", "friend"),
			relationEdge("r2", "b", "kid", "caregiver", { ended: true }),
		];

		const off = censusOf(nodes, visibleEdges(edges, false));

		expect(Object.values(off.categories).every((n) => n === 0)).toBe(true);
		expect(off).toMatchObject({ ended: 0, closenessLevels: 0, partners: 1, family: 1 });

		// And the same data with the overlay on does report them, so the zero above is
		// the filter talking rather than the counter failing to look.
		const on = censusOf(nodes, visibleEdges(edges, true));
		expect(on.categories.social).toBe(1);
		expect(on.ended).toBe(1);
	});
});
