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
import {
	ArrowLeft,
	Baby,
	Check,
	GitBranch,
	Heart,
	Loader2,
	Minus,
	Plus,
	UserRound,
	Users,
	X,
} from "lucide-react";
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
const GROUPS: {
	label: string;
	Icon: typeof UserRound;
	roles: { role: KinRole; label: string }[];
}[] = [
	{
		label: "Parents",
		Icon: UserRound,
		roles: [
			{ role: "father", label: "Father" },
			{ role: "mother", label: "Mother" },
		],
	},
	{
		label: "Partner",
		Icon: Heart,
		roles: [{ role: "partner", label: "Partner" }],
	},
	{
		label: "Children",
		Icon: Baby,
		roles: [
			{ role: "son", label: "Son" },
			{ role: "daughter", label: "Daughter" },
			{ role: "child", label: "Child" },
		],
	},
	{
		label: "Siblings",
		Icon: Users,
		roles: [
			{ role: "brother", label: "Brother" },
			{ role: "sister", label: "Sister" },
			{ role: "sibling", label: "Sibling" },
		],
	},
];

/** Roles a batch makes sense for: you can have five children, not five fathers. */
const BATCHABLE = new Set<KinRole>(["son", "daughter", "child", "brother", "sister", "sibling"]);

const field = cn(
	"min-h-11 w-full rounded-lg border border-hairline bg-surface px-3 text-[0.875rem] text-ink",
	"placeholder:text-ink-faint transition-colors duration-(--duration-fast) ease-(--ease-out)",
	"focus:border-hairline-strong focus:outline-none",
);

