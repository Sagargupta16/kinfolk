"use client";

/**
 * The editor. Until now the canvas was read-only and there was no way to add anything,
 * which made "no option to add a relation" the correct observation rather than a bug.
 *
 * Shaped as a node-graph editor rather than a form page, because that is what the data
 * is: you pick a node, then say what connects it to another node. A wizard would have to
 * impose an order on a graph that has none -- there is no "step 1" in a family, and the
 * first thing most people want to add is a parent, which a top-down form makes hardest.
 *
 * Three deliberate choices:
 *
 *   1. It is a docked SHEET, not a modal. Adding a relation means naming two people, and
 *      a modal covering the canvas hides the very cards you are trying to identify. The
 *      sheet takes one edge of the screen and the graph keeps the rest.
 *   2. Selecting a card on the canvas fills the "from" field. Typing a name you can see
 *      on screen is work the canvas can do for you, and it is the whole reason the panel
 *      lives beside the graph instead of on its own route.
 *   3. Every write is a server action from lib/tree/edit-actions.ts. Nothing here decides
 *      what is allowed; it only reports what the server refused.
 */
import { Baby, Link2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useEffect, useId, useState, useTransition } from "react";
import { addChild, addRelation, addUnion, type Result, removeChild } from "@/lib/tree/edit-actions";
import type { UnionWithChildren } from "@/lib/tree/graph";
import { kindsByCategory, RELATION_KINDS } from "@/lib/tree/relations";
import { cn } from "@/lib/utils";
import { useEscapeClose } from "./escape";

/** A person the pickers can offer. Names only -- see `editablePeople()`. */
export type PickablePerson = { id: string; name: string };

type Tab = "relation" | "partnership" | "child";

const TABS: { value: Tab; label: string; Icon: typeof Plus }[] = [
	{ value: "relation", label: "Connections", Icon: Link2 },
	{ value: "partnership", label: "Partners", Icon: Plus },
	{ value: "child", label: "Children", Icon: Baby },
];

/** Grouped so the picker shows 17 kinds as five short lists rather than one long one. */
const GROUPED = kindsByCategory();
const CATEGORY_LABELS: Record<keyof typeof GROUPED, string> = {
	kin: "Extended kin",
	social: "Social",
	professional: "Professional",
	care: "Care",
	other: "Unspecified",
};

const field = cn(
	"min-h-11 w-full rounded-md border border-hairline bg-canvas px-2.5 text-sm text-ink",
	"transition-colors duration-(--duration-fast) ease-(--ease-out)",
	"focus:border-hairline-strong focus:outline-none",
);

const label = "mb-1 block text-xs font-medium text-ink-muted";

/**
 * One labelled field. The control is a render prop handed the generated id, because
 * `htmlFor` must point at the CONTROL element: the previous shape wrapped children in
 * a `<div id>`, which satisfies no association at all -- clicking any label focused
 * nothing, on every field in this panel.
 */
function Labelled({ text, children }: { text: string; children: (id: string) => React.ReactNode }) {
	const id = useId();
	return (
		<div>
			<label className={label} htmlFor={id}>
				{text}
			</label>
			{children(id)}
		</div>
	);
}

