import { describe, expect, it } from "vitest";
import { buildDemoView } from "@/lib/tree/demo";
import { fuseTrees, toFlowGraph } from "@/lib/tree/graph";
import { type FamilyShape, planKin } from "@/lib/tree/kin-plan";
import { kinshipMap } from "@/lib/tree/kinship";
import { parentageLabel } from "@/lib/tree/parentage";
import { indexRelatives, relativesOf } from "@/lib/tree/relatives";
import { graph, person, slice, union } from "./fixtures";

describe("unambiguous quick-add", () => {
	const first = union("first", "self", "partner-a", ["child-a"]);
	const second = union("second", "self", "partner-b", ["child-b"]);
	const family: FamilyShape = { subjectId: "self", parentUnions: [], ownUnions: [first, second] };

	it("requires a family choice after remarriage and attaches only to that choice", () => {
		expect(planKin(family, "child").refusal).toContain("Choose which family");
		expect(planKin(family, "child", 2, "second")).toMatchObject({
			create: { count: 2, sex: "unknown" },
			union: { kind: "existing", unionId: "second" },
			attach: "child",
			attachSubjectAsChild: false,
		});
		expect(planKin(family, "child", 1, "not-this-family").refusal).toBeTruthy();
	});

	it("does not silently choose a birth or adoptive family for a sibling", () => {
		const child = { subjectId: "child", parentUnions: [first, second], ownUnions: [] };
		expect(planKin(child, "sibling").refusal).toBeTruthy();
		expect(planKin(child, "sibling", 1, "first").union).toEqual({
			kind: "existing",
			unionId: "first",
		});
	});

	it("fills the only available parent slot and refuses ambiguous slots", () => {
		const open = union("open", "parent", null, ["self"]);
		const full = union("full", "a", "b", ["self"]);
		const child = { subjectId: "self", parentUnions: [full, open], ownUnions: [] };
		expect(planKin(child, "mother").union).toEqual({ kind: "existing", unionId: "open" });
		expect(
			planKin({ ...child, parentUnions: [open, union("other", null, "b", ["self"])] }, "father")
				.refusal,
		).toBeTruthy();
	});
});

describe("recorded parent roles", () => {
	it("distinguishes a partner's child from the partner of a child", () => {
		const family = graph(
			[
				person("self"),
				person("partner"),
				person("their-child"),
				person("own-child"),
				person("child-partner"),
			],
			[
				union("couple", "self", "partner", []),
				union("theirs", "partner", null, ["their-child"], {
					childRoles: { "their-child": ["adoptive"] },
				}),
				union("mine", "self", null, ["own-child"]),
				union("child-couple", "own-child", "child-partner", []),
			],
		);
		const labels = kinshipMap(family, "self");
		expect(labels.get("their-child")?.label).toBe("partner's child");
		expect(labels.get("child-partner")?.label).toBe("child-in-law");
	});

	it("does not call a parent's new partner a parent-in-law", () => {
		const family = graph(
			[person("self"), person("parent"), person("new-partner")],
			[
				union("parents", "parent", null, ["self"]),
				union("new-couple", "parent", "new-partner", []),
			],
		);
		expect(kinshipMap(family, "self").get("new-partner")?.label).toBe("parent's partner");
	});

	it.each([
		["adoptive", "adoptive mother"],
		["step", "stepmother"],
		["foster", "foster mother"],
		["guardian", "guardian"],
	] as const)("labels a %s parent without declaring a blood relationship", (role, label) => {
		const people = [person("parent", { sex: "female" }), person("child")];
		const family = graph(people, [
			union("family", "parent", null, ["child"], { childRoles: { child: [role] } }),
		]);
		expect(kinshipMap(family, "child").get("parent")).toEqual({ label, via: "family" });
		const projected = toFlowGraph(family);
		expect(
			relativesOf(indexRelatives(projected.nodes, projected.edges), "child").parentRoles.parent,
		).toEqual([role]);
	});

	it("keeps an adoptive grandparent on the family path", () => {
		const family = graph(
			[person("grandmother", { sex: "female" }), person("parent"), person("child")],
			[
				union("grandparents", "grandmother", null, ["parent"]),
				union("parents", "parent", null, ["child"], { childRoles: { child: ["adoptive"] } }),
			],
		);
		expect(kinshipMap(family, "child").get("grandmother")).toMatchObject({ via: "family" });
	});

	it("preserves differing role claims when two family records fuse", () => {
		const own = slice(
			[person("parent"), person("child")],
			[union("own", "parent", null, ["child"], { childRoles: { child: ["adoptive"] } })],
		);
		const other = {
			...slice(
				[person("p2", { treeId: "other" }), person("c2", { treeId: "other" })],
				[
					union("their", "p2", null, ["c2"], {
						treeId: "other",
						childRoles: { c2: ["biological"] },
					}),
				],
			),
			treeId: "other",
		};
		const fused = fuseTrees(
			[own, other],
			[
				{ personAId: "parent", personBId: "p2" },
				{ personAId: "child", personBId: "c2" },
			],
		);
		const childId = fused.idMap.get("child") ?? "";
		expect(fused.unions).toHaveLength(1);
		expect(fused.unions[0]?.childRoles?.[childId]).toEqual(
			expect.arrayContaining(["adoptive", "biological"]),
		);
		expect(parentageLabel(["adoptive", "biological"], "unknown", "parent")).toBe(
			"adoptive parent / parent",
		);
	});

	it("preserves the existing sample graph structure", () => {
		const view = buildDemoView();
		expect(view.stats.people).toBe(117);
		expect(view.nodes.filter((node) => node.type === "union")).toHaveLength(34);
		const ids = new Set(view.nodes.map((node) => node.id));
		expect(view.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
	});
});
