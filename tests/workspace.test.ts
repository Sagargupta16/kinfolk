import { describe, expect, it } from "vitest";
import type { AddSlot } from "@/lib/tree/node-add";
import {
	feedShown,
	initialWorkspace,
	type Strip,
	type Workspace,
	type WorkspaceEvent,
	workspace,
} from "@/lib/tree/workspace";

const slot = (key: string): AddSlot => ({
	key,
	kind: "child",
	x: 0,
	y: 0,
	label: `Add a child (${key})`,
	target: {
		subjectId: "source-a",
		subjectName: "A",
		direction: "child",
		roles: ["son", "daughter"],
	},
});
const add = (key: string): Strip => ({ kind: "add", slot: slot(key) });
const edit = (personId: string): Strip => ({ kind: "edit", personId });

const run = (events: WorkspaceEvent[], from: Workspace = initialWorkspace("a")) =>
	events.reduce(workspace, from);

describe("workspace surfaces", () => {
	it("opens on the subject with nothing open", () => {
		expect(initialWorkspace("a")).toEqual({
			viewed: "a",
			profile: null,
			feed: false,
			strip: null,
			travel: null,
		});
	});

	it("returns the same object for an event that changes nothing", () => {
		const start = initialWorkspace("a");
		for (const event of [
			{ type: "view", id: "a" },
			{ type: "closeProfile" },
			{ type: "closeFeed" },
			{ type: "closeStrip" },
			{ type: "clear" },
			{ type: "rearranged" },
			{ type: "arrived", id: "a" },
			{ type: "present", ids: new Set(["a"]) },
		] satisfies WorkspaceEvent[]) {
			expect(workspace(start, event)).toBe(start);
		}
	});

	it("closes the strip when the subject changes, and keeps the profile and the feed", () => {
		const open = run([{ type: "toggleFeed" }, { type: "openStrip", strip: add("k") }]);
		const moved = workspace({ ...open, profile: "z" }, { type: "view", id: "b" });
		expect(moved).toMatchObject({ viewed: "b", strip: null, profile: "z", feed: true });
	});

	it("never shows the strip and the profile together, whichever opens second", () => {
		expect(
			run([
				{ type: "openProfile", id: "a" },
				{ type: "openStrip", strip: edit("a") },
			]),
		).toMatchObject({ profile: null, strip: edit("a") });
		expect(
			run([
				{ type: "toggleProfile", id: "a" },
				{ type: "toggleStrip", strip: add("k") },
			]),
		).toMatchObject({ profile: null, strip: add("k") });
		expect(
			run([
				{ type: "openStrip", strip: add("k") },
				{ type: "openProfile", id: "a" },
			]),
		).toMatchObject({
			profile: "a",
			strip: null,
		});
		expect(
			run([
				{ type: "openStrip", strip: add("k") },
				{ type: "toggleProfile", id: "a" },
			]),
		).toMatchObject({ profile: "a", strip: null });
	});

	it("keeps the feed waiting under a profile or a strip, and brings it back", () => {
		const underProfile = run([{ type: "toggleFeed" }, { type: "openProfile", id: "a" }]);
		expect(underProfile.feed).toBe(true);
		expect(feedShown(underProfile)).toBe(false);
		expect(feedShown(workspace(underProfile, { type: "closeProfile" }))).toBe(true);

		const underStrip = run([{ type: "toggleFeed" }, { type: "openStrip", strip: add("k") }]);
		expect(feedShown(underStrip)).toBe(false);
		expect(feedShown(workspace(underStrip, { type: "closeStrip" }))).toBe(true);
	});

	it("shows the feed when asked, closing whatever covers it, and closes it when shown", () => {
		const covered = run([{ type: "toggleFeed" }, { type: "openProfile", id: "a" }]);
		const asked = workspace(covered, { type: "toggleFeed" });
		expect(asked).toMatchObject({ feed: true, profile: null, strip: null });
		expect(feedShown(asked)).toBe(true);
		expect(workspace(asked, { type: "toggleFeed" }).feed).toBe(false);

		const overStrip = workspace(run([{ type: "openStrip", strip: add("k") }]), {
			type: "toggleFeed",
		});
		expect(overStrip).toMatchObject({ feed: true, strip: null });
	});

	it("folds a strip back when its own control is pressed again, and swaps it for another", () => {
		const open = run([{ type: "toggleStrip", strip: add("k") }]);
		expect(workspace(open, { type: "toggleStrip", strip: add("k") }).strip).toBeNull();
		expect(workspace(open, { type: "toggleStrip", strip: add("j") }).strip).toEqual(add("j"));
		const editing = run([{ type: "toggleStrip", strip: edit("a") }]);
		expect(workspace(editing, { type: "toggleStrip", strip: edit("a") }).strip).toBeNull();
		expect(workspace(editing, { type: "openStrip", strip: edit("a") })).toBe(editing);
	});

	it("toggles a profile on the same person and moves it to another", () => {
		const open = run([{ type: "toggleProfile", id: "a" }]);
		expect(open.profile).toBe("a");
		expect(workspace(open, { type: "toggleProfile", id: "a" }).profile).toBeNull();
		expect(workspace(open, { type: "toggleProfile", id: "b" }).profile).toBe("b");
	});

	it("views the destination at once and completes a travel exactly once", () => {
		const asked = run([
			{ type: "openStrip", strip: add("k") },
			{ type: "travel", id: "b", profile: true },
		]);
		expect(asked).toMatchObject({ viewed: "b", strip: null, profile: null });
		const arrived = workspace(asked, { type: "arrived", id: "b" });
		expect(arrived).toMatchObject({ travel: null, profile: "b" });
		// The acknowledgement is the travel's end: a second report, or one for somebody else,
		// changes nothing -- the replay that reopened a closed panel cannot happen.
		const closed = workspace(arrived, { type: "closeProfile" });
		expect(workspace(closed, { type: "arrived", id: "b" })).toBe(closed);
		expect(workspace(asked, { type: "arrived", id: "c" })).toBe(asked);
	});

	it("travels to somebody without opening their profile when the request says so", () => {
		const arrived = run([
			{ type: "openProfile", id: "z" },
			{ type: "travel", id: "b", profile: false },
			{ type: "arrived", id: "b" },
		]);
		expect(arrived).toMatchObject({ viewed: "b", travel: null, profile: "z" });
	});

	it("keeps the strip when a travel lands on the person already viewed", () => {
		const open = run([{ type: "openStrip", strip: add("k") }]);
		expect(workspace(open, { type: "travel", id: "a", profile: false }).strip).toEqual(add("k"));
	});

	it("clears the transient surfaces on a canvas tap and keeps the subject and the feed", () => {
		const busy = run([{ type: "toggleFeed" }, { type: "openProfile", id: "a" }]);
		expect(workspace(busy, { type: "clear" })).toMatchObject({
			viewed: "a",
			profile: null,
			feed: true,
		});
		const stripped = run([{ type: "openStrip", strip: add("k") }, { type: "clear" }]);
		expect(stripped.strip).toBeNull();
	});

	it("closes only the strip when the canvas is rebuilt", () => {
		const busy = run([
			{ type: "toggleFeed" },
			{ type: "openStrip", strip: add("k") },
			{ type: "travel", id: "a", profile: true },
		]);
		expect(workspace(busy, { type: "rearranged" })).toMatchObject({
			strip: null,
			feed: true,
			travel: { id: "a", profile: true },
		});
		const reading = run([{ type: "openProfile", id: "a" }]);
		expect(workspace(reading, { type: "rearranged" })).toBe(reading);
	});

	it("drops a profile, an edit strip or a travel about somebody no longer in the graph", () => {
		const editing = run([{ type: "openStrip", strip: edit("gone") }]);
		expect(workspace(editing, { type: "present", ids: new Set(["a"]) }).strip).toBeNull();
		const reading = run([{ type: "openProfile", id: "gone" }]);
		expect(workspace(reading, { type: "present", ids: new Set(["a"]) }).profile).toBeNull();
		const going = run([{ type: "travel", id: "gone", profile: true }]);
		expect(workspace(going, { type: "present", ids: new Set(["a"]) }).travel).toBeNull();
		// An add strip names a SOURCE row, which the fused ids cannot answer for; its subject
		// is the viewed person, and a new subject already closes it.
		const adding = run([{ type: "openStrip", strip: add("k") }]);
		expect(workspace(adding, { type: "present", ids: new Set(["b"]) })).toBe(adding);
	});

	it("holds its invariants through any sequence of events", () => {
		const ids = ["a", "b", "c"];
		const events: WorkspaceEvent[] = [
			...ids.flatMap((id): WorkspaceEvent[] => [
				{ type: "view", id },
				{ type: "travel", id, profile: true },
				{ type: "travel", id, profile: false },
				{ type: "arrived", id },
				{ type: "openProfile", id },
				{ type: "toggleProfile", id },
				{ type: "openStrip", strip: edit(id) },
				{ type: "toggleStrip", strip: edit(id) },
			]),
			{ type: "toggleStrip", strip: add("k") },
			{ type: "openStrip", strip: add("j") },
			{ type: "closeProfile" },
			{ type: "toggleFeed" },
			{ type: "closeFeed" },
			{ type: "closeStrip" },
			{ type: "clear" },
			{ type: "rearranged" },
			{ type: "present", ids: new Set(["a", "b"]) },
		];
		// A small deterministic generator, so a failure names a reproducible sequence.
		let seed = 7;
		const next = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		for (let walk = 0; walk < 400; walk += 1) {
			let state = initialWorkspace("a");
			for (let step = 0; step < 30; step += 1) {
				const event = events[Math.floor(next() * events.length)] as WorkspaceEvent;
				const before = state;
				state = workspace(state, event);
				expect(state.strip !== null && state.profile !== null).toBe(false);
				if (state.viewed !== before.viewed) expect(state.strip).toBeNull();
				if (state.travel) expect(state.viewed).toBe(state.travel.id);
			}
		}
	});
});