export function EditorPanel({
	people,
	unions,
	/** The card most recently selected on the canvas, pre-filling the "from" side. */
	selectedId,
	selectedName,
	open,
	onClose,
}: {
	people: PickablePerson[];
	unions: UnionWithChildren[];
	selectedId?: string | null;
	selectedName?: string | null;
	open: boolean;
	onClose: () => void;
}) {
	const router = useRouter();
	const [tab, setTab] = useState<Tab>("relation");
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	const [confirmAdditional, setConfirmAdditional] = useState(false);
	const [pending, startTransition] = useTransition();

	// The "from" person, seeded from the canvas selection but overridable: clicking a card
	// is a shortcut, not a constraint, and the person you want may be off screen.
	const [fromId, setFromId] = useState<string>("");
	const [unionId, setUnionId] = useState("");
	const selectedUnion = unions.find((union) => union.id === unionId);
	const fromName =
		fromId === selectedId ? selectedName : people.find((person) => person.id === fromId)?.name;
	const eligibleChildren = people.filter(
		(person) =>
			selectedUnion &&
			person.id !== selectedUnion.partnerAId &&
			person.id !== selectedUnion.partnerBId &&
			!selectedUnion.childIds.includes(person.id),
	);
	useEffect(() => {
		if (!open) return;
		// Clearing the canvas selection must clear the shortcut too. Keeping the last
		// id here made a freshly opened relation form silently point at yesterday's
		// person after the user had explicitly clicked the empty pane.
		setFromId(selectedId ?? "");
		setUnionId("");
		setMessage(null);
		setConfirmAdditional(false);
	}, [open, selectedId]);

	/**
	 * Escape closes. Deliberately not a focus trap: the panel is docked, not modal, and
	 * trapping focus would make the canvas behind it unreachable by keyboard -- which is
	 * the one thing this layout exists to keep available. In the shared surface stack
	 * (escape.ts), and only while open, so a closed editor cannot swallow the press.
	 */
	useEscapeClose(open, onClose);

	function submit(action: (form: FormData) => Promise<Result>) {
		return (event: SubmitEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (pending) return;
			const element = event.currentTarget;
			const form = new FormData(element);
			setMessage(null);
			startTransition(async () => {
				try {
					const result = await action(form);
					setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
					if (result.ok) {
						element.reset();
						router.refresh();
					}
				} catch {
					setMessage({ ok: false, text: "Could not save that. Try again." });
				}
			});
		};
	}

	function submitRelation(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		if (pending) return;
		const element = event.currentTarget;
		const form = new FormData(element);
		setMessage(null);
		startTransition(async () => {
			try {
				const result = await addRelation(form);
				if (!result.ok && result.confirmation === "additional-relation") {
					setConfirmAdditional(true);
					setMessage({ ok: false, text: result.error });
					return;
				}
				setConfirmAdditional(false);
				setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
				if (result.ok) {
					element.reset();
					router.refresh();
				}
			} catch {
				setMessage({ ok: false, text: "Could not save that connection. Try again." });
			}
		});
	}

	if (!open) return null;

	return (
		<div
			className={cn(
				"kf-sheet kf-editor-sheet pointer-events-auto absolute left-3 top-3 z-40 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col",
				// Opaque: these are 10px labels read against whatever cards sit behind, and a
				// translucent surface puts a name through the middle of a field.
				"max-h-[calc(100%-1.5rem)] overflow-hidden rounded-2xl border border-hairline-strong",
				"bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
			)}
		>
			<header className="kf-sheet-header flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
				<h2 className="min-w-0 flex-1 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
					{/*
					 * Names the picked card, so the shortcut is visible rather than silent.
					 * Clicking a person fills the "from" select, and without saying so the
					 * field appears to change on its own -- which reads as a bug, not a
					 * convenience.
					 */}
					{fromName ? (
						<>
							From <span className="text-accent">{fromName}</span>
						</>
					) : (
						"Connect people"
					)}
				</h2>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close the editor"
					className="flex size-11 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
				>
					<X aria-hidden className="size-4" strokeWidth={1.5} />
				</button>
			</header>

			<fieldset aria-label="What to add" className="flex shrink-0 border-b border-hairline">
				{TABS.map(({ value, label: text, Icon }) => (
					<button
						key={value}
						type="button"
						disabled={pending}
						onClick={() => {
							setTab(value);
							setMessage(null);
							setConfirmAdditional(false);
						}}
						aria-pressed={tab === value}
						className={cn(
							"flex min-h-11 flex-1 items-center justify-center gap-1.5 border-r border-hairline",
							"font-mono text-[0.625rem] uppercase tracking-wider last:border-r-0",
							"transition-colors duration-(--duration-fast) ease-(--ease-out)",
							tab === value
								? "bg-surface-raised text-accent"
								: "text-ink-faint hover:bg-surface-raised hover:text-ink",
						)}
					>
						<Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.5} />
						{text}
					</button>
				))}
			</fieldset>

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
				{tab === "relation" && (
					<form
						onSubmit={submitRelation}
						aria-busy={pending}
						onChange={() => {
							if (!confirmAdditional) return;
							setConfirmAdditional(false);
							setMessage(null);
						}}
						className="space-y-3"
					>
						{confirmAdditional && <input type="hidden" name="confirmAdditional" value="true" />}
						<Labelled text="From">
							{(id) => (
								<PersonSelect
									id={id}
									name="personAId"
									people={people}
									value={fromId}
									onChange={setFromId}
								/>
							)}
						</Labelled>

						<Labelled text="Is the...">
							{(id) => (
								<select id={id} name="kind" className={field} defaultValue="friend">
									{(Object.keys(GROUPED) as (keyof typeof GROUPED)[]).map((category) =>
										GROUPED[category].length === 0 ? null : (
											<optgroup key={category} label={CATEGORY_LABELS[category]}>
												{GROUPED[category].map((kind) => (
													<option key={kind} value={kind}>
														{RELATION_KINDS[kind].label}
													</option>
												))}
											</optgroup>
										),
									)}
								</select>
							)}
						</Labelled>

						<Labelled text="Of">
							{(id) => (
								<PersonSelect
									key={fromId}
									id={id}
									name="personBId"
									people={people}
									exclude={fromId}
								/>
							)}
						</Labelled>

						<Labelled text="How close">
							{/* Blank means "use the kind's default", which is not the same as 1 --
							    it lets the default improve later without rewriting stored rows. */}
							{(id) => (
								<select id={id} name="closeness" className={field} defaultValue="">
									<option value="">Use the default for this kind</option>
									<option value="1">Acquaintance</option>
									<option value="2">Close</option>
									<option value="3">Very close</option>
								</select>
							)}
						</Labelled>

						<Labelled text="Ended">
							{(id) => <input id={id} type="date" name="endDate" className={field} />}
						</Labelled>

						<p className="text-[0.625rem] leading-snug text-ink-faint">
							Choose the relationship from the first person's point of view. For example, Alex is
							the mentor of Jordan.
						</p>

						<Submit
							pending={pending}
							text={confirmAdditional ? "Confirm separate connection" : "Connect them"}
						/>
					</form>
				)}

				{tab === "partnership" && (
					<form onSubmit={submit(addUnion)} aria-busy={pending} className="space-y-3">
						<Labelled text="Partner">
							{(id) => (
								<PersonSelect
									id={id}
									name="partnerAId"
									people={people}
									value={fromId}
									onChange={setFromId}
								/>
							)}
						</Labelled>

						<Labelled text="And">
							{/* Optional on purpose: a single parent still forms a union, which is what
							    lets parentage hang off the partnership instead of a parent pair. */}
							{(id) => (
								<PersonSelect
									key={fromId}
									id={id}
									name="partnerBId"
									people={people}
									exclude={fromId}
									allowEmpty="Nobody recorded"
									required={false}
								/>
							)}
						</Labelled>

						<Labelled text="Status">
							{(id) => (
								<select id={id} name="status" className={field} defaultValue="unknown">
									<option value="married">Married</option>
									<option value="partnered">Partnered</option>
									<option value="separated">Separated</option>
									<option value="divorced">Divorced</option>
									<option value="widowed">Widowed</option>
									<option value="unknown">Not recorded</option>
								</select>
							)}
						</Labelled>

						<p className="text-[0.625rem] leading-snug text-ink-faint">
							Choose the two people, or leave the second person blank for a single-parent family.
							Add their children from the Children tab.
						</p>

						<Submit pending={pending} text="Record partnership" />
					</form>
				)}

				{tab === "child" && (
					<div className="space-y-4">
						{unions.length === 0 ? (
							<div className="space-y-3">
								<p className="text-sm leading-relaxed text-ink-muted">
									Record the parents first, then connect an existing child. A family can have one
									parent or two.
								</p>
								<button
									type="button"
									className="min-h-11 rounded-md border border-hairline px-3 text-sm text-ink"
									onClick={() => setTab("partnership")}
								>
									Record parents
								</button>
							</div>
						) : (
							<form onSubmit={submit(addChild)} aria-busy={pending} className="space-y-3">
								<Labelled text="Parenting family">
									{(id) => (
										<select
											id={id}
											name="unionId"
											required
											value={unionId}
											onChange={(event) => setUnionId(event.target.value)}
											className={field}
										>
											<option value="">Choose a partnership</option>
											{unions.map((union) => (
												<option key={union.id} value={union.id}>
													{[union.partnerAId, union.partnerBId]
														.filter(Boolean)
														.map(
															(personId) =>
																people.find((person) => person.id === personId)?.name ??
																"Unknown parent",
														)
														.join(" + ") || "No parents recorded"}
													{` · ${union.status}${union.startDate ? ` · ${union.startDate.slice(0, 4)}` : ""} · ${union.childIds.length} ${union.childIds.length === 1 ? "child" : "children"}`}
												</option>
											))}
										</select>
									)}
								</Labelled>
								<Labelled text="Existing child">
									{(id) => (
										<select
											key={unionId}
											id={id}
											name="childId"
											required
											disabled={!selectedUnion || eligibleChildren.length === 0}
											defaultValue=""
											className={field}
										>
											<option value="">Choose a person</option>
											{eligibleChildren.map((person) => (
												<option key={person.id} value={person.id}>
													{person.name}
												</option>
											))}
										</select>
									)}
								</Labelled>
								<Labelled text="Parent role">
									{(id) => (
										<select
											key={unionId}
											id={id}
											name="role"
											className={field}
											defaultValue="biological"
										>
											<option value="biological">Biological</option>
											<option value="adoptive">Adoptive</option>
											<option value="step">Step</option>
											<option value="foster">Foster</option>
											<option value="guardian">Guardian</option>
										</select>
									)}
								</Labelled>
								<p className="text-xs leading-relaxed text-ink-faint">
									{selectedUnion && eligibleChildren.length === 0
										? "Everyone here is already recorded as a parent or child in this family. Add a new person from a profile."
										: "Connect a person already recorded in this family. Their profile stays intact."}
								</p>
								<Submit
									pending={pending}
									disabled={!selectedUnion || eligibleChildren.length === 0}
									text="Attach child"
								/>
							</form>
						)}
						{selectedUnion && selectedUnion.childIds.length > 0 && (
							<section className="space-y-2 border-t border-hairline pt-3">
								<h3 className={label}>Recorded children</h3>
								{selectedUnion.childIds.map((childId) => (
									<details key={childId} className="rounded-md border border-hairline px-2.5">
										<summary className="min-h-11 cursor-pointer py-3 text-xs">
											{people.find((person) => person.id === childId)?.name ?? "Child"}
											<span className="text-ink-faint">
												{" "}
												· {selectedUnion.childRoles?.[childId]?.join(" / ") ?? "biological"}
											</span>
										</summary>
										<form
											onSubmit={submit(removeChild)}
											aria-busy={pending}
											className="space-y-2 pb-3"
										>
											<input type="hidden" name="unionId" value={selectedUnion.id} />
											<input type="hidden" name="childId" value={childId} />
											<p className="text-xs leading-relaxed text-ink-muted">
												Remove this parenting connection? The child's record and other family
												connections will remain.
											</p>
											<button
												type="submit"
												disabled={pending}
												className="min-h-11 text-xs text-danger"
											>
												Remove connection
											</button>
										</form>
									</details>
								))}
							</section>
						)}
					</div>
				)}

				{message && (
					<p
						role={message.ok ? "status" : "alert"}
						className={cn(
							"mt-3 rounded-md border px-2.5 py-2 text-xs leading-relaxed",
							message.ok
								? "border-hairline bg-canvas text-ink-muted"
								: "border-accent-dim bg-canvas text-ink",
						)}
					>
						{message.text}
					</p>
				)}
			</div>
		</div>
	);
}

