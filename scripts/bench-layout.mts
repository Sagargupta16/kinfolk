/**
 * Time the family layout (ELK layered plus Kinfolk's pedigree passes) on generated
 * families of increasing size, and on the bundled 117-person sample tree.
 *
 *   pnpm bench:layout             # 50, 200 and 1000 people
 *   pnpm bench:layout 100 500     # any sizes
 *
 * The generated families are synthetic and seeded, so every run lays out the same
 * graphs: a founding couple, then each couple has one to four children, and most
 * children marry someone from outside the family who brings no ancestors. That is the
 * shape real trees grow into -- wide generations, many in-laws -- and it is what makes
 * ELK's crossing minimisation work, unlike a balanced binary tree.
 *
 * Each size is laid out twice to warm up the JIT, then timed over seven runs; the
 * median is reported. This runs in Node, on the same code path the browser runs.
 */
import { performance } from "node:perf_hooks";
import { buildDemoView } from "@/lib/tree/demo";
import { toFlowGraph, type UnionWithChildren } from "@/lib/tree/graph";
import { layoutGraph } from "@/lib/tree/layout";
import { graph, person, union } from "../tests/fixtures";

const WARMUP = 2;
const RUNS = 7;

/** mulberry32: a tiny seeded PRNG, so the same size always yields the same family. */
function random(seed: number) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function family(size: number) {
	const next = random(size);
	const people = [person("p0"), person("p1")];
	const unions: UnionWithChildren[] = [];
	let couples: [string, string][] = [["p0", "p1"]];

	while (people.length < size && couples.length > 0) {
		const nextCouples: [string, string][] = [];
		for (const [a, b] of couples) {
			const children: string[] = [];
			const count = 1 + Math.floor(next() * 4);
			for (let i = 0; i < count && people.length < size; i++) {
				const child = `p${people.length}`;
				people.push(person(child));
				children.push(child);
				if (people.length < size && next() < 0.75) {
					const spouse = `p${people.length}`;
					people.push(person(spouse));
					nextCouples.push([child, spouse]);
				}
			}
			unions.push(union(`u${unions.length}`, a, b, children));
		}
		couples = nextCouples;
	}
	// Couples from the last generation still get a union node, as they would in a real tree.
	for (const [a, b] of couples) unions.push(union(`u${unions.length}`, a, b));
	return { label: `generated, ${people.length} people`, view: toFlowGraph(graph(people, unions)) };
}

async function time(view: ReturnType<typeof toFlowGraph>) {
	for (let i = 0; i < WARMUP; i++) await layoutGraph(view.nodes, view.edges);
	const samples: number[] = [];
	for (let i = 0; i < RUNS; i++) {
		const start = performance.now();
		await layoutGraph(view.nodes, view.edges);
		samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	return { median: samples[Math.floor(RUNS / 2)] ?? 0, min: samples[0] ?? 0 };
}

const sizes = process.argv
	.slice(2)
	.map(Number)
	.filter((n) => Number.isInteger(n) && n >= 2);
const cases = [
	{ label: "sample tree, 117 people", view: buildDemoView() },
	...(sizes.length ? sizes : [50, 200, 1000]).map(family),
];

console.log(
	`Node ${process.version}, ${process.platform}/${process.arch}, median of ${RUNS} runs\n`,
);
console.log("| Graph | Nodes (people + unions) | Layout edges | Median | Fastest |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const { label, view } of cases) {
	const { median, min } = await time(view);
	const layoutEdges = view.edges.filter((edge) => edge.layout).length;
	console.log(
		`| ${label} | ${view.nodes.length} | ${layoutEdges} | ${median.toFixed(0)} ms | ${min.toFixed(0)} ms |`,
	);
}
