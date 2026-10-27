import { describe, expect, it } from "vitest";
import { buildDemoView } from "@/lib/tree/demo";
import { fuseTrees, toFlowGraph } from "@/lib/tree/graph";
import { splitName } from "@/lib/tree/kin-plan";
import { NODE_METRICS, pedigreeOrder } from "@/lib/tree/layout";
import { addSlots, FOLD_AT, FOLD_PILL_HALF, hitBox, nodeAffordances } from "@/lib/tree/node-add";
import { buildPersonPatch } from "@/lib/tree/person-patch";
import { person, slice, union } from "./fixtures";

const names = (ids: string[]) =>
	new Map(ids.map((id) => [id, { name: id, sex: "unknown" as const }]));

describe("model order", () => {
	it("is a permutation of the input, with siblings eldest first", () => {
		const graph = toFlowGraph(
			fuseTrees(
				[
					slice(
						[
							person("mother"),
							person("young", { birthDateApprox: "1990" }),
							person("old", { birthDateApprox: "1980" }),
							person("unknown-year"),
							person("bare-a"),
							person("bare-b"),
							person("adopted"),
							person("other-parent"),
						],
						[
							union("family", "mother", null, ["young", "unknown-year", "old", "adopted"]),
							// A sibling junction with no recorded partners, which no person walk reaches.
							union("bare", null, null, ["bare-a", "bare-b"]),
							// A second parent union for one child, which must not duplicate them.
							union("adoptive", "other-parent", null, ["adopted"]),
						],
					),
				],
				[],
				"owned",
			),
		);
		const ordered = pedigreeOrder(graph.nodes, graph.edges);
		expect(ordered).toHaveLength(graph.nodes.length);
		expect(new Set(ordered.map((node) => node.id)).size).toBe(graph.nodes.length);
		const at = (id: string) => ordered.findIndex((node) => node.id === id);
		expect(at("old")).toBeLessThan(at("young"));
		expect(at("young")).toBeLessThan(at("unknown-year"));
	});

	it("keeps every sample node", () => {
		const sample = buildDemoView();
		const ordered = pedigreeOrder(sample.nodes, sample.edges);
		expect(new Set(ordered.map((node) => node.id))).toEqual(
			new Set(sample.nodes.map((node) => node.id)),
		);
	});
});

describe("node affordances", () => {
	it("asks which family when two parent families have room, and labels them apart", () => {
		const affordances = nodeAffordances({
			subjectId: "child",
			subjectName: "child",
			subjectSex: "female",
			unions: [
				union("birth", "pat", null, ["child"]),
				union("adoptive", "kim", null, ["child"], { childRoles: { child: ["adoptive"] } }),
			],
			people: names(["child", "pat", "kim"]),
		});
		expect(affordances.parent?.unionId).toBeUndefined();
		const labels = affordances.parent?.choices?.map((choice) => choice.label) ?? [];
		expect(labels).toEqual(["pat", "kim (adoptive)"]);
	});

	it("labels two single-parent families by their children rather than repeating the parent", () => {
		const affordances = nodeAffordances({
			subjectId: "alex",
			subjectName: "alex",
			subjectSex: "male",
			unions: [union("one", "alex", null, ["casey"]), union("two", "alex", null, ["jordan"])],
			people: names(["alex", "casey", "jordan"]),
		});
		expect(affordances.child?.choices?.map((choice) => choice.label)).toEqual([
			"With casey",
			"With jordan",
		]);
	});

	it("numbers families that would otherwise read the same", () => {
		const affordances = nodeAffordances({
			subjectId: "child",
			subjectName: "child",
			subjectSex: "male",
			unions: [
				union("one", "unknown-a", null, ["child"]),
				union("two", "unknown-b", null, ["child"]),
			],
			people: new Map([
				["child", { name: "child", sex: "male" as const }],
				["unknown-a", { name: "Unknown", sex: "unknown" as const }],
				["unknown-b", { name: "Unknown", sex: "unknown" as const }],
			]),
		});
		const labels = affordances.parent?.choices?.map((choice) => choice.label) ?? [];
		expect(new Set(labels).size).toBe(2);
		expect(labels).toEqual(["Unknown (1 of 2)", "Unknown (2 of 2)"]);
	});

	it("keeps the single-parent `+` beside a couple's shared one", () => {
		const affordances = nodeAffordances({
			subjectId: "alex",
			subjectName: "alex",
			subjectSex: "male",
			unions: [union("married", "alex", "morgan", []), union("alone", "alex", null, ["casey"])],
			people: names(["alex", "morgan", "casey"]),
		});
		expect(affordances.couples.map((couple) => couple.unionId)).toEqual(["married"]);
		expect(affordances.child?.unionId).toBe("alone");
	});

	it("offers no parent once both are recorded", () => {
		const affordances = nodeAffordances({
			subjectId: "child",
			subjectName: "child",
			subjectSex: "male",
			unions: [union("parents", "pat", "lee", ["child"])],
			people: names(["child", "pat", "lee"]),
		});
		expect(affordances.parent).toBeNull();
	});
});

