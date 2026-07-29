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
import { Link2, Plus, UserPlus, X } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";
import { addPerson, addRelation, addUnion, type Result } from "@/lib/tree/edit-actions";
import { kindsByCategory, RELATION_KINDS } from "@/lib/tree/relations";
import { cn } from "@/lib/utils";

/** A person the pickers can offer. Names only -- see `editablePeople()`. */
export type PickablePerson = { id: string; name: string };

type Tab = "person" | "relation" | "partnership";

const TABS: { value: Tab; label: string; Icon: typeof Plus }[] = [
	{ value: "person", label: "Person", Icon: UserPlus },
	{ value: "relation", label: "Relation", Icon: Link2 },
	{ value: "partnership", label: "Partners", Icon: Plus },
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

const label = "mb-1 block font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint";

function Labelled({ text, children }: { text: string; children: React.ReactNode }) {
	const id = useId();
	return (
		<div>
			{/* The label wraps its control, so the association needs no matching id pair --
			    one less thing to get wrong than htmlFor plus id on every field. */}
			<label className={label} htmlFor={id}>
				{text}
			</label>
			<div id={id}>{children}</div>
		</div>
	);
}

export function EditorPanel({
	treeId,
	people,
	/** The card most recently selected on the canvas, pre-filling the "from" side. */
	selectedId,
	selectedName,
}: {
	/** The graph being edited. Absent in demo mode, where the panel is not rendered. */
	treeId: string;
	people: PickablePerson[];
	selectedId?: string | null;
	selectedName?: string | null;
}) {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<Tab>("person");
	const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
	const [pending, startTransition] = useTransition();

	// The "from" person, seeded from the canvas selection but overridable: clicking a card
	// is a shortcut, not a constraint, and the person you want may be off screen.
	const [fromId, setFromId] = useState<string>("");
	useEffect(() => {
		if (selectedId) setFromId(selectedId);
	}, [selectedId]);

	/**
	 * Escape closes. Deliberately not a focus trap: the panel is docked, not modal, and
	 * trapping focus would make the canvas behind it unreachable by keyboard -- which is
	 * the one thing this layout exists to keep available.
	 */
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	function submit(action: (form: FormData) => Promise<Result>) {
		return (form: FormData) => {
			setMessage(null);
			startTransition(async () => {
				const result = await action(form);
				setMessage(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
			});
		};
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className={cn(
					"pointer-events-auto flex min-h-11 items-center gap-2 rounded-md px-3.5",
					// Solid ink on the canvas, unlike every other control up here.
					//
					// The rest of the chrome is a hairline on a translucent surface, which is
					// correct for things that modify the VIEW -- they should recede behind the
					// graph. This is the one control that changes the DATA, and a canvas with
					// nothing on it needs the way in to be findable rather than tasteful. Ink
					// rather than the accent: amber is spoken for by "you" and "this relation",
					// and spending it here would cost it its meaning.
					"bg-ink text-sm font-medium text-canvas shadow-[0_2px_8px_rgba(0,0,0,0.4)]",
					"transition-transform duration-(--duration-fast) ease-(--ease-out)",
					"hover:-translate-y-px active:translate-y-0",
				)}
			>
				<Plus aria-hidden className="size-4 shrink-0" strokeWidth={2} />
				Add person
			</button>
		);
	}

	return (
		<div
			className={cn(
				"pointer-events-auto flex w-[min(20rem,calc(100vw-1.5rem))] flex-col",
				// Opaque: these are 10px labels read against whatever cards sit behind, and a
				// translucent surface puts a name through the middle of a field.
				"max-h-[min(80vh,34rem)] overflow-hidden rounded-md border border-hairline-strong",
				"bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
			)}
		>
			<header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
				<h2 className="min-w-0 flex-1 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
					{/*
					 * Names the picked card, so the shortcut is visible rather than silent.
					 * Clicking a person fills the "from" select, and without saying so the
					 * field appears to change on its own -- which reads as a bug, not a
					 * convenience.
					 */}
					{selectedName ? (
						<>
							From <span className="text-accent">{selectedName}</span>
						</>
					) : (
						"Add to your graph"
					)}
				</h2>
				<button
					type="button"
					onClick={() => setOpen(false)}
					aria-label="Close the editor"
					className="flex size-7 items-center justify-center rounded text-ink-faint transition-colors hover:text-ink"
				>
					<X aria-hidden className="size-4" strokeWidth={1.5} />
				</button>
			</header>

			<fieldset aria-label="What to add" className="flex shrink-0 border-b border-hairline">
				{TABS.map(({ value, label: text, Icon }) => (
					<button
						key={value}
						type="button"
						onClick={() => {
							setTab(value);
							setMessage(null);
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
				{tab === "person" && (
					<form action={submit(addPerson)} className="space-y-3">
						<input type="hidden" name="treeId" value={treeId} />

						<div className="grid grid-cols-2 gap-2">
							<Labelled text="Given name">
								<input name="givenName" className={field} autoComplete="off" />
							</Labelled>
							<Labelled text="Family name">
								<input name="familyName" className={field} autoComplete="off" />
							</Labelled>
						</div>

						<Labelled text="Sex">
							{/* Defaults to unknown, and that is the honest default rather than a
							    placeholder. It is a STORED value, so a guess outlives the guess --
							    which is why nothing here infers it from the name. */}
							<select name="sex" className={field} defaultValue="unknown">
								<option value="unknown">Not recorded</option>
								<option value="female">Female</option>
								<option value="male">Male</option>
								<option value="other">Other</option>
							</select>
						</Labelled>

						<Labelled text="Living">
							<select name="living" className={field} defaultValue="unknown">
								<option value="unknown">Not recorded</option>
								<option value="living">Living</option>
								<option value="deceased">Deceased</option>
							</select>
						</Labelled>

						<div className="grid grid-cols-2 gap-2">
							<Labelled text="Born">
								<input type="date" name="birthDate" className={field} />
							</Labelled>
							<Labelled text="Or roughly">
								{/* The fuzzy column, because "about 1890" is a real genealogical
								    answer and coercing it to a date invents a precision nobody has. */}
								<input
									name="birthDateApprox"
									placeholder="about 1890"
									className={field}
									autoComplete="off"
								/>
							</Labelled>
						</div>

						<Labelled text="Where they live">
							<input name="currentPlace" className={field} autoComplete="off" />
						</Labelled>

						<Labelled text="Occupation">
							<input name="occupation" className={field} autoComplete="off" />
						</Labelled>

						<Submit pending={pending} text="Add person" />
					</form>
				)}

				{tab === "relation" && (
					<form action={submit(addRelation)} className="space-y-3">
						<Labelled text="From">
							<PersonSelect name="personAId" people={people} value={fromId} onChange={setFromId} />
						</Labelled>

						<Labelled text="Is the...">
							<select name="kind" className={field} defaultValue="friend">
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
						</Labelled>

						<Labelled text="Of">
							<PersonSelect name="personBId" people={people} exclude={fromId} />
						</Labelled>

						<Labelled text="How close">
							{/* Blank means "use the kind's default", which is not the same as 1 --
							    it lets the default improve later without rewriting stored rows. */}
							<select name="closeness" className={field} defaultValue="">
								<option value="">Use the default for this kind</option>
								<option value="1">Acquaintance</option>
								<option value="2">Close</option>
								<option value="3">Very close</option>
							</select>
						</Labelled>

						<Labelled text="Ended">
							<input type="date" name="endDate" className={field} />
						</Labelled>

						<p className="text-[0.625rem] leading-snug text-ink-faint">
							A directed kind reads one way only: "mentor" stored once is also "mentee" read from
							the other end.
						</p>

						<Submit pending={pending} text="Connect them" />
					</form>
				)}

				{tab === "partnership" && (
					<form action={submit(addUnion)} className="space-y-3">
						<Labelled text="Partner">
							<PersonSelect name="partnerAId" people={people} value={fromId} onChange={setFromId} />
						</Labelled>

						<Labelled text="And">
							{/* Optional on purpose: a single parent still forms a union, which is what
							    lets parentage hang off the partnership instead of a parent pair. */}
							<PersonSelect
								name="partnerBId"
								people={people}
								exclude={fromId}
								allowEmpty="Nobody recorded"
							/>
						</Labelled>

						<Labelled text="Status">
							<select name="status" className={field} defaultValue="married">
								<option value="married">Married</option>
								<option value="partnered">Partnered</option>
								<option value="separated">Separated</option>
								<option value="divorced">Divorced</option>
								<option value="widowed">Widowed</option>
								<option value="unknown">Not recorded</option>
							</select>
						</Labelled>

						<p className="text-[0.625rem] leading-snug text-ink-faint">
							Children attach to the partnership, not to one parent. That is what makes
							half-siblings, remarriages and adoption work without a special case.
						</p>

						<Submit pending={pending} text="Record partnership" />
					</form>
				)}

				{message && (
					<p
						role="status"
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

function Submit({ pending, text }: { pending: boolean; text: string }) {
	return (
		<button
			type="submit"
			disabled={pending}
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
	name,
	people,
	value,
	onChange,
	exclude,
	allowEmpty = "Pick somebody",
}: {
	name: string;
	people: PickablePerson[];
	value?: string;
	onChange?: (id: string) => void;
	/** Hidden from the list, so a relation cannot be built to the same person. */
	exclude?: string;
	allowEmpty?: string;
}) {
	const options = people.filter((person) => person.id !== exclude);

	return (
		<select
			name={name}
			className={field}
			// Controlled only when the parent tracks it. An uncontrolled select with a
			// `value` and no `onChange` is frozen, so the two travel together.
			{...(onChange ? { value: value ?? "", onChange: (e) => onChange(e.target.value) } : {})}
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
