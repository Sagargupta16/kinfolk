"use client";

/**
 * Edit one person's own details, from the panel that shows them.
 *
 * The record a viewer most needs to fix is their own: provisioning gives a new account a
 * single node with `sex` left `unknown`, no dates and no places, because inventing any of
 * those would be a guess that outlives the render that made it. So the emptiest card in the
 * graph is yours, and until now nothing could fill it in -- `updatePerson` existed with no
 * UI at all.
 *
 * Two things here are less obvious than the form:
 *
 *   - It edits a SOURCE row, resolved by `editTarget`, never the fused id. A merged person's
 *     id is the smallest member id, which lands on the far family's row about half the time.
 *   - It posts only the fields it renders. `updatePerson` now patches by key presence, so an
 *     absent key is left alone -- which is what makes a compact form safe next to columns it
 *     never shows.
 */
import { Check, Loader2, Pencil, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { updatePerson } from "@/lib/tree/edit-actions";
import { editInitialValues, editTarget, yearValue } from "@/lib/tree/editable";
import { displayName, type FusedPerson } from "@/lib/tree/graph";
import { cn } from "@/lib/utils";

/** Sex options, in the schema's own order. `unknown` is a real stored value, not a blank. */
const SEXES = [
	{ value: "female", label: "Female" },
	{ value: "male", label: "Male" },
	{ value: "other", label: "Other" },
	{ value: "unknown", label: "Not known" },
] as const;

const LIVING = [
	{ value: "living", label: "Living" },
	{ value: "deceased", label: "Deceased" },
	{ value: "unknown", label: "Not known" },
] as const;

export function PersonEdit({
	person,
	editableTreeIds,
	onSaved,
	onClose,
}: {
	person: FusedPerson;
	/** Trees this viewer may write to, in preference order. See lib/tree/editable.ts. */
	editableTreeIds: readonly string[];
	onSaved: () => void;
	onClose: () => void;
}) {
	const target = editTarget(person, editableTreeIds);
	const titleId = useId();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const firstField = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	useEffect(() => {
		firstField.current?.focus();
	}, []);

	// A refusal is rendered rather than the form: a disabled form invites somebody to type
	// into it before telling them it will not save.
	if (!target.editable) {
		return (
			<Shell titleId={titleId} title="Cannot edit" onClose={onClose}>
				<p className="px-3 pb-3 text-[0.8125rem] leading-relaxed text-ink-muted">{target.reason}</p>
			</Shell>
		);
	}

	const values = editInitialValues(person, target.personId);

	async function submit(formData: FormData) {
		setPending(true);
		setError(null);
		// The SOURCE row, not the fused id. The server would refuse the latter, and the message
		// would tell somebody they may not edit their own record.
		formData.set("personId", target.editable ? target.personId : "");

		const result = await updatePerson(formData);
		setPending(false);
		if (!result.ok) {
			setError(result.error);
			return;
		}
		onSaved();
		onClose();
	}

	return (
		<Shell
			titleId={titleId}
			title={`Edit ${displayName(values ?? person.primary)}`}
			onClose={onClose}
		>
			<form action={submit} className="space-y-2 px-3 pb-3">
				<div className="flex gap-2">
					<Field label="First name">
						{(id) => (
							<input
								id={id}
								ref={firstField}
								name="givenName"
								defaultValue={values?.givenName ?? ""}
								autoComplete="off"
								className={inputClass}
							/>
						)}
					</Field>
					<Field label="Family name">
						{(id) => (
							<input
								id={id}
								name="familyName"
								defaultValue={values?.familyName ?? ""}
								autoComplete="off"
								className={inputClass}
							/>
						)}
					</Field>
				</div>

				{/* Searchable, and the field the old action silently nulled on every save. */}
				<Field label="Born as" hint="Maiden or pre-marriage name">
					{(id) => (
						<input
							id={id}
							name="birthFamilyName"
							defaultValue={values?.birthFamilyName ?? ""}
							autoComplete="off"
							className={inputClass}
						/>
					)}
				</Field>

				<Field label="Known as">
					{(id) => (
						<input
							id={id}
							name="nickname"
							defaultValue={values?.nickname ?? ""}
							autoComplete="off"
							className={inputClass}
						/>
					)}
				</Field>

				<Choice name="sex" legend="Gender" options={SEXES} current={values?.sex ?? "unknown"} />
				<Choice
					name="living"
					legend="Status"
					options={LIVING}
					current={values?.living ?? "unknown"}
				/>

				<div className="flex gap-2">
					{/*
					 * A YEAR, because that is what people know. `updatePerson` routes it to the exact
					 * or the fuzzy column, so "1952" and "about 1890" are both accepted without one
					 * of them inventing a birthday.
					 */}
					<Field label="Born" hint="Year">
						{(id) => (
							<input
								id={id}
								name="birthYear"
								inputMode="numeric"
								placeholder="1952"
								defaultValue={yearValue(values?.birthDate ?? null, values?.birthDateApprox ?? null)}
								className={cn(inputClass, "tabular")}
							/>
						)}
					</Field>
					<Field label="Died" hint="Year">
						{(id) => (
							<input
								id={id}
								name="deathYear"
								inputMode="numeric"
								defaultValue={yearValue(values?.deathDate ?? null, values?.deathDateApprox ?? null)}
								className={cn(inputClass, "tabular")}
							/>
						)}
					</Field>
				</div>

				<Field label="Birthplace">
					{(id) => (
						<input
							id={id}
							name="birthPlace"
							defaultValue={values?.birthPlace ?? ""}
							autoComplete="off"
							className={inputClass}
						/>
					)}
				</Field>

				<Field label="Lives" hint="Now, or last known">
					{(id) => (
						<input
							id={id}
							name="currentPlace"
							defaultValue={values?.currentPlace ?? ""}
							autoComplete="off"
							className={inputClass}
						/>
					)}
				</Field>

				<Field label="Work">
					{(id) => (
						<input
							id={id}
							name="occupation"
							defaultValue={values?.occupation ?? ""}
							autoComplete="off"
							className={inputClass}
						/>
					)}
				</Field>

				<Field label="Notes">
					{(id) => (
						<textarea
							id={id}
							name="bio"
							rows={3}
							defaultValue={values?.bio ?? ""}
							className={cn(inputClass, "h-auto resize-y py-2 leading-relaxed")}
						/>
					)}
				</Field>

				{/*
				 * Where the record came from, in the owner's own words.
				 *
				 * `verification` is deliberately NOT here. It is a provenance claim the card renders
				 * as a tick, and letting somebody mark their own row `documented` would turn the
				 * strongest evidence level into a self-assessment -- which is exactly what the
				 * separate `self_confirmed` level already means without overstating it.
				 */}
				<Field label="Source" hint="Certificate, who remembered it">
					{(id) => (
						<input
							id={id}
							name="sourceNote"
							defaultValue={values?.sourceNote ?? ""}
							autoComplete="off"
							className={inputClass}
						/>
					)}
				</Field>

				{error && (
					<p role="alert" className="text-[0.75rem] leading-snug text-danger">
						{error}
					</p>
				)}

				<button
					type="submit"
					disabled={pending}
					className={cn(
						"mt-1 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg",
						"border border-accent/40 bg-accent/10 text-[0.8125rem] font-medium text-accent-ink",
						"transition-colors duration-(--duration-fast) ease-(--ease-out)",
						"hover:bg-accent/20 disabled:cursor-wait disabled:opacity-60",
					)}
				>
					{pending ? (
						<Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
					) : (
						<Check className="size-4" strokeWidth={2} aria-hidden="true" />
					)}
					{pending ? "Saving" : "Save"}
				</button>
			</form>
		</Shell>
	);
}

const inputClass =
	"h-11 w-full rounded-lg border border-hairline bg-surface px-3 text-[0.875rem] text-ink placeholder:text-ink-faint";

function Shell({
	titleId,
	title,
	onClose,
	children,
}: {
	titleId: string;
	title: string;
	onClose: () => void;
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="flex items-center gap-2 border-b border-hairline px-3 pb-2.5 pt-3">
				<Pencil
					className="size-3.5 shrink-0 text-ink-faint"
					strokeWidth={1.75}
					aria-hidden="true"
				/>
				<h2 id={titleId} className="min-w-0 flex-1 truncate text-[0.875rem] font-medium text-ink">
					{title}
				</h2>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close without saving"
					className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-raised hover:text-ink"
				>
					<X className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
				</button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-2">{children}</div>
		</div>
	);
}

/**
 * One labelled field.
 *
 * The label is bound by `htmlFor` and the input receives the matching `id` through a render
 * prop, rather than the input simply being nested. Wrapping works in a browser, but Biome's
 * `noLabelWithoutControl` cannot see a control that arrives as `children` -- and the rule is
 * right to complain: an explicit association survives the input later moving out of the
 * label, which nesting does not.
 */
function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: (id: string) => React.ReactNode;
}) {
	const id = useId();
	return (
		<div className="flex-1">
			<label
				htmlFor={id}
				className="mb-1 flex items-baseline gap-1.5 font-mono text-[0.5625rem] uppercase tracking-wider text-ink-faint"
			>
				{label}
				{hint && <span className="normal-case tracking-normal opacity-70">{hint}</span>}
			</label>
			{children(id)}
		</div>
	);
}