describe("handle placement", () => {
	const card = { x: 0, y: 0, width: 168, height: 92 };
	const affordances = nodeAffordances({
		subjectId: "alex",
		subjectName: "alex",
		subjectSex: "male",
		unions: [],
		people: names(["alex"]),
	});
	const place = (free: { left: number; right: number }) =>
		addSlots(affordances, card, {
			boxOf: () => undefined,
			junctionOf: () => undefined,
			free,
			reach: 50,
			rowGap: 72,
		});

	it("keeps a partner `+` off a card sitting in the partner gutter", () => {
		const slots = place({ left: 200, right: 22 });
		expect(slots.find((slot) => slot.kind === "partner")?.side).toBe("left");
		expect(place({ left: 22, right: 22 }).some((slot) => slot.kind === "partner")).toBe(false);
	});

	it("never lets a target cross the generation gap or cover a fold pill", () => {
		for (const lod of ["full", "compact"] as const) {
			const metrics = NODE_METRICS[lod];
			const bounds = { ...metrics, reach: 50 };
			for (const zoom of [0.15, 0.3, 0.45, 0.55, 1]) {
				const parent = hitBox({ kind: "parent", x: 84, y: 0 }, bounds, zoom);
				const child = hitBox({ kind: "child", x: 84, y: metrics.height }, bounds, zoom);
				expect(-parent.top).toBeLessThanOrEqual(metrics.rowGap - 4);
				expect(child.top + child.height - metrics.height).toBeLessThanOrEqual(metrics.rowGap - 4);
				const pillRight = FOLD_AT * metrics.width + FOLD_PILL_HALF;
				expect(parent.left).toBeGreaterThanOrEqual(pillRight - 0.001);

				// A couple's target stops short of the right-hand partner's pill.
				const gutter = { left: metrics.width, right: metrics.width + 22 };
				const couple = hitBox(
					{ kind: "couple", x: metrics.width + 11, y: metrics.height, gutter },
					bounds,
					zoom,
				);
				expect(couple.left + couple.width).toBeLessThanOrEqual(
					gutter.right + FOLD_AT * metrics.width - FOLD_PILL_HALF + 0.001,
				);
			}
		}
	});
});

describe("one name field", () => {
	it("splits on the last word and keeps a single word as a given name", () => {
		expect(splitName("  Rakesh   Kumar Gupta ")).toEqual({
			givenName: "Rakesh Kumar",
			familyName: "Gupta",
		});
		expect(splitName("Mini")).toEqual({ givenName: "Mini", familyName: null });
		expect(splitName("   ")).toEqual({ givenName: null, familyName: null });
	});

	it("patches both name columns from `name` and refuses to erase a name", () => {
		const form = new FormData();
		form.set("givenName", "Old");
		form.set("name", "Samuel Rivera");
		expect(buildPersonPatch(form)).toEqual({
			ok: true,
			patch: { givenName: "Samuel", familyName: "Rivera" },
		});
		const blank = new FormData();
		blank.set("name", "  ");
		expect(buildPersonPatch(blank)).toMatchObject({ ok: false });
	});
});
