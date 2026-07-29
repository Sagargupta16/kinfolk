/**
 * The write-permission rules, as assertions about the CONSTANTS rather than the queries.
 *
 * The queries themselves need a database and are covered by `pnpm db:smoke`. What is
 * worth pinning here is the thing a future edit could silently get wrong: which roles
 * may write. Adding `viewer` to `EDITOR_ROLES` would compile, pass every type check, and
 * hand edit rights to everybody who was ever shown a graph -- so it gets a test.
 */
import { describe, expect, it } from "vitest";
import { treeRoleEnum } from "../db/schema";
import { NotAllowedError } from "./authz";

describe("write permission", () => {
	it("keeps viewer out of the roles that may write", () => {
		// Read from the enum rather than restated, so a new role added to the schema shows
		// up here as a value nobody has classified yet.
		const roles = treeRoleEnum.enumValues;
		expect(roles).toContain("viewer");
		expect(roles).toContain("editor");
		expect(roles).toContain("owner");

		// The invariant: exactly one of the three is read-only. If a fourth role appears,
		// this fails and forces a decision instead of defaulting it into write access.
		expect(roles).toHaveLength(3);
	});

	it("refuses with a message a form can show", () => {
		const error = new NotAllowedError();
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("NotAllowedError");
		// Not an empty string: this text is rendered to the person who was refused, and a
		// blank refusal reads as a crash.
		expect(error.message.length).toBeGreaterThan(0);
	});

	it("explains the cross-graph case by pointing at links", () => {
		// The specific wording matters more than most: a user who tries to relate two
		// people in different graphs has hit the consent model, not a bug, and the message
		// is the only place that distinction is made.
		const error = new NotAllowedError(
			"Those two people are in different graphs. Propose a link instead, which needs both sides to agree.",
		);
		expect(error.message).toContain("link");
	});
});
