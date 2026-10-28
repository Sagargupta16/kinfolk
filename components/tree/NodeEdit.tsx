"use client";

/**
 * Change a person from their own card: the name, the year, or the record itself.
 *
 * A second tap on the viewed card opens this strip where the card is. The edit used to start
 * from a profile panel, then a pencil, then a form with a header, a gender bar, a status bar
 * and a delete section -- a box of sections for what is usually a misspelt name or a missing
 * year. The strip keeps those two fields and two exits: the full profile, where gender,
 * status and everything else still live, and delete, confirmed in place.
 *
 * The write rules are PersonEdit's (see lib/tree/editable.ts and person-patch.ts): it edits a
 * SOURCE row resolved by `editTarget`, prefills from that row, posts the name only when it
 * was retyped, and never posts a column it does not show -- so sex, status, places and notes
 * are left exactly as stored.
 */
import { Check, Loader2, Trash2, UserRound } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { deletePerson, updatePerson } from "@/lib/tree/edit-actions";
import { dateInputValue, editInitialValues, editTarget } from "@/lib/tree/editable";
import { displayName, type FusedPerson } from "@/lib/tree/graph";
import { splitName } from "@/lib/tree/kin-plan";
import type { StripSide } from "@/lib/tree/node-add";
import { cn } from "@/lib/utils";
import { NodeStrip, stripRow, useShake } from "./NodeStrip";

/**
 * The two name columns as the one field shows them, whitespace collapsed for comparison.
 * Exported for PersonEdit, which shows the same field and must compare it the same way.
 */
