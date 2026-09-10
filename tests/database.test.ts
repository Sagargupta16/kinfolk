import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { id, testDatabase } from "./database";

const auth = vi.hoisted(() => ({ userId: "", demo: false, bearer: null as string | null }));
vi.mock("@/auth", () => ({
	sessionOrNull: async () => (auth.userId ? { user: { id: auth.userId } } : null),
	signOut: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
	cookies: async () => ({ get: () => (auth.demo ? { value: "1" } : undefined) }),
	headers: async () => new Headers(auth.bearer ? { authorization: auth.bearer } : {}),
}));
vi.mock("@/lib/db/client", async () => {
	const { testDatabase } = await import("./database");
	return { db: (await testDatabase()).db, hasDatabase: () => true };
});

import { NextRequest } from "next/server";
import { POST as dispatchAction } from "@/app/api/action/[name]/route";
import { GET as readiness } from "@/app/api/health/route";
import { GET } from "@/app/api/tree/route";
import { contactState } from "@/lib/tree/contact-state";
import {
	addChild,
	addContact,
	addPerson,
	addRelative,
	deleteContact,
	deletePerson,
	updateContact,
} from "@/lib/tree/edit-actions";
import { decideLink, linkState, proposeLink } from "@/lib/tree/link-actions";
import { loadTreeView } from "@/lib/tree/load";
import { claimInvites } from "@/lib/tree/provision";
import { treeAccessForUser } from "@/lib/tree/read-access";
import { invite, revokeInvite } from "@/lib/tree/share-actions";

const owner = id(1);
const other = id(2);
const ownedTree = id(11);
const otherTree = id(12);
const subject = id(101);
const parentA = id(102);
const parentB = id(103);
const familyId = id(201);
const otherPerson = id(301);

function form(values: Record<string, string>): FormData {
	const result = new FormData();
	for (const [key, value] of Object.entries(values)) result.set(key, value);
	return result;
}

beforeEach(async () => {
	auth.userId = owner;
	auth.demo = false;
	auth.bearer = null;
	const { engine, controls } = await testDatabase();
	controls.beforeBatch = null;
	await engine.exec("TRUNCATE users CASCADE");
	await engine.query(
		"INSERT INTO users (id, name, email) VALUES ($1, 'Owner', 'owner@example.invalid'), ($2, 'Other', 'other@example.invalid')",
		[owner, other],
	);
	await engine.query(
		"INSERT INTO trees (id, owner_id, name, slug, root_person_id) VALUES ($1, $2, 'Owned family', 'owned-family', $3), ($4, $5, 'Other family', 'other-family', NULL)",
		[ownedTree, owner, subject, otherTree, other],
	);
	await engine.query(
		"INSERT INTO people (id, tree_id, given_name, claimed_by_user_id) VALUES ($1, $2, 'Subject', $3)",
		[subject, ownedTree, owner],
	);
});

afterAll(async () => {
	await (await testDatabase()).engine.close();
});

async function seedParents() {
	const { engine } = await testDatabase();
	await engine.query(
		"INSERT INTO people (id, tree_id, given_name) VALUES ($1, $3, 'Parent A'), ($2, $3, 'Parent B')",
		[parentA, parentB, ownedTree],
	);
	await engine.query(
		"INSERT INTO unions (id, tree_id, partner_a_id, partner_b_id) VALUES ($1, $2, $3, $4)",
		[familyId, ownedTree, parentA, parentB],
	);
	await engine.query("INSERT INTO union_children (union_id, child_id) VALUES ($1, $2)", [
		familyId,
		subject,
	]);
}