function Submit({
	pending,
	disabled = false,
	text,
}: {
	pending: boolean;
	disabled?: boolean;
	text: string;
}) {
	return (
		<button
			type="submit"
			disabled={pending || disabled}
			className={cn(
				"flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4",
				"text-sm font-medium text-canvas transition-transform",
				"duration-(--duration-fast) ease-(--ease-out)",
				"hover:-translate-y-px active:translate-y-0 disabled:opacity-60",
			)}
		>
			{pending ? "Saving..." : text}
		</button>
	);
}

/**
 * A person picker.
 *
 * A native `<select>` rather than a combobox, and that is a real trade-off: a combobox
 * would filter by typing, which matters at a few hundred people. But a select is
 * keyboard accessible, works on a phone with the platform's own wheel, and needs no
 * listbox ARIA to get wrong. The graph also has search already, and the canvas selection
 * fills this field, so typing a name is the fallback path rather than the main one.
 */
function PersonSelect({
	id,
	name,
	people,
	value,
	onChange,
	exclude,
	allowEmpty = "Pick somebody",
	required = true,
}: {
	/** From the surrounding `Labelled`, so its label actually focuses this select. */
	id?: string;
	name: string;
	people: PickablePerson[];
	value?: string;
	onChange?: (id: string) => void;
	/** Hidden from the list, so a relation cannot be built to the same person. */
	exclude?: string;
	allowEmpty?: string;
	required?: boolean;
}) {
	const options = people.filter((person) => person.id !== exclude);

	return (
		<select
			id={id}
			name={name}
			required={required}
			className={field}
			// Controlled only when the parent tracks it. An uncontrolled select with a
			// `value` and no `onChange` is frozen, so the two travel together.
			{...(onChange
				? { value: value ?? "", onChange: (e) => onChange(e.target.value) }
				: { defaultValue: "" })}
		>
			<option value="">{allowEmpty}</option>
			{options.map((person) => (
				<option key={person.id} value={person.id}>
					{person.name}
				</option>
			))}
		</select>
	);
}
