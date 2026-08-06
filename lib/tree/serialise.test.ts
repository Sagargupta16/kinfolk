import { describe, expect, it } from "vitest";
import { buildDemoView } from "./demo";
import { parseTreeView, serialiseTreeView } from "./serialise";

describe("serialiseTreeView", () => {
	it("survives a real JSON round trip with kinship intact", () => {
		const view = buildDemoView({ combined: true, showRelations: true });
		// Through actual JSON, not just the two functions: the whole point is that
		// stringify is what destroys a Map, so a test that skips it proves nothing.
		const back = parseTreeView(JSON.parse(JSON.stringify(serialiseTreeView(view))));

		expect(back.kinship.size).toBe(view.kinship.size);
		expect(back.kinship.size).toBeGreaterThan(0);
		for (const [id, kin] of view.kinship) {
			expect(back.kinship.get(id)).toEqual(kin);
		}
	});

	it("shows why the raw view cannot be sent as-is", () => {
		const view = buildDemoView({ combined: true, showRelations: true });
		expect(view.kinship.size).toBeGreaterThan(0);

		// The landmine, pinned: a Map stringifies to an empty object rather than
		// throwing, so nothing announces the loss. If a future change makes the
		// naive path work, this failing test is the signal to simplify.
		const naive = JSON.parse(JSON.stringify(view));
		expect(naive.kinship).toEqual({});
	});

	it("keeps edges, stats and the fields a card renders", () => {
		const view = buildDemoView({ combined: true, showRelations: true });
		const back = parseTreeView(JSON.parse(JSON.stringify(serialiseTreeView(view))));

		expect(back.edges).toEqual(view.edges);
		expect(back.stats).toEqual(view.stats);
		expect(back.selfId).toBe(view.selfId);
		expect(back.isDemo).toBe(view.isDemo);
		expect(back.nodes).toHaveLength(view.nodes.length);

		// Identity and kind for every node, rather than the whole object: the two
		// timestamps loosen to strings across JSON (see below) and nothing renders
		// them, so asserting deep equality would fail for a reason that does not
		// matter and hide the ones that do. Positions are not checked because a
		// `FlowNode` has none -- ELK assigns them after this boundary.
		expect(back.nodes.map((n) => n.id)).toEqual(view.nodes.map((n) => n.id));
		expect(back.nodes.map((n) => n.type)).toEqual(view.nodes.map((n) => n.type));
	});

	it("loosens the two Date columns to strings, which is why cards must not parse them", () => {
		const view = buildDemoView({ combined: true, showRelations: true });
		const person = view.nodes.find((n) => n.type === "person");
		if (person?.type !== "person") throw new Error("no person node in the sample tree");
		const before = person.data.primary;
		expect(before.createdAt).toBeInstanceOf(Date);

		const back = parseTreeView(JSON.parse(JSON.stringify(serialiseTreeView(view))));
		const backPerson = back.nodes.find((n) => n.type === "person");
		if (backPerson?.type !== "person") throw new Error("person node lost in the round trip");
		const after = backPerson.data.primary;

		// A Date in, a string out. Harmless while nothing calls a date method on it;
		// this test is here so that stops being an accident. `birthDate` is typed
		// `string` and read with slice, so the dates a card SHOWS are unaffected.
		expect(typeof after.createdAt).toBe("string");
		expect(after.birthDate).toBe(before.birthDate);
	});

	it("tolerates a payload with no kinship field", () => {
		// An older deployment's response. Unlabelled cards beat a thrown error.
		const back = parseTreeView({ kinship: undefined } as never);
		expect(back.kinship.size).toBe(0);
	});
});