describe("atomic family mutations", () => {
	it("adds both parents to the same family without leaving disconnected people", async () => {
		expect(
			await addRelative(form({ subjectId: subject, role: "father", givenName: "Father" })),
		).toMatchObject({ ok: true });
		expect(
			await addRelative(form({ subjectId: subject, role: "mother", givenName: "Mother" })),
		).toMatchObject({ ok: true });
		const { engine } = await testDatabase();
		const result = await engine.query("SELECT partner_a_id, partner_b_id FROM unions");
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({
			partner_a_id: expect.any(String),
			partner_b_id: expect.any(String),
		});
		expect((await engine.query("SELECT id FROM people")).rows).toHaveLength(3);
		expect((await engine.query("SELECT child_id FROM union_children")).rows).toEqual([
			{ child_id: subject },
		]);
	});

	it("rolls back the new person and partnership if attaching the child fails", async () => {
		const { engine } = await testDatabase();
		await engine.exec(
			"ALTER TABLE union_children ADD CONSTRAINT reject_test_child CHECK (false) NOT VALID",
		);
		try {
			await expect(addRelative(form({ subjectId: subject, role: "father" }))).rejects.toThrow();
			expect((await engine.query("SELECT id FROM people")).rows).toHaveLength(1);
			expect((await engine.query("SELECT id FROM unions")).rows).toHaveLength(0);
		} finally {
			await engine.exec("ALTER TABLE union_children DROP CONSTRAINT reject_test_child");
		}
	});

	it("refuses a lost partner-slot race without leaving an orphan", async () => {
		await seedParents();
		const { engine, controls } = await testDatabase();
		await engine.query("UPDATE unions SET partner_b_id = NULL WHERE id = $1", [familyId]);
		controls.beforeBatch = async () => {
			await engine.query("UPDATE unions SET partner_b_id = $1 WHERE id = $2", [parentB, familyId]);
		};
		const result = await addRelative(form({ subjectId: subject, role: "mother" }));
		expect(result).toMatchObject({ ok: false, error: expect.stringContaining("family changed") });
		expect((await engine.query("SELECT id FROM people")).rows).toHaveLength(3);
		expect((await engine.query("SELECT partner_b_id FROM unions")).rows).toEqual([
			{ partner_b_id: parentB },
		]);
	});

	it.each([
		["father", "mother", 1],
		["sibling", "sibling", 2],
		["child", "child", 2],
	] as const)(
		"does not split concurrent first %s additions into separate families",
		async (role, competingRole, count) => {
			const { engine, controls } = await testDatabase();
			controls.beforeBatch = async () => {
				expect(
					await addRelative(
						form({ subjectId: subject, role: competingRole, count: String(count) }),
					),
				).toMatchObject({ ok: true });
			};
			expect(
				await addRelative(form({ subjectId: subject, role, count: String(count) })),
			).toMatchObject({ ok: false, error: expect.stringContaining("family changed") });
			expect((await engine.query("SELECT id FROM unions")).rows).toHaveLength(1);
			expect((await engine.query("SELECT id FROM people")).rows).toHaveLength(1 + count);
			expect(
				await addRelative(form({ subjectId: subject, role, count: String(count) })),
			).toMatchObject({ ok: true });
			expect((await engine.query("SELECT id FROM unions")).rows).toHaveLength(1);
			expect((await engine.query("SELECT id FROM people")).rows).toHaveLength(1 + 2 * count);
		},
	);

	it("keeps a new childless partnership and its chosen status intact", async () => {
		const result = await addRelative(
			form({ subjectId: subject, role: "partner", givenName: "Partner", unionStatus: "married" }),
		);
		expect(result).toMatchObject({ ok: true, id: expect.any(String) });
		const { engine } = await testDatabase();
		expect(
			(await engine.query("SELECT partner_a_id, partner_b_id, status FROM unions")).rows,
		).toEqual([
			{ partner_a_id: subject, partner_b_id: result.ok ? result.id : "", status: "married" },
		]);
		expect((await engine.query("SELECT child_id FROM union_children")).rows).toHaveLength(0);
	});

	it("preserves the surviving parent and child membership when one parent is deleted", async () => {
		await seedParents();
		expect(await deletePerson(form({ personId: parentA }))).toEqual({ ok: true });
		const { engine } = await testDatabase();
		expect((await engine.query("SELECT partner_a_id, partner_b_id FROM unions")).rows).toEqual([
			{ partner_a_id: null, partner_b_id: parentB },
		]);
		expect((await engine.query("SELECT child_id FROM union_children")).rows).toEqual([
			{ child_id: subject },
		]);
	});

	it("clears a deleted root instead of retaining a dangling person id", async () => {
		const { engine } = await testDatabase();
		await engine.query("UPDATE people SET claimed_by_user_id = NULL WHERE id = $1", [subject]);
		expect(await deletePerson(form({ personId: subject }))).toEqual({ ok: true });
		expect(
			(await engine.query("SELECT root_person_id FROM trees WHERE id = $1", [ownedTree])).rows,
		).toEqual([{ root_person_id: null }]);
	});

	it("keeps an account-linked profile and its family connections intact", async () => {
		await seedParents();
		expect(await deletePerson(form({ personId: subject }))).toMatchObject({
			ok: false,
			error: expect.stringContaining("linked to an account"),
		});
		const { engine } = await testDatabase();
		expect((await engine.query("SELECT id FROM people")).rows).toHaveLength(3);
		expect((await engine.query("SELECT child_id FROM union_children")).rows).toEqual([
			{ child_id: subject },
		]);
		expect(
			(await engine.query("SELECT root_person_id FROM trees WHERE id = $1", [ownedTree])).rows,
		).toEqual([{ root_person_id: subject }]);
	});
});

