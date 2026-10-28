import { describe, expect, it } from "vitest";
import { buildDemoView } from "@/lib/tree/demo";
import { type FlowEdge, toFlowGraph } from "@/lib/tree/graph";
import { type Lod, layoutGraph, NODE_METRICS, type PositionedNode } from "@/lib/tree/layout";
import { graph, person, union } from "./fixtures";

const detailLevels: Lod[] = ["full", "compact", "dot"];

function disconnectedFamily() {
	return toFlowGraph(
		graph(
			[
				person("alex"),
				person("morgan"),
				person("casey"),
				person("jordan"),
				person("taylor"),
				person("alex-other"),
				person("robin"),
			],
			[
				union("parents", "alex", "morgan", ["casey"]),
				union("other-couple", "alex-other", "robin"),
				union("grandparent", "taylor", null, ["alex"]),
			],
		),
	);
}

function overlaps(a: PositionedNode, b: PositionedNode): boolean {
	return (
		a.position.x < b.position.x + b.width &&
		a.position.x + a.width > b.position.x &&
		a.position.y < b.position.y + b.height &&
		a.position.y + a.height > b.position.y
	);
}

function personCollisions(nodes: PositionedNode[]): string[][] {
	const people = nodes.filter((node) => node.type === "person");
	return people.flatMap((a, index) =>
		people
			.slice(index + 1)
			.filter((b) => overlaps(a, b))
			.map((b) => [a.id, b.id]),
	);
}

function junctionCollisions(nodes: PositionedNode[]): string[][] {
	const people = nodes.filter((node) => node.type === "person");
	return nodes
		.filter((node) => node.type === "union")
		.flatMap((junction) =>
			people.filter((p) => overlaps(junction, p)).map((p) => [junction.id, p.id]),
		);
}

describe("layered layout", () => {
	it.each(detailLevels)(
		"keeps an isolated person clear of a disconnected childless couple at %s detail",
		async (lod) => {
			const family = disconnectedFamily();
			const { nodes } = await layoutGraph(family.nodes, family.edges, lod);
			const node = (id: string) => {
				const found = nodes.find((candidate) => candidate.id === id);
				if (!found) throw new Error(`Missing synthetic node: ${id}`);
				return found;
			};

			expect(personCollisions(nodes)).toEqual([]);
			expect(junctionCollisions(nodes)).toEqual([]);
			expect(node("alex").position.y).toBe(node("morgan").position.y);
			expect(node("alex-other").position.y).toBe(node("robin").position.y);
			const partners = [node("alex"), node("morgan")];
			const junction = node("union:parents");
			expect(junction.position.y + junction.height / 2).toBe(
				node("alex").position.y + NODE_METRICS[lod].height / 2,
			);
			expect(junction.position.x).toBeGreaterThanOrEqual(
				Math.min(...partners.map((partner) => partner.position.x + partner.width)),
			);
			expect(junction.position.x + junction.width).toBeLessThanOrEqual(
				Math.max(...partners.map((partner) => partner.position.x)),
			);
			expect(node("taylor").position.y + NODE_METRICS[lod].height).toBeLessThan(
				node("alex").position.y,
			);
			expect(node("alex").position.y + NODE_METRICS[lod].height).toBeLessThan(
				node("casey").position.y,
			);
			for (const member of nodes.filter((candidate) => candidate.type === "person")) {
				expect(member).toMatchObject({
					width: NODE_METRICS[lod].width,
					height: NODE_METRICS[lod].height,
				});
			}
		},
	);

	it("anchors a friend without moving the family skeleton", async () => {
		const family = disconnectedFamily();
		const friendship: FlowEdge = {
			id: "friendship",
			source: "jordan",
			target: "casey",
			kind: "relation",
			layout: false,
		};
		const without = await layoutGraph(family.nodes, family.edges);
		const withFriend = await layoutGraph(family.nodes, [...family.edges, friendship]);
		expect(withFriend.nodes.filter((node) => node.id !== "jordan")).toEqual(
			without.nodes.filter((node) => node.id !== "jordan"),
		);
		expect(withFriend.nodes.find((node) => node.id === "jordan")?.position.y).toBe(
			withFriend.nodes.find((node) => node.id === "casey")?.position.y,
		);
		expect(personCollisions(withFriend.nodes)).toEqual([]);
		expect(junctionCollisions(withFriend.nodes)).toEqual([]);
	});

	it.each(detailLevels)("preserves collision-free sample geometry at %s detail", async (lod) => {
		const sample = buildDemoView();
		const { nodes } = await layoutGraph(sample.nodes, sample.edges, lod);
		expect(nodes).toHaveLength(256);
		expect(nodes.filter((node) => node.type === "person")).toHaveLength(216);
		expect(nodes.filter((node) => node.type === "union")).toHaveLength(40);
		expect(personCollisions(nodes)).toEqual([]);
		expect(junctionCollisions(nodes)).toEqual([]);
	});

	it.each(detailLevels)(
		"gives every family's line in a gap its own lane, clear of the cards, at %s detail",
		async (lod) => {
			for (const combined of [true, false]) {
				const sample = buildDemoView({ combined });
				const { nodes, bars } = await layoutGraph(sample.nodes, sample.edges, lod);
				const box = new Map(nodes.map((node) => [node.id, node]));
				const centre = (node: PositionedNode) => node.position.x + node.width / 2;
				const people = nodes.filter((node) => node.type === "person");
				// The whole run at a bar's y: the bracket plus the stems from the junction.
				const runs = [...bars.values()].map((bar) => {
					const dot = box.get(bar.unionNodeId);
					const junction = dot ? centre(dot) : bar.left;
					return {
						family: bar.unionNodeId,
						y: bar.y,
						from: Math.min(bar.left, junction),
						to: Math.max(bar.right, junction),
					};
				});
				const shared = runs.flatMap((a, index) =>
					runs
						.slice(index + 1)
						.filter(
							(b) =>
								a.family !== b.family &&
								Math.abs(a.y - b.y) < 1 &&
								Math.min(a.to, b.to) - Math.max(a.from, b.from) > 1,
						)
						.map((b) => [a.family, b.family]),
				);
				expect(shared).toEqual([]);

				// Every couple stands side by side: no junction routed below both partners, which
				// is what Victoria Melita's three marriages were before the chain order.
				const routed = nodes.filter((node) => {
					if (node.type !== "union") return false;
					const partners = sample.edges
						.filter((edge) => edge.kind === "partner" && edge.target === node.id)
						.flatMap((edge) => box.get(edge.source) ?? []);
					const y = node.position.y + node.height / 2;
					return partners.length === 2 && partners.every((p) => y > p.position.y + p.height);
				});
				expect(routed.map((node) => node.id)).toEqual([]);

				const clearance = NODE_METRICS[lod].rowGap / 3;
				for (const run of runs) {
					const above = Math.max(
						...people.map((p) => p.position.y + p.height).filter((bottom) => bottom <= run.y),
					);
					const below = Math.min(...people.map((p) => p.position.y).filter((top) => top >= run.y));
					expect(run.y - above).toBeGreaterThanOrEqual(clearance - 0.01);
					expect(below - run.y).toBeGreaterThanOrEqual(clearance - 0.01);
				}
			}
		},
	);
});
