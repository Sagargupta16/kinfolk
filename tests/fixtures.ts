import type { Person } from "@/lib/db/schema";
import { fuseTrees, type TreeSlice, type UnionWithChildren } from "@/lib/tree/graph";
import { sampleSlices } from "@/lib/tree/sample";

const samplePerson = sampleSlices.flatMap((slice) => slice.people)[0];
const sampleUnion = sampleSlices.flatMap((slice) => slice.unions)[0];
if (!samplePerson || !sampleUnion) throw new Error("The sample must contain people and a union.");

const personTemplate = samplePerson;
const unionTemplate = sampleUnion;
export const recordedAt = new Date("2026-01-01T00:00:00.000Z");

export function person(id: string, overrides: Partial<Person> = {}): Person {
	return {
		...personTemplate,
		id,
		treeId: "owned",
		givenName: id,
		familyName: null,
		sex: "unknown",
		birthDate: null,
		birthDateApprox: null,
		deathDate: null,
		deathDateApprox: null,
		claimedByUserId: null,
		createdAt: recordedAt,
		updatedAt: recordedAt,
		...overrides,
	};
}

export function union(
	id: string,
	a: string | null,
	b: string | null,
	childIds: string[] = [],
	overrides: Partial<UnionWithChildren> = {},
): UnionWithChildren {
	return {
		...unionTemplate,
		id,
		treeId: "owned",
		partnerAId: a,
		partnerBId: b,
		childIds,
		status: "married",
		createdAt: recordedAt,
		...overrides,
	};
}

export function slice(people: Person[], unions: UnionWithChildren[] = []): TreeSlice {
	return { treeId: "owned", treeName: "Synthetic family", people, unions };
}

export function graph(people: Person[], unions: UnionWithChildren[] = []) {
	return fuseTrees([slice(people, unions)], [], "owned");
}