describe("authenticated views and permissions", () => {
	it("checks the migrated schema without returning family or session data", async () => {
		vi.stubEnv("AUTH_GITHUB_ID", "synthetic-client");
		vi.stubEnv("AUTH_GITHUB_SECRET", "synthetic-secret");
		vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
		try {
			const response = await readiness();
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				status: "ready",
				database: "ready",
				auth: "configured",
				commit: "a".repeat(40),
				version: expect.any(String),
			});
			expect(response.headers.get("cache-control")).toBe("no-store");
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("supplies account identity on the bearer API path", async () => {
		const { engine } = await testDatabase();
		await engine.query(
			"INSERT INTO sessions (session_token, user_id, expires) VALUES ('synthetic-session', $1, now() + interval '1 day')",
			[owner],
		);
		const response = await GET(
			new NextRequest("http://localhost/api/tree", {
				headers: { authorization: "Bearer synthetic-session" },
			}),
		);
		expect(response.status).toBe(200);
		expect((await response.json()).view.viewer).toEqual({
			name: "Owner",
			email: "owner@example.invalid",
		});
	});

	it("keeps every write grant while preferring the owner's tree", async () => {
		const { engine } = await testDatabase();
		await engine.query(
			"INSERT INTO tree_members (tree_id, user_id, role) VALUES ($1, $2, 'editor')",
			[otherTree, owner],
		);
		const view = await loadTreeView(owner);
		expect(view?.editableTreeId).toBe(ownedTree);
		expect(view?.editableTreeIds).toEqual([ownedTree, otherTree]);
	});

	it("does not turn a read grant into an edit grant", async () => {
		const { engine } = await testDatabase();
		await engine.query(
			"INSERT INTO tree_members (tree_id, user_id, role) VALUES ($1, $2, 'viewer')",
			[otherTree, owner],
		);
		expect((await loadTreeView(owner))?.editableTreeIds).toEqual([ownedTree]);
		expect(await addPerson(form({ treeId: otherTree, givenName: "Refused" }))).toMatchObject({
			ok: false,
		});
	});

	it("honors a real session even when a demo cookie remains", async () => {
		auth.demo = true;
		expect(await addPerson(form({ treeId: ownedTree, givenName: "Added" }))).toMatchObject({
			ok: true,
		});
		expect(
			await invite(form({ treeId: ownedTree, githubLogin: "synthetic-relative", role: "viewer" })),
		).toMatchObject({ ok: true });
	});

	it("still refuses signed-out demo mutations", async () => {
		auth.userId = "";
		auth.demo = true;
		expect(await addPerson(form({ treeId: ownedTree, givenName: "Refused" }))).toMatchObject({
			ok: false,
			error: expect.stringContaining("sample data"),
		});
	});

	it("rejects a form posted from an untrusted origin before using the session cookie", async () => {
		const response = await dispatchAction(
			new NextRequest("http://localhost/api/action/addPerson", {
				method: "POST",
				headers: { origin: "https://untrusted.example.invalid" },
				body: form({ treeId: ownedTree, givenName: "Cross-origin write" }),
			}),
			{ params: Promise.resolve({ name: "addPerson" }) },
		);
		expect(response.status).toBe(403);
		expect((await (await testDatabase()).engine.query("SELECT id FROM people")).rows).toHaveLength(
			1,
		);
	});

	it.each(["http://localhost", "https://sagargupta.online"])(
		"continues to accept authenticated actions from %s",
		async (origin) => {
			const response = await dispatchAction(
				new NextRequest("http://localhost/api/action/addPerson", {
					method: "POST",
					headers: { origin },
					body: form({ treeId: ownedTree, givenName: "Allowed write" }),
				}),
				{ params: Promise.resolve({ name: "addPerson" }) },
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ ok: true });
			expect(response.headers.get("cache-control")).toBe("private, no-store");
		},
	);
});

