"use client";

/**
 * "Add a father" in one gesture, from the person you are looking at.
 *
 * The old editor asked you to think in the data model: create a person, create a union, put
 * them in it, attach the child. Four steps and a schema lesson for the commonest thing
 * anybody wants to do -- and doing it twice for a father and a mother produced two
 * single-parent unions, which draws two junctions and no couple.
 *
 * Here the relationship IS the button. `planKin` derives the structure (see
 * lib/tree/kin-plan.ts) so this component only has to collect four fields, and the sheet
 * says whose relative it is adding in its own heading -- a form that says "Add father" with
 * no name attached is how you record a father for the wrong person.
 */
import { Check, Loader2, Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { addRelative } from "@/lib/tree/edit-actions";
import { type KinRole, MAX_BATCH, ROLE_SEX } from "@/lib/tree/kin-plan";
import { cn } from "@/lib/utils";

/**
 * The roles offered, grouped the way a family is described rather than the way it is
 * stored.
 *
 * Gendered words because "add father" is what somebody means, and the role is an explicit
 * statement about the person being added -- unlike guessing sex from a name, which this repo
 * forbids. The neutral option sits alongside rather than replacing them, for the cases where
 * it genuinely is not known.
 */
const GROUPS: { label: string; roles: { role: KinRole; label: string }[] }[] = [
	{
		label: "Parents",
		roles: [
			{ role: "father", label: "Father" },
			{ role: "mother", label: "Mother" },
		],
	},
	{
		label: "Partner",
		roles: [{ role: "partner", label: "Partner" }],
	},
	{
		label: "Children",
		roles: [
			{ role: "son", label: "Son" },
			{ role: "daughter", label: "Daughter" },
			{ role: "child", label: "Child" },
		],
	},
	{
		label: "Siblings",
		roles: [
			{ role: "brother", label: "Brother" },
			{ role: "sister", label: "Sister" },
			{ role: "sibling", label: "Sibling" },
		],
	},
];

/** Roles a batch makes sense for: you can have five children, not five fathers. */
const BATCHABLE = new Set<KinRole>(["son", "daughter", "child", "brother", "sister", "sibling"]);

/**
 * Gender options, for the roles that do not already state one.
 *
 * `unknown` first and pre-selected, because it is a real stored value in this schema rather
 * than a blank somebody should feel obliged to fill. Genealogy is mostly incomplete data.
 */
const SEXES = [
	{ value: "unknown", label: "Not known" },
	{ value: "female", label: "Female" },
	{ value: "male", label: "Male" },
	{ value: "other", label: "Other" },
] as const;

export function QuickAdd({
	subjectId,
	subjectName,
	onDone,
	onClose,
}: {
	subjectId: string;
	subjectName: string;
	/** Called after a successful write, so the canvas can refresh. */
	onDone?: () => void;
	onClose: () => void;
}) {
	const [role, setRole] = useState<KinRole | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [count, setCount] = useState(1);
	const titleId = useId();
	const nameRef = useRef<HTMLInputElement>(null);

	// Escape closes from anywhere, including the canvas node that still holds focus.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	// Focus the name as soon as a role is picked: the role is the decision, the name is the
	// typing, and making somebody reach for the mouse between the two is the whole friction
	// this component removes.
	useEffect(() => {
		if (role) nameRef.current?.focus();
	}, [role]);

	async function submit(formData: FormData) {
		setPending(true);
		setError(null);
		formData.set("subjectId", subjectId);
		formData.set("role", String(role));
		formData.set("count", String(count));

		const result = await addRelative(formData);
		setPending(false);

		if (!result.ok) {
			setError(result.error);
			return;
		}
		onDone?.();
		onClose();
	}

	const batchable = role !== null && BATCHABLE.has(role);
	/**
	 * Whether to ask for gender at all.
	 *
	 * Only where the ROLE implies nothing. "Add father" already says male, so a picker there
	 * would be a field whose only use is to contradict the button just pressed -- and the
	 * action ignores a posted `sex` for those roles anyway, so it would be a control that
	 * appears to work and does not.
	 */
	const asksSex = role !== null && ROLE_SEX[role] === "unknown";

	return (
		<motion.div
			aria-labelledby={titleId}
			initial={{ opacity: 0, y: 8, scale: 0.98 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			exit={{ opacity: 0, y: 8, scale: 0.98 }}
			transition={{ type: "spring", stiffness: 380, damping: 30 }}
			className="kf-glass w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl"
		>
			<div className="flex items-start gap-2 border-b border-hairline px-3 pb-2.5 pt-3">
				<div className="min-w-0 flex-1">
					<h2
						id={titleId}
						className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint"
					>
						Add to
					</h2>
					{/* The subject, named. Without it this sheet is "Add father" with no answer to
					    "whose", which is how a father lands on the wrong person. */}
					<p className="truncate text-[0.875rem] font-medium text-ink">{subjectName}</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close"
					className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-raised hover:text-ink"
				>
					<X className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
				</button>
			</div>

			{role === null ? (
				<div className="max-h-[60vh] overflow-y-auto overscroll-contain p-2">
					{GROUPS.map((group) => (
						<div key={group.label} className="mb-2 last:mb-0">
							<p className="px-1.5 pb-1 font-mono text-[0.5625rem] uppercase tracking-wider text-ink-faint">
								{group.label}
							</p>
							<div className="flex flex-wrap gap-1">
								{group.roles.map((option) => (
									<button
										key={option.role}
										type="button"
										onClick={() => setRole(option.role)}
										className={cn(
											// 44px, because this is the primary control of the whole editor.
											"flex min-h-11 flex-1 items-center justify-center rounded-lg border px-3",
											"border-hairline bg-surface text-[0.8125rem] text-ink-muted",
											"transition-colors duration-(--duration-fast) ease-(--ease-out)",
											"hover:border-hairline-strong hover:bg-surface-raised hover:text-ink",
										)}
									>
										{option.label}
									</button>
								))}
							</div>
						</div>
					))}
				</div>
			) : (
				<form action={submit} className="p-3">
					<button
						type="button"
						onClick={() => {
							setRole(null);
							setError(null);
							setCount(1);
						}}
						className="mb-2 font-mono text-[0.625rem] uppercase tracking-wider text-accent-ink hover:underline"
					>
						{roleLabel(role)} -- change
					</button>

					{/*
					 * Four fields, and no more. The full record (places, occupation, provenance,
					 * contacts) belongs on the detail panel where there is room to read it -- asking
					 * for it here would put a twelve-field form in front of the one gesture that
					 * needs to stay fast.
					 */}
					<label className="block">
						<span className="sr-only">Name</span>
						<input
							ref={nameRef}
							name="givenName"
							placeholder={batchable && count > 1 ? "Surname only, for all of them" : "Name"}
							autoComplete="off"
							className={cn(
								"h-11 w-full rounded-lg border border-hairline bg-surface px-3",
								"text-[0.875rem] text-ink placeholder:text-ink-faint",
							)}
						/>
					</label>

					<div className="mt-2 flex gap-2">
						<label className="flex-1">
							<span className="sr-only">Family name</span>
							<input
								name="familyName"
								placeholder="Family name"
								autoComplete="off"
								className={cn(
									"h-11 w-full rounded-lg border border-hairline bg-surface px-3",
									"text-[0.875rem] text-ink placeholder:text-ink-faint",
								)}
							/>
						</label>
						<label className="w-24">
							<span className="sr-only">Birth year</span>
							{/* A YEAR, not a date. It is written to the fuzzy column, because coercing
							    "1952" into 1952-01-01 invents a birthday nobody recorded. */}
							<input
								name="birthYear"
								inputMode="numeric"
								placeholder="Year"
								autoComplete="off"
								disabled={count > 1}
								title={count > 1 ? "A batch cannot share one birth year" : undefined}
								className={cn(
									"tabular h-11 w-full rounded-lg border border-hairline bg-surface px-3",
									"text-[0.875rem] text-ink placeholder:text-ink-faint",
									count > 1 && "cursor-not-allowed opacity-40",
								)}
							/>
						</label>
					</div>

					{/*
					 * Gender, for the three roles that do not state one.
					 *
					 * Absent for father, mother, son, daughter, brother and sister: those words are
					 * themselves a statement about the person being added, and `addRelative` ignores
					 * a posted `sex` for them -- so drawing the field would be a control that looks
					 * like it works and does not.
					 */}
					{asksSex && (
						<fieldset className="mt-2">
							<legend className="mb-1 font-mono text-[0.5625rem] uppercase tracking-wider text-ink-faint">
								Gender
							</legend>
							<div className="flex overflow-hidden rounded-lg border border-hairline">
								{SEXES.map((option, index) => (
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
											name="sex"
											value={option.value}
											defaultChecked={option.value === "unknown"}
											className="sr-only"
										/>
										{option.label}
									</label>
								))}
							</div>
						</fieldset>
					)}

					{/* Living status, as a real tri-state. "unknown" is a stored value here, not a
					    missing one: most people in a genealogy have neither date recorded. */}
					<fieldset className="mt-2">
						<legend className="sr-only">Living status</legend>
						<div className="flex overflow-hidden rounded-lg border border-hairline">
							{(
								[
									["living", "Living"],
									["deceased", "Deceased"],
									["unknown", "Not known"],
								] as const
							).map(([value, label], index) => (
								<label
									key={value}
									className={cn(
										"flex min-h-11 flex-1 cursor-pointer items-center justify-center",
										"text-[0.75rem] text-ink-muted has-checked:bg-surface-raised",
										"has-checked:text-accent-ink",
										index > 0 && "border-l border-hairline",
									)}
								>
									<input
										type="radio"
										name="living"
										value={value}
										defaultChecked={value === "unknown"}
										className="sr-only"
									/>
									{label}
								</label>
							))}
						</div>
					</fieldset>

					{batchable && (
						<label className="mt-2 flex items-center gap-2">
							<span className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint">
								How many
							</span>
							{/*
							 * A batch creates numbered placeholders ("Son 1", "Son 2") for somebody to
							 * fill in later. "I have five children" is one fact, and entering it five
							 * times is five times the work for no extra information.
							 */}
							<input
								type="number"
								min={1}
								max={MAX_BATCH}
								value={count}
								onChange={(event) =>
									setCount(Math.max(1, Math.min(MAX_BATCH, Number(event.target.value) || 1)))
								}
								className="tabular h-11 w-16 rounded-lg border border-hairline bg-surface px-2 text-center text-[0.875rem] text-ink"
							/>
							{count > 1 && (
								<span className="text-[0.6875rem] leading-snug text-ink-faint">
									Adds {count} placeholders to name later
								</span>
							)}
						</label>
					)}

					{error && (
						<p role="alert" className="mt-2 text-[0.75rem] leading-snug text-danger">
							{error}
						</p>
					)}

					<button
						type="submit"
						disabled={pending}
						className={cn(
							"mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg",
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
						{pending ? "Adding" : `Add ${count > 1 ? `${count} ` : ""}${roleLabel(role, count)}`}
					</button>
				</form>
			)}
		</motion.div>
	);
}

function roleLabel(role: KinRole, count = 1): string {
	const singular = role.charAt(0).toUpperCase() + role.slice(1);
	if (count === 1) return singular;
	// Plurals a reader expects, rather than "Childs".
	const plural: Partial<Record<KinRole, string>> = {
		child: "Children",
		son: "Sons",
		daughter: "Daughters",
		brother: "Brothers",
		sister: "Sisters",
		sibling: "Siblings",
	};
	return plural[role] ?? `${singular}s`;
}

/**
 * The `+` that opens it, sized and placed to miss the fold chevrons.
 *
 * Those sit at each card's top and bottom CENTRE with 44px targets, so this goes to the
 * card's trailing edge -- the one side of a card that carries no control. Revealed on hover
 * like the chevrons, and always present for the selected card so a keyboard or touch user
 * has a way in without a pointer.
 */
export function QuickAddButton({
	onOpen,
	visible,
	className,
}: {
	onOpen: () => void;
	/** Forced visible for the selected card, which is how touch and keyboard reach it. */
	visible: boolean;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={(event) => {
				// The canvas would otherwise take this as a card click and re-pin the person.
				event.stopPropagation();
				onOpen();
			}}
			// React Flow starts a drag on pointerdown; without this, pressing the button drags
			// the card instead of firing the click.
			onPointerDown={(event) => event.stopPropagation()}
			aria-label="Add a relative"
			title="Add a relative"
			className={cn(
				"nodrag flex items-center justify-center rounded-full border border-hairline",
				"bg-surface-raised text-ink-faint shadow-(--kf-shadow-card)",
				"transition-all duration-(--duration-fast) ease-(--ease-out)",
				"hover:border-accent/50 hover:text-accent-ink focus-visible:opacity-100",
				visible ? "opacity-100" : "opacity-0 group-hover/node:opacity-100",
				className,
			)}
		>
			<Plus className="size-3" strokeWidth={2.5} aria-hidden="true" />
		</button>
	);
}

/** The sheet, mounted once by the canvas rather than per card. */
export function QuickAddSheet({
	subject,
	onDone,
	onClose,
}: {
	subject: { id: string; name: string } | null;
	onDone?: () => void;
	onClose: () => void;
}) {
	return (
		<AnimatePresence>
			{subject && (
				<div className="pointer-events-none absolute inset-0 z-50 flex items-end justify-center p-3 sm:items-center">
					<div className="pointer-events-auto">
						<QuickAdd
							key={subject.id}
							subjectId={subject.id}
							subjectName={subject.name}
							onDone={onDone}
							onClose={onClose}
						/>
					</div>
				</div>
			)}
		</AnimatePresence>
	);
}
