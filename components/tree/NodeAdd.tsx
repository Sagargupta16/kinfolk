"use client";

/**
 * Grow the family from the card itself: a `+` above, beside and below, and one small strip.
 *
 * Replaces the old quick-add, which opened a picker of nine roles and then a form with a
 * surname, a year, a gender, a living status, a partnership status and a batch counter. The
 * canvas already says where a relative goes -- parents above, partners beside, children
 * below -- so the control's POSITION is the relationship, and the strip only has to collect
 * what the picture cannot: a name, and which of the two gendered words is true.
 *
 * The controls are drawn for the VIEWED person only. One card wearing its `+` handles reads
 * as "this is who you are editing"; every card wearing them would be 350 buttons on a
 * 117-person tree, and on a phone there is no hover to reveal them on demand anyway.
 */
import { useStore, ViewportPortal } from "@xyflow/react";
import { Loader2, Mars, Plus, Venus } from "lucide-react";
import { motion } from "motion/react";
import {
	type CSSProperties,
	type KeyboardEvent,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { addRelative } from "@/lib/tree/edit-actions";
import { type KinRole, ROLE_SEX, splitName } from "@/lib/tree/kin-plan";
import { type AddSlot, type AddTarget, hitBox, shortSubject, stripSide } from "@/lib/tree/node-add";
import { cn } from "@/lib/utils";
import { NodeStrip, stripRow, useShake } from "./NodeStrip";

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

/** The handles' intro: the last ping (420ms + up to four 45ms steps + three 1.6s pings) ends inside it. */
const INTRO_MS = 5400;

const NOUN: Record<AddTarget["direction"], string> = {
	parent: "parent",
	partner: "partner",
	child: "child",
};

/**
 * The `+` handles, in the canvas's own coordinate space.
 *
 * A `ViewportPortal` rather than buttons inside the card: the shared couple `+` sits in the
 * gutter BETWEEN two cards, which no single card owns, and a portal pans and zooms with the
 * graph for free -- the same mechanism the generation rails use.
 *
 * Sized against the LIVE zoom, read from the store here: everything in the viewport is scaled,
 * so a 44px target is 44 SCREEN pixels only if it is divided by the zoom it is about to be
 * multiplied by. A number rather than the `--kf-zoom` CSS variable the fold chevrons read,
 * because the box is asymmetric (see `hitBox`) and that arithmetic is clearer in a pure
 * function than in nested `calc()`. Re-rendering on a wheel tick is cheap HERE: there are at
 * most five of these. Subscribed in this component rather than handed down by the canvas,
 * which re-rendered its whole tree once per zoom frame to pass the number along.
 *
 * The layer is keyed by the person, so choosing somebody new replays the handles' entrance:
 * they pop in one after another and ping a few times, which is how a person picked on a
 * phone learns where their relatives can go. The open `+` turns into a close mark.
 */
export function NodeAddControls({
	slots,
	card,
	openKey,
	onOpen,
}: {
	slots: AddSlot[];
	/**
	 * The card box at the current detail level, which bounds every target, the gap between
	 * generations (a target must not cross it), and how far a side target may reach outward
	 * before it could touch the next household.
	 */
	card: { width: number; height: number; rowGap: number; pill: number; reach: number };
	/** The slot whose strip is open, which wears the close mark. */
	openKey?: string | null;
	onOpen: (slot: AddSlot) => void;
}) {
	const zoom = useStore((state) => state.transform[2]);
	const subject = slots[0]?.target.subjectId;

	/*
	 * The entrance and the pings belong to PICKING somebody, not to every remount. A write
	 * relays the canvas out and remounts these buttons, and replaying the invitation then
	 * competed with the new relative's arrival in the very frames the eye is following it. So
	 * they run inside a window opened when the subject changes; a remount outside it simply
	 * appears. Set before paint, so the first frame of a new pick already animates.
	 */
	const [intro, setIntro] = useState<string | null>(null);
	const introduced = useRef<string | undefined>(undefined);
	useLayoutEffect(() => {
		if (!subject || subject === introduced.current) return;
		introduced.current = subject;
		setIntro(subject);
	}, [subject]);
	useEffect(() => {
		if (!intro) return;
		const timer = window.setTimeout(() => setIntro(null), INTRO_MS);
		return () => window.clearTimeout(timer);
	}, [intro]);

	if (slots.length === 0) return null;

	return (
		<ViewportPortal>
			<div
				key={subject}
				className={cn("kf-node-add-layer", intro === subject && "kf-node-add-layer--intro")}
			>
				{slots.map((slot, index) => {
					const box = hitBox(slot, card, zoom);
					const open = slot.key === openKey;
					return (
						<button
							key={slot.key}
							type="button"
							aria-label={open ? `Close: ${slot.label}` : slot.label}
							aria-expanded={open}
							title={slot.label}
							data-kind={slot.kind}
							className="kf-node-add nodrag nopan"
							style={
								{
									left: box.left,
									top: box.top,
									width: box.width,
									height: box.height,
									"--kf-i": index,
								} as CSSProperties
							}
							onClick={(event) => {
								// The pane underneath would otherwise read this as a click on empty
								// canvas and clear the viewed person.
								event.stopPropagation();
								onOpen(slot);
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

/** The add strip, grown out of the `+` that opened it. Mounted by the canvas. */
export function NodeAddStrip({
	slot,
	onDone,
	onFailed,
	onClose,
}: {
	slot: AddSlot;
	/** Called after a successful write with the new row's id and the name as typed. */
	onDone: (added: { id?: string; name: string }) => void;
	/** A failure that arrived after the strip was closed, for the canvas to report. */
	onFailed?: (message: string) => void;
	onClose: () => void;
}) {
	return (
		<NodeStrip
			anchor={{ x: slot.x, y: slot.y }}
			side={stripSide(slot)}
			label={slot.label}
			onClose={onClose}
		>
			<AddForm
				key={`${slot.target.subjectId}:${slot.key}`}
				target={slot.target}
				onDone={onDone}
				onFailed={onFailed}
				onClose={onClose}
			/>
		</NodeStrip>
	);
}

function AddForm({
	target,
	onDone,
	onFailed,
	onClose,
}: {
	target: AddTarget;
	onDone: (added: { id?: string; name: string }) => void;
	onFailed?: (message: string) => void;
	onClose: () => void;
}) {
	const nameId = useId();
	const yearId = useId();
	const nameRef = useRef<HTMLInputElement>(null);
	const yearRef = useRef<HTMLInputElement>(null);
	const firstRoleRef = useRef<HTMLButtonElement>(null);
	const firstChoiceRef = useRef<HTMLInputElement>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<{ text: string; at: number } | null>(null);
	const shake = useShake<HTMLFormElement>(error?.at);
	/*
	 * Whether the strip is still open when a write settles. A tap on the canvas, a new pick
	 * or Escape can close it mid-write, and an error stored in this unmounted form would be
	 * shown nowhere -- so a late failure goes to the canvas, which reports it as a toast.
	 */
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
			setError({ text: "Type their name first.", at: Date.now() });
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
		 * Pages and the API publish independently, so for a few minutes this strip can talk to
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
				fail(result.error);
				return;
			}
			onDone({ id: result.id, name });
			onClose();
		} catch {
			fail("Could not save that relative. Check your connection and try again.");
		} finally {
			if (mounted.current) setPending(false);
		}
	}

	return (
		<form
			ref={shake}
			onSubmit={(event) => {
				event.preventDefault();
				const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
				const role = submitter?.value as KinRole | undefined;
				if (role && Object.hasOwn(ROLE_SEX, role)) void submit(event.currentTarget, role);
			}}
			aria-busy={pending}
			className="space-y-2 p-2"
		>
			<motion.div variants={stripRow} className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
				{/* Labels for assistive technology; the placeholder carries them on screen, which
				    is what lets the strip have no label row at all. */}
				<label htmlFor={nameId} className="sr-only">
					Name of {target.subjectName}'s {NOUN[target.direction]}
				</label>
				<input
					id={nameId}
					ref={nameRef}
					// The name is the typing: the strip focuses this as soon as it is on screen, so
					// a keyboard user never reaches for the mouse.
					data-autofocus=""
					name="name"
					required
					maxLength={120}
					autoComplete="off"
					autoCapitalize="words"
					enterKeyHint="next"
					// "Morgan and Alex's child": whose relative, short enough for a phone. Measured: the
					// longer "Name of ..." form was cut off in both the desktop and the docked strip.
					placeholder={`${shortSubject(target.subjectName)}'s ${NOUN[target.direction]}`}
					onKeyDown={(event) => advance(event, () => yearRef.current?.focus())}
					className="kf-add-field"
				/>
				<label htmlFor={yearId} className="sr-only">
					Year born, optional
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
					placeholder="Born"
					onKeyDown={(event) =>
						advance(event, () =>
							// A family still to choose comes before the answers.
							(firstChoiceRef.current ?? firstRoleRef.current)?.focus(),
						)
					}
					className="kf-add-field tabular"
				/>
			</motion.div>

			{/*
			 * Which family, when more than one qualifies -- and NOTHING pre-chosen.
			 *
			 * `planKin` refuses to guess between a birth and an adoptive family, and a default
			 * radio would make that guess for it on every submit. `required` blocks the answer
			 * buttons until one is picked, and Enter on a radio walks on rather than submitting,
			 * for the same reason Enter in the name field does.
			 */}
			{target.choices && target.choices.length > 1 && (
				<motion.fieldset variants={stripRow}>
					<legend className="sr-only">Which family</legend>
					<div className="space-y-1">
						{target.choices.map((choice, index) => (
							<label
								key={choice.id}
								className={cn(
									"flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3 py-1.5",
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
								{/* Wrapped, never truncated: the words that tell two families apart --
								    "(adoptive)", "with Casey", "(1 of 2)" -- come last, so a truncated
								    label reads the same as its neighbour. */}
								<span className="min-w-0 break-words leading-snug">{choice.label}</span>
							</label>
						))}
					</div>
				</motion.fieldset>
			)}

			{error && (
				<p role="alert" className="px-1 text-[0.75rem] leading-snug text-danger">
					{error.text}
				</p>
			)}

			{/* The two answers ARE the submit buttons: one press records the role and the sex. */}
			<motion.div variants={stripRow} className="grid grid-cols-2 gap-2">
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
			</motion.div>
		</form>
	);
}