async function seedOtherFamily() {
	const { engine } = await testDatabase();
	await engine.query(
		"INSERT INTO people (id, tree_id, given_name) VALUES ($1, $2, 'Other record')",
		[otherPerson, otherTree],
	);
	await engine.query(
		"INSERT INTO tree_members (tree_id, user_id, role) VALUES ($1, $2, 'viewer')",
		[otherTree, owner],
	);
}

async function propose() {
	const result = await proposeLink(
		form({ fromPersonId: subject, toPersonId: otherPerson, consent: "true" }),
	);
	expect(result).toMatchObject({ ok: true, id: expect.any(String) });
	if (!result.ok || !result.id) throw new Error("Expected a proposal");
	return result.id;
}

describe("cross-family consent", () => {
	it("leaves a proposal pending until the other owner consents, then revokes access without deleting records", async () => {
		await seedOtherFamily();
		const linkId = await propose();
		expect((await treeAccessForUser(other)).access.size).toBe(1);
		expect(await decideLink(form({ linkId, decision: "accept", consent: "true" }))).toMatchObject({
			ok: false,
		});
		auth.userId = other;
		expect((await linkState()).proposals[0]).toMatchObject({ id: linkId, canDecide: true });
		expect(await decideLink(form({ linkId, decision: "accept" }))).toMatchObject({ ok: false });
		expect(await decideLink(form({ linkId, decision: "accept", consent: "true" }))).toMatchObject({
			ok: true,
		});
		expect((await treeAccessForUser(other)).access.get(ownedTree)).toBe("linked");
		expect((await loadTreeView(other))?.stats.merged).toBe(1);
		expect(await decideLink(form({ linkId, decision: "revoke" }))).toMatchObject({ ok: true });
		expect((await treeAccessForUser(other)).access.size).toBe(1);
		expect((await (await testDatabase()).engine.query("SELECT id FROM people")).rows).toHaveLength(
			2,
		);
		expect(await decideLink(form({ linkId, decision: "accept", consent: "true" }))).toMatchObject({
			ok: false,
		});
	});

	it("cannot discover an unshared family by guessing its person id", async () => {
		await seedOtherFamily();
		await (await testDatabase()).engine.query("DELETE FROM tree_members WHERE user_id = $1", [
			owner,
		]);
		expect((await linkState()).candidates).toHaveLength(1);
		expect(
			await proposeLink(form({ fromPersonId: subject, toPersonId: otherPerson, consent: "true" })),
		).toMatchObject({ ok: false });
	});

	it("does not let an editor grant provide the owner's consent", async () => {
		await seedOtherFamily();
		auth.userId = other;
		const { engine } = await testDatabase();
		await engine.query(
			"INSERT INTO tree_members (tree_id, user_id, role) VALUES ($1, $2, 'editor')",
			[ownedTree, other],
		);
		expect(
			await proposeLink(form({ fromPersonId: subject, toPersonId: otherPerson, consent: "true" })),
		).toMatchObject({ ok: false });
	});

	it("requires new consent for a rejected pair and prevents duplicate active proposals", async () => {
		await seedOtherFamily();
		const linkId = await propose();
		expect(
			await proposeLink(form({ fromPersonId: subject, toPersonId: otherPerson, consent: "true" })),
		).toMatchObject({ ok: false });
		auth.userId = other;
		expect(await decideLink(form({ linkId, decision: "reject" }))).toMatchObject({ ok: true });
		auth.userId = owner;
		const replacementId = await propose();
		auth.userId = other;
		expect(await decideLink(form({ linkId, decision: "accept", consent: "true" }))).toMatchObject({
			ok: false,
		});
		const { engine } = await testDatabase();
		expect((await engine.query("SELECT status, decided_by_id FROM person_links")).rows).toEqual([
			{ status: "pending", decided_by_id: null },
		]);
		expect(
			await decideLink(form({ linkId: replacementId, decision: "accept", consent: "true" })),
		).toMatchObject({ ok: true });
	});

	it("never widens linked-family access into a write grant or a private-contact read", async () => {
		await seedOtherFamily();
		await addContact(form({ personId: subject, kind: "phone", value: "synthetic private detail" }));
		await addContact(
			form({
				personId: subject,
				kind: "email",
				value: "shared@example.invalid",
				visibility: "linked",
			}),
		);
		const linkId = await propose();
		auth.userId = other;
		await decideLink(form({ linkId, decision: "accept", consent: "true" }));
		const view = await loadTreeView(other);
		const contacts =
			view?.nodes.flatMap((node) => (node.type === "person" ? node.data.contacts : [])) ?? [];
		expect(contacts.map(({ value }) => value)).toEqual(["shared@example.invalid"]);
		expect(await contactState(subject)).toMatchObject({
			editable: false,
			contacts: [{ value: "shared@example.invalid" }],
		});
		expect(
			await addContact(form({ personId: subject, kind: "phone", value: "Refused" })),
		).toMatchObject({ ok: false });
	});
});

