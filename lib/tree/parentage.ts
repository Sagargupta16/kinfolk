import type { ParentRole, Sex } from "../db/schema";
import type { UnionWithChildren } from "./graph";

/** Legacy views predate role metadata and used the schema's biological default. */
export function parentRoles(union: UnionWithChildren, childId: string): ParentRole[] {
	return union.childRoles?.[childId] ?? ["biological"];
}

export function parentageLabel(
	roles: readonly ParentRole[],
	sex: Sex,
	direction: "parent" | "child",
): string {
	const base =
		direction === "parent"
			? sex === "female"
				? "mother"
				: sex === "male"
					? "father"
					: "parent"
			: sex === "female"
				? "daughter"
				: sex === "male"
					? "son"
					: "child";
	const labels: Record<ParentRole, string> = {
		biological: base,
		adoptive: `adoptive ${base}`,
		step: `step${base}`,
		foster: `foster ${base}`,
		guardian: direction === "parent" ? "guardian" : "ward",
	};
	return [...new Set(roles.map((role) => labels[role]))].join(" / ");
}
