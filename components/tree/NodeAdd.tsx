"use client";

/**
 * Grow the family from the card itself: a `+` above, beside and below, and one small sheet.
 *
 * Replaces the old quick-add, which opened a picker of nine roles and then a form with a
 * surname, a year, a gender, a living status, a partnership status and a batch counter. The
 * canvas already says where a relative goes -- parents above, partners beside, children
 * below -- so the control's POSITION is the relationship, and the sheet only has to collect
 * what the picture cannot: a name, and which of the two gendered words is true.
 *
 * The controls are drawn for the VIEWED person only. One card wearing its `+` handles reads
 * as "this is who you are editing"; every card wearing them would be 350 buttons on a
 * 117-person tree, and on a phone there is no hover to reveal them on demand anyway.
 */
import { ViewportPortal } from "@xyflow/react";
import { GitBranch, Loader2, Mars, Plus, Venus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { addRelative } from "@/lib/tree/edit-actions";
import { type KinRole, ROLE_SEX, splitName } from "@/lib/tree/kin-plan";
import { type AddSlot, type AddTarget, hitBox } from "@/lib/tree/node-add";
import { cn } from "@/lib/utils";
import { useEscapeClose } from "./escape";

const ROLE_LABEL: Record<KinRole, string> = {
	father: "Father",
	mother: "Mother",
	partner: "Partner",
	husband: "Husband",
	wife: "Wife",
	son: "Son",
	daughter: "Daughter",
	child: "Child",
	brother: "Brother",
	sister: "Sister",
	sibling: "Sibling",
};

const HEADING: Record<AddTarget["direction"], string> = {
	parent: "Add a parent",
	partner: "Add a partner",
	child: "Add a child",
};

/**
 * The `+` handles, in the canvas's own coordinate space.
 *
 * A `ViewportPortal` rather than buttons inside the card: the shared couple `+` sits in the
 * gutter BETWEEN two cards, which no single card owns, and a portal pans and zooms with the
 * graph for free -- the same mechanism the generation rails use.
 *
 * Sized against the LIVE zoom, passed in as a number: everything in the viewport is scaled, so
 * a 44px target is 44 SCREEN pixels only if it is divided by the zoom it is about to be
 * multiplied by. A prop rather than the `--kf-zoom` CSS variable the fold chevrons read,
 * because the box is asymmetric (see `hitBox`) and that arithmetic is clearer in a pure
 * function than in nested `calc()`. Re-rendering on a wheel tick is cheap here: there are at
 * most five of these, where the reason the cards avoid it is that there are 117.
 */
export function NodeAddControls({
	slots,
	card,
	zoom,
	onOpen,
}: {
	slots: AddSlot[];
	/**
	 * The card box at the current detail level, which bounds every target, the gap between
	 * generations (a target must not cross it), and how far a side target may reach outward
	 * before it could touch the next household.
	 */
	card: { width: number; height: number; rowGap: number; pill: number; reach: number };
	zoom: number;
	onOpen: (target: AddTarget) => void;
}) {
	if (slots.length === 0) return null;

	return (
		<ViewportPortal>
			<div className="kf-node-add-layer">
				{slots.map((slot) => {
					const box = hitBox(slot, card, zoom);
					return (
						<button
							key={slot.key}
							type="button"
							aria-label={slot.label}
							title={slot.label}
							data-kind={slot.kind}
							className="kf-node-add nodrag nopan"
							style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
							onClick={(event) => {
								// The pane underneath would otherwise read this as a click on empty
								// canvas and clear the viewed person.
								event.stopPropagation();
								onOpen(slot.target);
							}}
							// React Flow starts a pan on pointerdown; without this, pressing the `+`
							// drags the canvas instead of firing the click.
							onPointerDown={(event) => event.stopPropagation()}
						>
							{/* The visible mark scales WITH the card, like the fold pills: a mark held
							    at a constant screen size is larger than a whole row-level card once
							    zoomed out. It sits on the card's edge, wherever the target reaches. */}
							<span
								className="kf-node-add__pill"
								style={{
									left: slot.x - box.left - card.pill / 2,
									top: slot.y - box.top - card.pill / 2,
									width: card.pill,
									height: card.pill,
								}}
							>
								<Plus aria-hidden="true" strokeWidth={2.5} />
							</span>
						</button>
					);
				})}
			</div>
		</ViewportPortal>
	);
}

/** The sheet, mounted once by the canvas. */
export function NodeAddSheet({
	target,
	onDone,
	onClose,
}: {
	target: AddTarget | null;
	/** Called after a successful write with the new row's id and the name as typed. */
	onDone: (added: { id?: string; name: string }) => void;
	onClose: () => void;
}) {
	return (
		<AnimatePresence>
			{target && (
				<div className="pointer-events-none absolute inset-0 z-50 flex items-end justify-center p-3 sm:items-center">
					<div className="pointer-events-auto">
						<AddForm
							key={`${target.subjectId}:${target.direction}:${target.unionId ?? ""}`}
							target={target}
							onDone={onDone}
							onClose={onClose}
						/>
					</div>
				</div>
			)}
		</AnimatePresence>
	);
}

function AddForm({
	target,
	onDone,
	onClose,
}: {
	target: AddTarget;
	onDone: (added: { id?: string; name: string }) => void;
	onClose: () => void;
}) {
	const titleId = useId();
	const nameId = useId();
	const yearId = useId();
	const nameRef = useRef<HTMLInputElement>(null);
	const yearRef = useRef<HTMLInputElement>(null);
	const firstRoleRef = useRef<HTMLButtonElement>(null);
	const firstChoiceRef = useRef<HTMLInputElement>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Through the shared stack (escape.ts): this sheet opens on top, so it closes first.
	useEscapeClose(true, onClose);

	// The name is the typing; focus it at once so a keyboard user never reaches for the mouse.
	useEffect(() => {
		nameRef.current?.focus();
	}, []);

	/**
	 * Enter walks the form instead of submitting it.
	 *
	 * A form's implicit submission presses its FIRST submit button, and here the buttons are
	 * the answer to "son or daughter". Letting Enter choose would save a daughter as a son
	 * for anybody who typed her name and pressed Enter -- a silent wrong fact. So Enter moves
	 * name -> year -> the choice, and the choice is always a deliberate press.
	 */
	const advance = (event: KeyboardEvent<HTMLInputElement>, next: () => void) => {
		if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
		event.preventDefault();
		next();
	};

	async function submit(form: HTMLFormElement, role: KinRole) {
		if (pending) return;
		const data = new FormData(form);
		const name = String(data.get("name") ?? "").trim();
		if (!name) {
			setError("Type their name first.");
			nameRef.current?.focus();
			return;
		}

		setPending(true);
		setError(null);
		data.set("subjectId", target.subjectId);
		data.set("role", role);
		if (target.unionId) data.set("unionId", target.unionId);
		/*
		 * The two columns as well as the one field, for a deploy in flight.
		 *
		 * Pages and the API publish independently, so for a few minutes this sheet can talk to
		 * the previous API, which reads only `givenName` / `familyName` -- and given only `name`
		 * it stored the numbered placeholder "Child 1" while the toast showed the typed name.
		 * The current API lets `name` win, so posting both is correct against either.
		 */
		const columns = splitName(name);
		if (columns.givenName) data.set("givenName", columns.givenName);
		if (columns.familyName) data.set("familyName", columns.familyName);

		try {
			const result = await addRelative(data);
			if (!result.ok) {
				setError(result.error);
				return;
			}
			onDone({ id: result.id, name });
			onClose();
		} catch {
			setError("Could not save that relative. Check your connection and try again.");
		} finally {
			setPending(false);
		}
	}

	return (
		<motion.div
			role="dialog"
			aria-modal="false"
			aria-labelledby={titleId}
			initial={{ opacity: 0, y: 8, scale: 0.98 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			exit={{ opacity: 0, y: 8, scale: 0.98 }}
			transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
			className="kf-glass kf-add-sheet w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl"
		>
			<div className="flex items-center gap-3 border-b border-hairline px-3 py-2.5">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent-ink">
					<GitBranch className="size-4" strokeWidth={1.75} aria-hidden="true" />
				</div>
				<div className="min-w-0 flex-1">
					<h2 id={titleId} className="text-[0.9375rem] font-medium leading-tight text-ink">
						{HEADING[target.direction]}
					</h2>
					{/* Whose relative, named: a sheet saying "Add a parent" with no name attached is
					    how a father lands on the wrong person. */}
					<p className="truncate text-[0.75rem] text-ink-muted">of {target.subjectName}</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close"
					className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-raised hover:text-ink"
				>
					<X className="size-4" strokeWidth={1.75} aria-hidden="true" />
				</button>
			</div>

			<form
				onSubmit={(event) => {
					event.preventDefault();
					const submitter = (event.nativeEvent as SubmitEvent)
						.submitter as HTMLButtonElement | null;
					const role = submitter?.value as KinRole | undefined;
					if (role && Object.hasOwn(ROLE_SEX, role)) void submit(event.currentTarget, role);
				}}
				aria-busy={pending}
				className="space-y-3 p-3"
			>
				<div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
					<div className="min-w-0">
						<label htmlFor={nameId} className="kf-add-label">
							Name
						</label>
						<input
							id={nameId}
							ref={nameRef}
							name="name"
							required
							maxLength={120}
							autoComplete="off"
							autoCapitalize="words"
							enterKeyHint="next"
							placeholder="Full name"
							onKeyDown={(event) => advance(event, () => yearRef.current?.focus())}
							className="kf-add-field"
						/>
					</div>
					<div>
						<label htmlFor={yearId} className="kf-add-label">
							Born <span className="font-normal text-ink-faint">year</span>
						</label>
						{/* A YEAR, optional. Written to the fuzzy column, because coercing "1952" into
						    1952-01-01 invents a birthday nobody recorded. It also orders siblings
						    eldest first on the canvas. */}
						<input
							id={yearId}
							ref={yearRef}
							name="birthYear"
							inputMode="numeric"
							maxLength={4}
							autoComplete="off"
							enterKeyHint="next"
							placeholder="Year"
							onKeyDown={(event) =>
								advance(event, () =>
									// A family still to choose comes before the answers.
									(firstChoiceRef.current ?? firstRoleRef.current)?.focus(),
								)
							}
							className="kf-add-field tabular"
						/>
					</div>
				</div>

				{/*
				 * Which family, when more than one qualifies -- and NOTHING pre-chosen.
				 *
				 * `planKin` refuses to guess between a birth and an adoptive family, and a default
				 * radio would make that guess for it on every submit. `required` blocks the answer
				 * buttons until one is picked, and Enter on a radio walks on rather than submitting,
				 * for the same reason Enter in the name field does.
				 */}
				{target.choices && target.choices.length > 1 && (
					<fieldset>
						<legend className="kf-add-label">Which family</legend>
						<div className="space-y-1">
							{target.choices.map((choice, index) => (
								<label
									key={choice.id}
									className={cn(
										"flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3",
										"text-[0.8125rem] text-ink-muted has-checked:border-accent/50 has-checked:text-accent-ink",
									)}
								>
									<input
										type="radio"
										name="unionId"
										ref={index === 0 ? firstChoiceRef : undefined}
										value={choice.id}
										required
										onKeyDown={(event) => {
											if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
											event.preventDefault();
											firstRoleRef.current?.focus();
										}}
										className="accent-(--color-accent)"
									/>
									<span className="min-w-0 truncate">{choice.label}</span>
								</label>
							))}
						</div>
					</fieldset>
				)}

				{error && (
					<p
						role="alert"
						className="rounded-md border border-danger/35 bg-danger/5 px-3 py-2 text-[0.75rem] leading-snug text-danger"
					>
						{error}
					</p>
				)}

				{/* The two answers ARE the submit buttons: one press records the role and the sex. */}
				<div className="grid grid-cols-2 gap-2">
					{target.roles.map((role, index) => {
						const Icon = ROLE_SEX[role] === "female" ? Venus : Mars;
						return (
							<button
								key={role}
								ref={index === 0 ? firstRoleRef : undefined}
								type="submit"
								name="role"
								value={role}
								disabled={pending}
								className="kf-add-role"
							>
								{pending ? (
									<Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
								) : (
									<Icon className="size-4" strokeWidth={2} aria-hidden="true" />
								)}
								{ROLE_LABEL[role]}
							</button>
						);
					})}
				</div>
			</form>
		</motion.div>
	);
}