describe("contact editing and existing children", () => {
	it("updates a contact in place while preserving unrelated details", async () => {
		await addContact(form({ personId: subject, kind: "phone", value: "old value" }));
		await addContact(form({ personId: subject, kind: "email", value: "person@example.invalid" }));
		const before = await contactState(subject);
		const contact = before.contacts.find(({ kind }) => kind === "phone");
		expect(contact).toBeDefined();
		const contactId = contact?.id ?? "";
		expect(
			await updateContact(
				form({ contactId, kind: "phone", value: "new value", label: "Home", visibility: "linked" }),
			),
		).toEqual({ ok: true });
		expect((await contactState(subject)).contacts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: contactId,
					value: "new value",
					label: "Home",
					visibility: "linked",
				}),
				expect.objectContaining({ value: "person@example.invalid", visibility: "tree" }),
			]),
		);
		auth.userId = other;
		expect(
			await updateContact(form({ contactId, kind: "phone", value: "Refused", visibility: "tree" })),
		).toMatchObject({ ok: false });
		expect(await deleteContact(form({ contactId }))).toMatchObject({ ok: false });
		await expect(contactState(subject)).rejects.toThrow("do not have access");
	});

	it("attaches a recorded child with its parent role and refuses cross-tree or cyclic links", async () => {
		await seedParents();
		const { engine } = await testDatabase();
		await engine.query("DELETE FROM union_children WHERE union_id = $1", [familyId]);
		expect(await addChild(form({ unionId: familyId, childId: subject, role: "adoptive" }))).toEqual(
			{ ok: true },
		);
		const view = await loadTreeView(owner);
		expect(view?.editableUnions[0]?.childRoles?.[subject]).toEqual(["adoptive"]);
		await seedOtherFamily();
		expect(await addChild(form({ unionId: familyId, childId: otherPerson }))).toMatchObject({
			ok: false,
		});
		const secondUnion = id(202);
		await engine.query("INSERT INTO unions (id, tree_id, partner_a_id) VALUES ($1, $2, $3)", [
			secondUnion,
			ownedTree,
			subject,
		]);
		expect(await addChild(form({ unionId: secondUnion, childId: parentA }))).toMatchObject({
			ok: false,
			error: expect.stringContaining("ancestor"),
		});
	});

	it("rechecks ancestry inside the transaction after a competing attachment", async () => {
		await seedParents();
		const { engine, controls } = await testDatabase();
		await engine.query("DELETE FROM union_children WHERE union_id = $1", [familyId]);
		const secondUnion = id(202);
		await engine.query("INSERT INTO unions (id, tree_id, partner_a_id) VALUES ($1, $2, $3)", [
			secondUnion,
			ownedTree,
			subject,
		]);
		controls.beforeBatch = async () => {
			await engine.query("INSERT INTO union_children (union_id, child_id) VALUES ($1, $2)", [
				secondUnion,
				parentA,
			]);
		};
		expect(await addChild(form({ unionId: familyId, childId: subject }))).toMatchObject({
			ok: false,
			error: expect.stringContaining("ancestor"),
		});
		expect((await engine.query("SELECT union_id, child_id FROM union_children")).rows).toEqual([
			{ union_id: secondUnion, child_id: parentA },
		]);
	});
});