/**
 * A radio group as a segmented control.
 *
 * Radios rather than a `<select>` because there are three or four options and all of them
 * fit: a select hides the choices behind a tap, and "not known" being an option a viewer can
 * SEE is what stops them guessing to fill a blank.
 */
function Choice({
	name,
	legend,
	options,
	current,
}: {
	name: string;
	legend: string;
	options: readonly { value: string; label: string }[];
	current: string;
}) {
	return (
		<fieldset>
			<legend className="mb-1 font-mono text-[0.5625rem] uppercase tracking-wider text-ink-faint">
				{legend}
			</legend>
			<div className="flex overflow-hidden rounded-lg border border-hairline">
				{options.map((option, index) => (
					<label
						key={option.value}
						className={cn(
							"flex min-h-11 flex-1 cursor-pointer items-center justify-center px-1",
							"text-center text-[0.75rem] text-ink-muted",
							"has-checked:bg-surface-raised has-checked:text-accent-ink",
							index > 0 && "border-l border-hairline",
						)}
					>
						<input
							type="radio"
							name={name}
							value={option.value}
							defaultChecked={option.value === current}
							className="sr-only"
						/>
						{option.label}
					</label>
				))}
			</div>
		</fieldset>
	);
}

/** The pencil that opens it, for the panel header. */
export function EditButton({ onOpen, label }: { onOpen: () => void; label: string }) {
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-label={label}
			title={label}
			className={cn(
				"flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-faint",
				"transition-colors duration-(--duration-fast) ease-(--ease-out)",
				"hover:bg-surface-raised hover:text-accent-ink",
			)}
		>
			<Pencil className="size-4" strokeWidth={1.75} aria-hidden="true" />
		</button>
	);
}

/** Wraps the form so it can animate in over the panel's read view. */
export function PersonEditSheet({
	person,
	editableTreeIds,
	onSaved,
	onClose,
}: {
	person: FusedPerson | null;
	editableTreeIds: readonly string[];
	onSaved: () => void;
	onClose: () => void;
}) {
	return (
		<AnimatePresence>
			{person && (
				<motion.div
					initial={{ opacity: 0, x: 24 }}
					animate={{ opacity: 1, x: 0 }}
					exit={{ opacity: 0, x: 24 }}
					transition={{ type: "spring", stiffness: 380, damping: 32 }}
					// Over the panel's own content rather than beside it: the form and the read view
					// answer the same question, so showing both would be the same data twice.
					className="absolute inset-0 z-10 flex flex-col bg-surface/95 backdrop-blur-sm"
				>
					<PersonEdit
						person={person}
						editableTreeIds={editableTreeIds}
						onSaved={onSaved}
						onClose={onClose}
					/>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