export function joinedName(
	givenName: string | null | undefined,
	familyName: string | null | undefined,
) {
	return [givenName, familyName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/** How long the card takes to shrink away before its record is deleted (kf-leaving). */
const LEAVE_MS = 220;

export function NodeEditStrip({
	person,
	editableTreeIds,
	anchor,
	side,
	onSaved,
	onLeaving,
	onFailed,
	onProfile,
	onClose,
}: {
	person: FusedPerson;
	/** Trees this viewer may write to, in preference order. See lib/tree/editable.ts. */
	editableTreeIds: readonly string[];
	anchor: { x: number; y: number };
	side: StripSide;
	/** After a write, so the canvas re-reads the graph and marks the card. */
	onSaved: (change: "updated" | "deleted") => void;
	/** The card shrinks away while a delete is in flight, and comes back if it fails. */
	onLeaving: (leaving: boolean) => void;
	/** A failure that arrived after the strip was closed, for the canvas to report. */
	onFailed?: (message: string) => void;
	onProfile: () => void;
	onClose: () => void;
}) {
	const target = editTarget(person, editableTreeIds);
	// The canvas opens this only for an editable person; a read-only one gets the profile.
	if (!target.editable) return null;
	const values = editInitialValues(person, target.personId);
	const name = displayName(values ?? person.primary);

	return (
		<NodeStrip anchor={anchor} side={side} label={`Edit ${name}`} onClose={onClose}>
			<EditForm
				// Uncontrolled fields seeded from `defaultValue`: a new person needs a new form.
				key={target.personId}
				personId={target.personId}
				name={name}
				initialName={joinedName(values?.givenName, values?.familyName)}
				initialYear={dateInputValue(values?.birthDate ?? null, values?.birthDateApprox ?? null)}
				claimed={Boolean(values?.claimedByUserId)}
				onSaved={onSaved}
				onLeaving={onLeaving}
				onFailed={onFailed}
				onProfile={onProfile}
				onClose={onClose}
			/>
		</NodeStrip>
	);
}

function EditForm({
	personId,
	name,
	initialName,
	initialYear,
	claimed,
	onSaved,
	onLeaving,
	onFailed,
	onProfile,
	onClose,
}: {
	personId: string;
	name: string;
	initialName: string;
	initialYear: string;
	/** An account-linked profile can be edited but never deleted. */
	claimed: boolean;
	onSaved: (change: "updated" | "deleted") => void;
	onLeaving: (leaving: boolean) => void;
	onFailed?: (message: string) => void;
	onProfile: () => void;
	onClose: () => void;
}) {
	const nameId = useId();
	const yearId = useId();
	const nameRef = useRef<HTMLInputElement>(null);
	const [pending, setPending] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<{ text: string; at: number } | null>(null);
	const shake = useShake<HTMLFormElement>(error?.at);
	// As in the add strip: a failure after the strip closed goes to the canvas instead.
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const fail = (text: string) => {
		if (mounted.current) setError({ text, at: Date.now() });
		else onFailed?.(text);
	};
	const firstName = name.split(/\s+/)[0] || name;

	async function save(form: HTMLFormElement) {
		if (pending) return;
		const data = new FormData(form);
		const typed = String(data.get("name") ?? "")
			.replace(/\s+/g, " ")
			.trim();
		const year = String(data.get("birthYear") ?? "").trim();
		// Nothing changed: close without a write, so an idle save never costs a relayout.
		if (typed === initialName && year === initialYear) {
			onClose();
			return;
		}
		data.set("personId", personId);
		if (typed === initialName) {
			// An untouched name is not posted, so the split it was stored with survives.
			data.delete("name");
		} else if (!typed) {
			setError({ text: "A person needs a name.", at: Date.now() });
			nameRef.current?.focus();
			return;
		} else {
			// The two columns too, which is all the previous API version reads: the app and the
			// API deploy separately, and the current API lets `name` win.
			const columns = splitName(typed);
			data.set("givenName", columns.givenName ?? "");
			data.set("familyName", columns.familyName ?? "");
		}

		setPending(true);
		setError(null);
		try {
			const result = await updatePerson(data);
			if (!result.ok) {
				fail(result.error);
				return;
			}
			onSaved("updated");
			onClose();
		} catch {
			fail("Could not save that. Try again.");
		} finally {
			if (mounted.current) setPending(false);
		}
	}

	async function remove() {
		if (pending) return;
		setPending(true);
		setError(null);
		// The card shrinks away first, so the record and its picture leave together rather than
		// the card blinking out when the refreshed graph arrives.
		onLeaving(true);
		await new Promise((resolve) => window.setTimeout(resolve, LEAVE_MS));
		const form = new FormData();
		form.set("personId", personId);
		try {
			const result = await deletePerson(form);
			if (!result.ok) {
				onLeaving(false);
				fail(result.error);
				return;
			}
			onSaved("deleted");
			onClose();
		} catch {
			onLeaving(false);
			fail("Could not delete that record. Try again.");
		} finally {
			if (mounted.current) setPending(false);
		}
	}

	return (
		<form
			ref={shake}
			onSubmit={(event) => {
				event.preventDefault();
				void save(event.currentTarget);
			}}
			aria-busy={pending}
			className="space-y-2 p-2"
		>
			{/* An exact stored date ("1984-08-10") needs room a bare year does not; the field
			    clipped it at the year's width. */}
			<motion.div
				variants={stripRow}
				className={cn(
					"grid gap-2",
					initialYear.length > 4
						? "grid-cols-[minmax(0,1fr)_7.75rem]"
						: "grid-cols-[minmax(0,1fr)_5rem]",
				)}
			>
				<label htmlFor={nameId} className="sr-only">
					Name
				</label>
				<input
					id={nameId}
					ref={nameRef}
					// Selected rather than only focused, once the strip is on screen, so retyping a
					// misspelt name replaces it in one go.
					data-autofocus="select"
					name="name"
					defaultValue={initialName}
					maxLength={120}
					autoComplete="off"
					autoCapitalize="words"
					enterKeyHint="done"
					placeholder="Name"
					className="kf-add-field"
				/>
				<label htmlFor={yearId} className="sr-only">
					Year born
				</label>
				{/* Keeps an exact stored date intact; a bare year goes to the fuzzy column. */}
				<input
					id={yearId}
					name="birthYear"
					inputMode="numeric"
					autoComplete="off"
					enterKeyHint="done"
					placeholder="Born"
					defaultValue={initialYear}
					className="kf-add-field tabular"
				/>
			</motion.div>

			{error && (
				<p role="alert" className="px-1 text-[0.75rem] leading-snug text-danger">
					{error.text}
				</p>
			)}

			{confirming ? (
				<motion.div
					variants={stripRow}
					initial="closed"
					animate="open"
					className="flex items-center gap-2"
				>
					<p className="min-w-0 flex-1 px-1 text-[0.8125rem] leading-snug text-ink-muted">
						Delete {firstName}? This cannot be undone.
					</p>
					<button
						type="button"
						disabled={pending}
						onClick={() => void remove()}
						className="kf-add-role kf-add-role--confirm px-3"
					>
						{pending ? (
							<Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
						) : (
							<Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
						)}
						Delete
					</button>
					<button
						type="button"
						disabled={pending}
						onClick={() => setConfirming(false)}
						className="kf-add-role px-3"
					>
						Keep
					</button>
				</motion.div>
			) : (
				<motion.div
					variants={stripRow}
					className={cn(
						"grid gap-2",
						claimed ? "grid-cols-[1fr_auto]" : "grid-cols-[1fr_auto_auto]",
					)}
				>
					{/* Enter in either field submits here: with one action there is no wrong answer
					    for implicit submission to pick, unlike the add strip's two gendered ones. */}
					<button type="submit" disabled={pending} className="kf-add-role kf-add-role--primary">
						{pending ? (
							<Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
						) : (
							<Check className="size-4" strokeWidth={2} aria-hidden="true" />
						)}
						Save
					</button>
					<button
						type="button"
						onClick={onProfile}
						aria-label={`Open ${name}'s profile`}
						title="Profile"
						className="kf-add-role px-3"
					>
						<UserRound className="size-4" strokeWidth={1.75} aria-hidden="true" />
						Profile
					</button>
					{!claimed && (
						<button
							type="button"
							onClick={() => setConfirming(true)}
							aria-label={`Delete ${name}`}
							title="Delete"
							className="kf-add-role kf-add-role--danger w-11 px-0"
						>
							<Trash2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
						</button>
					)}
				</motion.div>
			)}
		</form>
	);
}
