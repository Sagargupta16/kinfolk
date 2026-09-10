import { describe, expect, it } from "vitest";
import { buildDemoView } from "@/lib/tree/demo";
import { dateInputValue, editInitialValues, editTarget } from "@/lib/tree/editable";
import { familyFeed } from "@/lib/tree/feed";
import { fuseTrees, toFlowGraph } from "@/lib/tree/graph";
import { buildPersonPatch } from "@/lib/tree/person-patch";
import { indexRelatives, relativesOf } from "@/lib/tree/relatives";
import { parseTreeView, serialiseTreeView } from "@/lib/tree/serialise";
import { graph, person, recordedAt, slice, union } from "./fixtures";

describe("record integrity", () => {
	it("preserves exact birth and death dates when a profile name changes", () => {
		const form = new FormData();
		form.set("givenName", "Corrected name");
		form.set("birthYear", dateInputValue("1952-06-19", null));
		form.set("deathYear", dateInputValue("2020-10-08", null));
		expect(buildPersonPatch(form)).toEqual({
			ok: true,
			patch: {
				givenName: "Corrected name",
				birthDate: "1952-06-19",
				birthDateApprox: null,
				deathDate: "2020-10-08",
				deathDateApprox: null,
			},
		});
	});

	it.each(["1952", "about 1890", "before the war"])("preserves approximate date %s", (value) => {
		const form = new FormData();
		form.set("birthYear", dateInputValue(null, value));
		expect(buildPersonPatch(form)).toEqual({
			ok: true,
			patch: { birthDate: null, birthDateApprox: value },
		});
	});

	it("distinguishes an omitted date from an intentional erasure", () => {
		const form = new FormData();
		form.set("givenName", "Name");
		expect(buildPersonPatch(form)).toEqual({ ok: true, patch: { givenName: "Name" } });
		form.set("birthYear", "");
		expect(buildPersonPatch(form)).toEqual({
			ok: true,
			patch: { givenName: "Name", birthDate: null, birthDateApprox: null },
		});
	});

	it("edits the owned source even when the fused identity uses a foreign id", () => {
		const owned = person("zzz", { givenName: "Own record" });
		const foreign = person("aaa", { treeId: "foreign", givenName: "Other record" });
		const fused = fuseTrees(
			[slice([owned]), { ...slice([foreign]), treeId: "foreign" }],
			[{ personAId: owned.id, personBId: foreign.id }],
			"owned",
		).people[0];
		expect(fused).toBeDefined();
		if (!fused) return;
		expect(fused.id).toBe("aaa");
		expect(editTarget(fused, ["owned"])).toEqual({
			editable: true,
			personId: "zzz",
			treeId: "owned",
		});
		expect(editInitialValues(fused, "zzz")?.givenName).toBe("Own record");
		expect(editTarget(fused, [])).toMatchObject({ editable: false });
	});
});

describe("relationship projection", () => {
	it("keeps a childless partner in details and the feed without adding a junction", () => {
		const projected = toFlowGraph(graph([person("a"), person("b")], [union("ab", "a", "b")]));
		expect(projected.nodes).toHaveLength(2);
		expect(projected.edges).toHaveLength(1);
		const relatives = relativesOf(indexRelatives(projected.nodes, projected.edges), "a");
		expect(relatives.partners.map(({ person }) => person.id)).toEqual(["b"]);
		expect(
			familyFeed(projected.nodes, projected.edges).filter((event) => event.kind === "partnership"),
		).toMatchObject([{ id: "union:ab", at: recordedAt }]);
	});

	it("revives direct partnerships and writable source records across the API boundary", () => {
		const projected = toFlowGraph(graph([person("a"), person("b")], [union("ab", "a", "b")]));
		const view = {
			...buildDemoView(),
			...projected,
			editableTreeId: "owned",
			editableTreeIds: ["owned", "granted"],
			editableUnions: [union("ab", "a", "b")],
		};
		const parsed = parseTreeView(JSON.parse(JSON.stringify(serialiseTreeView(view))));
		expect(parsed.editableTreeIds).toEqual(["owned", "granted"]);
		expect(parsed.editableUnions[0]?.createdAt).toEqual(recordedAt);
		expect(parsed.edges[0]?.union?.createdAt).toEqual(recordedAt);
		expect(() => familyFeed(parsed.nodes, parsed.edges)).not.toThrow();
	});

	it("accepts API responses from the previous deployment", () => {
		const payload = serialiseTreeView({ ...buildDemoView(), editableTreeId: "owned" });
		delete payload.editableTreeIds;
		delete payload.editableUnions;
		const parsed = parseTreeView(JSON.parse(JSON.stringify(payload)));
		expect(parsed.editableTreeIds).toEqual(["owned"]);
		expect(parsed.editableUnions).toEqual([]);
		expect(parsed.kinship).toBeInstanceOf(Map);
	});
});