const fieldLabel = "mb-1.5 block text-[0.6875rem] font-medium text-ink-muted";

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
			role="dialog"
			aria-modal="false"
			aria-labelledby={titleId}
			initial={{ opacity: 0, y: 8, scale: 0.98 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			exit={{ opacity: 0, y: 8, scale: 0.98 }}
			transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
			className="kf-glass w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg"
		>
			<div className="flex items-center gap-3 border-b border-hairline px-3 py-3">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent-ink">
					<GitBranch className="size-4" strokeWidth={1.75} aria-hidden="true" />
				</div>
				<div className="min-w-0 flex-1">
					<p className="font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-ink-faint">
						New family connection
					</p>
					{/* The subject, named. Without it this sheet is "Add father" with no answer to
					    "whose", which is how a father lands on the wrong person. */}
					<h2 id={titleId} className="truncate text-[0.9375rem] font-medium text-ink">
						Add to {subjectName}
					</h2>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close add relative"
					className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-raised hover:text-ink"
				>
					<X className="size-4" strokeWidth={1.75} aria-hidden="true" />
				</button>
			</div>

			{role === null ? (
				<div className="max-h-[min(70dvh,34rem)] overflow-y-auto overscroll-contain p-3">
					<p className="mb-3 text-[0.75rem] leading-relaxed text-ink-muted">
						Who are you adding to this branch?
					</p>
					{GROUPS.map(({ label, roles, Icon }) => (
						<section key={label} className="mb-3 last:mb-0">
							<h3 className="mb-1.5 flex items-center gap-1.5 font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-ink-faint">
								<Icon className="size-3" strokeWidth={1.5} aria-hidden="true" />
								{label}
							</h3>
							<div
								className={cn(
									"grid gap-1.5",
									roles.length === 1
										? "grid-cols-1"
										: roles.length === 2
											? "grid-cols-2"
											: "grid-cols-3",
								)}
							>
								{roles.map((option) => (
									<button
										key={option.role}
										type="button"
										onClick={() => setRole(option.role)}
										className={cn(
											// 44px, because this is the primary control of the whole editor.
											"flex min-h-11 items-center justify-center rounded-lg border px-2",
											"border-hairline bg-surface text-[0.75rem] font-medium text-ink-muted",
											"transition-colors duration-(--duration-fast) ease-(--ease-out)",
											"hover:border-accent/40 hover:bg-accent/8 hover:text-accent-ink",
										)}
									>
										{option.label}
									</button>
								))}
							</div>
						</section>
					))}
				</div>
			) : (
				<form
					action={submit}
					className="max-h-[min(70dvh,36rem)] overflow-y-auto overscroll-contain p-3"
				>
					<button
						type="button"
						onClick={() => {
							setRole(null);
							setError(null);
							setCount(1);
						}}
						className="mb-3 flex min-h-11 items-center gap-2 rounded-md pr-2 text-[0.75rem] font-medium text-accent-ink hover:text-accent"
					>
						<ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
						Change relationship
					</button>

					<div className="mb-3 flex items-baseline justify-between gap-3 border-b border-hairline pb-3">
						<div>
							<p className="font-mono text-[0.5625rem] uppercase tracking-[0.14em] text-ink-faint">
								Adding
							</p>
							<p className="text-base font-medium text-ink">{roleLabel(role)}</p>
						</div>
						<p className="min-w-0 truncate text-[0.6875rem] text-ink-muted">to {subjectName}</p>
					</div>

					{batchable && (
						<fieldset className="mb-3">
							<legend className={fieldLabel}>People to add</legend>
							<div className="flex items-center gap-2">
								<div className="flex items-center overflow-hidden rounded-lg border border-hairline bg-surface">
									<button
										type="button"
										onClick={() => setCount((current) => Math.max(1, current - 1))}
										disabled={count === 1}
										aria-label="Add one fewer person"
										className="flex size-11 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
									>
										<Minus className="size-3.5" strokeWidth={2} aria-hidden="true" />
									</button>
									<output
										aria-live="polite"
										className="tabular w-8 text-center text-[0.875rem] font-medium text-ink"
									>
										{count}
									</output>
									<button
										type="button"
										onClick={() => setCount((current) => Math.min(MAX_BATCH, current + 1))}
										disabled={count === MAX_BATCH}
										aria-label="Add one more person"
										className="flex size-11 items-center justify-center text-ink-muted hover:bg-surface-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
									>
										<Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
									</button>
								</div>
								<span className="text-[0.6875rem] leading-snug text-ink-faint">
									{count === 1 ? "person" : "numbered people to name later"}
								</span>
							</div>
						</fieldset>
					)}

					{/*
					 * Four fields, and no more. The full record (places, occupation, provenance,
					 * contacts) belongs on the detail panel where there is room to read it -- asking
					 * for it here would put a twelve-field form in front of the one gesture that
					 * needs to stay fast.
					 */}
					<label className="block">
						<span className={fieldLabel}>
							Given name <span className="font-normal text-ink-faint">(optional)</span>
						</span>
						<input
							ref={nameRef}
							name="givenName"
							placeholder={count > 1 ? "Numbered automatically" : "First or preferred name"}
							autoComplete="off"
							disabled={count > 1}
							className={cn(field, count > 1 && "cursor-not-allowed opacity-45")}
						/>
					</label>

					<div className="mt-3 grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
						<label className="min-w-0">
							<span className={fieldLabel}>
								Family name <span className="font-normal text-ink-faint">(optional)</span>
							</span>
							<input name="familyName" placeholder="Surname" autoComplete="off" className={field} />
						</label>
						<label>
							<span className={fieldLabel}>Birth year</span>
							{/* A YEAR, not a date. It is written to the fuzzy column, because coercing
							    "1952" into 1952-01-01 invents a birthday nobody recorded. */}
							<input
								name="birthYear"
								inputMode="numeric"
								placeholder="Year"
								autoComplete="off"
								disabled={count > 1}
								title={count > 1 ? "A batch cannot share one birth year" : undefined}
								className={cn(field, "tabular", count > 1 && "cursor-not-allowed opacity-40")}
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
						<fieldset className="mt-3">
							<legend className={fieldLabel}>Gender</legend>
							<div className="flex overflow-hidden rounded-lg border border-hairline">
								{SEXES.map((option, index) => (
									<label
										key={option.value}
										className={cn(
											"flex min-h-11 flex-1 cursor-pointer items-center justify-center px-1",
											"text-center text-[0.6875rem] text-ink-muted",
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
					<fieldset className="mt-3">
						<legend className={fieldLabel}>Living status</legend>
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

					{error && (
						<p
							role="alert"
							className="mt-3 rounded-md border border-danger/35 bg-danger/5 px-3 py-2 text-[0.75rem] leading-snug text-danger"
						>
							{error}
						</p>
					)}

					<button
						type="submit"
						disabled={pending}
						className={cn(
							"mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg",
							"bg-ink text-[0.8125rem] font-medium text-canvas",
							"transition-transform duration-(--duration-fast) ease-(--ease-out)",
							"hover:-translate-y-px active:translate-y-0 disabled:cursor-wait disabled:opacity-60",
						)}
					>
						{pending ? (
							<Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
						) : (
							<Check className="size-4" strokeWidth={2} aria-hidden="true" />
						)}
						{pending ? "Adding..." : `Add ${count > 1 ? `${count} ` : ""}${roleLabel(role, count)}`}
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
				"nodrag relative flex items-center justify-center rounded-full border border-hairline",
				"before:absolute before:-inset-2.5 before:content-['']",
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
