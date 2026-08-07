import { describe, expect, it } from "vitest";
import { type ParentEdge, wouldCreateAncestryCycle } from "./acyclic";

const EDGES: ParentEdge[] = [
	{ parentId: "grandparent", childId: "parent" },
	{ parentId: "parent", childId: "child" },
	{ parentId: "child", childId: "grandchild" },
];

describe("wouldCreateAncestryCycle", () => {
	it("rejects making a descendant the parent of an ancestor", () => {
		expect(wouldCreateAncestryCycle(EDGES, ["grandchild"], "grandparent")).toBe(true);
	});

	it("rejects a direct self-parent edge", () => {
		expect(wouldCreateAncestryCycle(EDGES, ["child"], "child")).toBe(true);
	});

	it("allows an unrelated child", () => {
		expect(wouldCreateAncestryCycle(EDGES, ["parent"], "cousin")).toBe(false);
	});

	it("checks every partner in a union", () => {
		expect(wouldCreateAncestryCycle(EDGES, ["unrelated", "grandchild"], "parent")).toBe(true);
	});

	it("terminates when existing malformed data already contains a cycle", () => {
		const cyclic = [...EDGES, { parentId: "grandchild", childId: "parent" }];
		expect(wouldCreateAncestryCycle(cyclic, ["unrelated"], "parent")).toBe(false);
	});
});