describe("invite integrity", () => {
	it("does not grant a revoked invite or silently revoke an already claimed invite", async () => {
		const { engine } = await testDatabase();
		await invite(form({ treeId: ownedTree, email: "other@example.invalid" }));
		const [row] = (await engine.query<{ id: string }>("SELECT id FROM tree_invites")).rows;
		expect(row).toBeDefined();
		const inviteId = row?.id ?? "";
		expect(await revokeInvite(form({ inviteId }))).toEqual({ ok: true });
		expect(await claimInvites(other, "other@example.invalid", null)).toBe(0);
		expect((await engine.query("SELECT user_id FROM tree_members")).rows).toHaveLength(0);
		await invite(form({ treeId: ownedTree, githubLogin: "synthetic-relative" }));
		expect(await claimInvites(other, null, "Synthetic-Relative")).toBe(1);
		const [claimed] = (
			await engine.query<{ id: string }>("SELECT id FROM tree_invites WHERE status = 'accepted'")
		).rows;
		expect(await revokeInvite(form({ inviteId: claimed?.id ?? "" }))).toMatchObject({
			ok: false,
			error: expect.stringContaining("no longer pending"),
		});
	});

	it("rolls the invite back to pending if granting membership fails", async () => {
		const { engine } = await testDatabase();
		await invite(form({ treeId: ownedTree, email: "other@example.invalid" }));
		await engine.exec(
			"ALTER TABLE tree_members ADD CONSTRAINT reject_test_member CHECK (false) NOT VALID",
		);
		try {
			expect(await claimInvites(other, "other@example.invalid", null)).toBe(0);
			expect((await engine.query("SELECT status FROM tree_invites")).rows).toEqual([
				{ status: "pending" },
			]);
		} finally {
			await engine.exec("ALTER TABLE tree_members DROP CONSTRAINT reject_test_member");
		}
	});
});
