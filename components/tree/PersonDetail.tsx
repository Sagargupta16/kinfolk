"use client";

/**
 * Everything recorded about one person: a side panel on a pointer device, a bottom
 * sheet on a phone.
 *
 * ONE component for both, and the difference is entirely in the classes and the
 * animation axis. Two components would be two implementations of the same eleven
 * sections, and the second one would drift.
 *
 * ## What is deliberately absent
 *
 * Contact VALUES. The panel lists which channels exist and the label on each ("work",
 * "old number"), never the number itself. `lib/tree/visibility.ts` already strips
 * values the viewer may not see, but the ones that survive that filter still do not
 * belong on a surface that opens with a click on a canvas -- and this component cannot
 * tell a screenshot from a private read. Revealing a value is a deliberate act that
 * belongs on a page of its own, so what is here is the affordance for asking.
 */
import {
	AtSign,
	Baby,
	BookOpen,
	Briefcase,
	Calendar,
	Crosshair,
	GitBranch,
	Globe,
	Heart,
	Home,
	Link2,
	MapPin,
	Pencil,
	Phone,
	Quote,
	Users,
	X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useState } from "react";
import type { ContactKind } from "@/lib/db/schema";
import { displayName, type FusedPerson, lifespan } from "@/lib/tree/graph";
import type { Kinship } from "@/lib/tree/kinship";
import type { FamilyIndex, Relatives } from "@/lib/tree/relatives";
import { relativesOf } from "@/lib/tree/relatives";
import { cn } from "@/lib/utils";
import { PersonEditSheet } from "./PersonEdit";
import { PROVENANCE, SEX_MARKS } from "./PersonNode";

/** Channel glyphs. Phone and WhatsApp share one, since both are "a number to ring". */
const CHANNEL: Record<ContactKind, { Icon: typeof Phone; label: string }> = {
	phone: { Icon: Phone, label: "Phone" },
	whatsapp: { Icon: Phone, label: "WhatsApp" },
	email: { Icon: AtSign, label: "Email" },
	address: { Icon: Home, label: "Address" },
	instagram: { Icon: AtSign, label: "Instagram" },
	linkedin: { Icon: AtSign, label: "LinkedIn" },
	facebook: { Icon: AtSign, label: "Facebook" },
	x: { Icon: AtSign, label: "X" },
	website: { Icon: Globe, label: "Website" },
	other: { Icon: Link2, label: "Other" },
};

/** How a union's status reads as a heading. */
const PARTNER_HEADING: Record<string, string> = {
	married: "Married to",
	partnered: "Partner",
	separated: "Separated from",
	divorced: "Divorced from",
	widowed: "Widowed",
	unknown: "Partner",
};

export function PersonDetail({
	person,
	index,
	kinship,
	editableTreeIds,
	onSaved,
	onClose,
	onGoTo,
	onAddRelative,
	onCenter,
}: {
	/** Null closes the panel. Passed rather than held, so the canvas owns selection. */
	person: FusedPerson | null;
	index: FamilyIndex;
	kinship?: Map<string, Kinship>;
	/**
	 * Trees this viewer may write to. Empty for a read-only canvas or demo mode, which is
	 * what hides the pencil -- a disabled edit control advertises an action that cannot work.
	 */
	editableTreeIds?: readonly string[];
	/** Called after a save, so the canvas can re-read the graph from the server. */
	onSaved?: () => void;
	onClose: () => void;
	/** Travel to a relative named in the panel. This is the breadcrumb trail's engine. */
	onGoTo: (personId: string) => void;
	/** Grow this person's branch through the relationship-first composer. */
	onAddRelative?: () => void;
	/** Re-frame this person without closing the panel. */
	onCenter?: () => void;
}) {
	const titleId = useId();
	/**
	 * Whether the edit form is showing, held here rather than in the canvas.
	 *
	 * It belongs to this panel: opening a different person must close the form, which happens
	 * for free because the state resets when `person` changes identity.
	 */
	const [editing, setEditing] = useState(false);

	/*
	 * A new subject closes the form, because it is now stale.
	 *
	 * Without this, clicking a relative in the panel while editing would leave the form open
	 * on somebody else's record with the previous person's values in it -- and saving would
	 * write them to the wrong row.
	 *
	 * The id is read in the BODY as well as listed, which is what makes the dependency honest:
	 * Biome flags it as unnecessary because nothing in the callback consumes it, and that is
	 * true of the data flow and wrong about the intent. Identity change IS the trigger.
	 */
	const subjectId = person?.id;
	useEffect(() => {
		void subjectId;
		setEditing(false);
	}, [subjectId]);

	/**
	 * Escape closes, from anywhere.
	 *
	 * On `document` rather than the panel, because the click that opened it left focus on
	 * a canvas node -- so a handler bound to the panel would never receive the key.
	 */
	useEffect(() => {
		if (!person) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [person, onClose]);

	const relatives = useMemo<Relatives | null>(
		() => (person ? relativesOf(index, person.id) : null),
		[person, index],
	);

	return (
		<AnimatePresence>
			{person && relatives && (
				<motion.aside
					// A dialog would need a focus trap and a backdrop, and this panel is
					// deliberately non-modal: the whole point is reading a card while the tree it
					// belongs to is still visible and pannable beside it.
					aria-labelledby={titleId}
					// Slides from the right on a pointer device, up from the bottom on a phone.
					// One transform property either way, so it stays on the compositor.
					initial={{ opacity: 0, x: "100%" }}
					animate={{ opacity: 1, x: 0 }}
					exit={{ opacity: 0, x: "100%" }}
					transition={{ type: "spring", stiffness: 320, damping: 34, mass: 0.9 }}
					className={cn(
						"kf-glass absolute z-40 flex flex-col overflow-hidden",
						/*
						 * Phone: a bottom sheet at 55dvh, not 70.
						 *
						 * Measured at 375x812: 70dvh is 568px of sheet and leaves 244px of canvas, and
						 * the header, demo banner and search box already own most of that -- so the
						 * card you just tapped was itself covered. A detail panel that hides its own
						 * subject has lost the thing that makes it a panel rather than a page: this is
						 * deliberately non-modal so you can read a person against the family around
						 * them. 55dvh keeps roughly 365px of canvas, which holds the subject's row and
						 * the one above it, and the sheet still scrolls to every section.
						 *
						 * Desktop: a full-height rail on the right, where vertical room is not scarce.
						 */
						"inset-x-0 bottom-0 max-h-[55dvh] rounded-t-2xl",
						"sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[22rem] sm:rounded-none sm:rounded-l-2xl",
					)}
				>
					<Header
						person={person}
						kinship={kinship?.get(person.id)}
						titleId={titleId}
						onClose={onClose}
					/>

					<div className="flex border-b border-hairline">
						{onAddRelative && (
							<ActionButton label="Add relative" Icon={GitBranch} onClick={onAddRelative} primary />
						)}
						{Boolean(editableTreeIds?.length) && (
							<ActionButton label="Edit" Icon={Pencil} onClick={() => setEditing(true)} />
						)}
						{onCenter && <ActionButton label="Center" Icon={Crosshair} onClick={onCenter} />}
					</div>

					{/*
					 * The edit form, over this panel's own content rather than beside it.
					 *
					 * Both answer the same question about the same person, so showing them together
					 * would be the same data twice -- and on a phone there is no room for it anyway.
					 */}
					<PersonEditSheet
						person={editing ? person : null}
						editableTreeIds={editableTreeIds ?? []}
						onSaved={() => onSaved?.()}
						onClose={() => setEditing(false)}
					/>

					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5">
						<Facts person={person} />
						<Story person={person} />

						<People
							title="Parents"
							Icon={Users}
							people={relatives.parents}
							kinship={kinship}
							onGoTo={onGoTo}
						/>
						{relatives.partners.map(({ person: partner, union }) => (
							<People
								key={partner.id}
								title={PARTNER_HEADING[union.status ?? "unknown"] ?? "Partner"}
								Icon={Heart}
								people={[partner]}
								kinship={kinship}
								onGoTo={onGoTo}
								note={unionNote(union)}
							/>
						))}
						<People
							title="Children"
							Icon={Baby}
							people={relatives.children}
							kinship={kinship}
							onGoTo={onGoTo}
						/>
						<People
							title="Siblings"
							Icon={Users}
							people={relatives.siblings}
							kinship={kinship}
							onGoTo={onGoTo}
						/>

						<Connections relations={relatives.relations} onGoTo={onGoTo} />
						<Channels person={person} />
						<Sources person={person} />
					</div>
				</motion.aside>
			)}
		</AnimatePresence>
	);
}

function unionNote(union: {
	startDate?: string | null;
	place?: string | null;
}): string | undefined {
	const year = union.startDate?.slice(0, 4);
	return [year, union.place].filter(Boolean).join(", ") || undefined;
}

function Header({
	person,
	kinship,
	titleId,
	onClose,
}: {
	person: FusedPerson;
	kinship?: Kinship;
	titleId: string;
	onClose: () => void;
}) {
	const primary = person.primary;
	const name = displayName(primary);
	const sex = SEX_MARKS[primary.sex];
	const provenance = PROVENANCE[person.trust.level];

	return (
		<div className="flex items-start gap-3 border-b border-hairline px-4 pb-3 pt-4">
			{/*
			 * The avatar is INITIALS, not a photo, and that is a data decision rather than a
			 * shortcut: `photoKey` points into object storage that has no signed-URL route
			 * yet, so rendering an <img> would either 404 on every card or leak a bucket path.
			 * Initials over a living-status tint carry the same "who is this" at a glance.
			 */}
			<div
				className={cn(
					"flex size-12 shrink-0 items-center justify-center rounded-full border text-base font-medium",
					primary.living === "deceased"
						? "border-hairline bg-surface text-ink-muted"
						: "border-living/40 bg-living/10 text-ink",
				)}
				aria-hidden="true"
			>
				{initials(name)}
			</div>

			<div className="min-w-0 flex-1">
				<h2 id={titleId} className="text-lg font-medium leading-tight text-ink">
					{name}
				</h2>
				<p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[0.6875rem] text-ink-faint">
					{kinship && <span className="text-accent-ink">{kinship.label}</span>}
					<span className="inline-flex items-center gap-1">
						<sex.Icon className="size-2.5" strokeWidth={2} aria-hidden="true" />
						{sex.title}
					</span>
					{provenance && (
						<span title={provenance.title} className={provenance.tone}>
							{provenance.mark} {provenance.title.toLowerCase()}
						</span>
					)}
				</p>
			</div>

			<button
				type="button"
				onClick={onClose}
				aria-label="Close details"
				className={cn(
					"flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-faint",
					"transition-colors duration-(--duration-fast) ease-(--ease-out)",
					"hover:bg-surface-raised hover:text-ink",
				)}
			>
				<X className="size-4" strokeWidth={1.5} aria-hidden="true" />
			</button>
		</div>
	);
}

function ActionButton({
	label,
	Icon,
	onClick,
	primary = false,
}: {
	label: string;
	Icon: typeof GitBranch;
	onClick: () => void;
	primary?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 border-r border-hairline px-2",
				"last:border-r-0 text-[0.75rem] font-medium transition-colors",
				"duration-(--duration-fast) ease-(--ease-out)",
				primary
					? "bg-accent/8 text-accent-ink hover:bg-accent/14"
					: "text-ink-muted hover:bg-surface-raised hover:text-ink",
			)}
		>
			<Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
			{label}
		</button>
	);
}

/** Up to two letters, from the first and last word. */
function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	const first = words[0]?.[0] ?? "";
	const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
	return (first + last).toUpperCase();
}

/**
 * Vitals, as a definition list.
 *
 * `dl` rather than rows of divs because that is what this is: a screen reader then
 * announces "Born, 1890 in Cork" as a pair instead of two unrelated strings.
 *
 * An APPROXIMATE date is shown with its own text ("about 1890") rather than being
 * normalised into the exact column, because "about" is the information -- flattening it
 * would assert a precision nobody recorded.
 */
function Facts({ person }: { person: FusedPerson }) {
	const p = person.primary;
	const rows: { label: string; value: string; Icon: typeof Calendar }[] = [];

	const birth = p.birthDate?.slice(0, 4) ?? p.birthDateApprox;
	if (birth) {
		rows.push({
			label: "Born",
			value: [birth, p.birthPlace].filter(Boolean).join(" in "),
			Icon: Calendar,
		});
	}

	const death = p.deathDate?.slice(0, 4) ?? p.deathDateApprox;
	if (death) {
		rows.push({
			label: "Died",
			value: [death, p.deathPlace].filter(Boolean).join(" in "),
			Icon: Calendar,
		});
	}

	// Only when it adds something. "Living" beside a birth year and no death year is
	// already implied, so a row saying it would be a line spent on nothing.
	if (p.living === "living" && !death) rows.push({ label: "Status", value: "Living", Icon: Heart });
	if (p.living === "unknown") {
		rows.push({ label: "Status", value: "Not recorded", Icon: Heart });
	}

	if (p.birthFamilyName) {
		rows.push({ label: "Born name", value: p.birthFamilyName, Icon: BookOpen });
	}
	if (p.nickname) rows.push({ label: "Known as", value: p.nickname, Icon: Quote });
	if (p.occupation) rows.push({ label: "Work", value: p.occupation, Icon: Briefcase });
	if (p.currentPlace) rows.push({ label: "Lives", value: p.currentPlace, Icon: MapPin });

	const span = lifespan(p);

	if (rows.length === 0) return null;

	return (
		<Section title="Life" Icon={Calendar} note={span || undefined}>
			<dl className="space-y-1.5">
				{rows.map((row) => (
					<div key={row.label} className="flex gap-2 text-[0.8125rem]">
						<dt className="w-20 shrink-0 font-mono text-[0.6875rem] uppercase tracking-wide text-ink-faint">
							{row.label}
						</dt>
						<dd className="min-w-0 flex-1 text-ink-muted">{row.value}</dd>
					</div>
				))}
			</dl>
		</Section>
	);
}

function Story({ person }: { person: FusedPerson }) {
	const bio = person.primary.bio;
	if (!bio) return null;

	return (
		<Section title="Notes" Icon={BookOpen}>
			<p className="whitespace-pre-line text-[0.8125rem] leading-relaxed text-ink-muted">{bio}</p>
		</Section>
	);
}

/**
 * A list of relatives, each a button that travels to them.
 *
 * Buttons rather than links: this moves a viewport, it does not navigate, so an anchor
 * would promise a URL that does not exist and break middle-click.
 */
function People({
	title,
	Icon,
	people,
	kinship,
	onGoTo,
	note,
}: {
	title: string;
	Icon: typeof Users;
	people: FusedPerson[];
	kinship?: Map<string, Kinship>;
	onGoTo: (personId: string) => void;
	note?: string;
}) {
	if (people.length === 0) return null;

	return (
		<Section
			title={title}
			Icon={Icon}
			note={note}
			count={people.length > 1 ? people.length : undefined}
		>
			<ul className="space-y-0.5">
				{people.map((person) => (
					<li key={person.id}>
						<PersonRow person={person} kinship={kinship?.get(person.id)} onGoTo={onGoTo} />
					</li>
				))}
			</ul>
		</Section>
	);
}

function PersonRow({
	person,
	kinship,
	trailing,
	onGoTo,
}: {
	person: FusedPerson;
	kinship?: Kinship;
	trailing?: string;
	onGoTo: (personId: string) => void;
}) {
	const dates = lifespan(person.primary);

	return (
		<button
			type="button"
			onClick={() => onGoTo(person.id)}
			className={cn(
				// 44px, because this is the primary way to travel the graph from the panel.
				"flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left",
				"transition-colors duration-(--duration-fast) ease-(--ease-out)",
				"hover:bg-surface-raised",
			)}
		>
			<span
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					person.primary.living === "deceased"
						? "bg-past"
						: person.primary.living === "unknown"
							? "bg-hairline-strong"
							: "bg-living",
				)}
				aria-hidden="true"
			/>
			<span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink">
				{displayName(person.primary)}
			</span>
			{trailing && (
				<span className="shrink-0 font-mono text-[0.625rem] text-accent-ink">{trailing}</span>
			)}
			{!trailing && kinship && (
				<span className="shrink-0 font-mono text-[0.625rem] text-ink-faint">{kinship.label}</span>
			)}
			{dates && <span className="tabular shrink-0 text-[0.625rem] text-ink-faint">{dates}</span>}
		</button>
	);
}

function Connections({
	relations,
	onGoTo,
}: {
	relations: Relatives["relations"];
	onGoTo: (personId: string) => void;
}) {
	if (relations.length === 0) return null;

	return (
		<Section title="Connections" Icon={Link2} count={relations.length}>
			<ul className="space-y-0.5">
				{relations.map((link) => (
					<li key={`${link.person.id}:${link.kind}`}>
						<PersonRow
							person={link.person}
							// The relation, read from THIS person's end -- see relatives.ts. "Over"
							// is appended rather than the row being dropped: a former colleague is
							// still a recorded fact about who somebody knew.
							trailing={link.ended ? `${link.label}, over` : link.label}
							onGoTo={onGoTo}
						/>
					</li>
				))}
			</ul>
		</Section>
	);
}

/**
 * Which channels exist, never their values.
 *
 * Grouped by channel with a count, so three phone numbers are one row saying "3"
 * rather than three rows of identical glyphs. The label ("work", "old number") is shown
 * because it is a description rather than a value -- it says which number, not what it
 * is.
 */
function Channels({ person }: { person: FusedPerson }) {
	const grouped = useMemo(() => {
		const byKind = new Map<ContactKind, string[]>();
		for (const detail of person.contacts) {
			const labels = byKind.get(detail.kind) ?? [];
			if (detail.label) labels.push(detail.label);
			byKind.set(detail.kind, labels);
		}
		return [...byKind.entries()];
	}, [person.contacts]);

	if (grouped.length === 0) return null;

	return (
		<Section title="Reachable on" Icon={AtSign}>
			<ul className="flex flex-wrap gap-1.5">
				{grouped.map(([kind, labels]) => {
					const channel = CHANNEL[kind];
					return (
						<li
							key={kind}
							className={cn(
								"flex items-center gap-1.5 rounded-full border border-hairline",
								"bg-surface px-2.5 py-1 text-[0.6875rem] text-ink-muted",
							)}
						>
							<channel.Icon className="size-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
							{channel.label}
							{labels.length > 0 && (
								<span className="font-mono text-[0.625rem] text-ink-faint">
									{labels.join(", ")}
								</span>
							)}
						</li>
					);
				})}
			</ul>
			<p className="mt-2 text-[0.6875rem] leading-snug text-ink-faint">
				Values are not shown on the canvas.
			</p>
		</Section>
	);
}

/**
 * Where this record came from.
 *
 * Named "Sources" rather than "Provenance" because the panel is read by relatives, not
 * archivists. Shows the note and, when several families describe this person, how many
 * -- which is the fact the stacked sheets on the card are hinting at.
 */
function Sources({ person }: { person: FusedPerson }) {
	const note = person.primary.sourceNote;
	const families = person.contributingTreeIds.length;
	if (!note && families < 2 && !person.trust.conflicted) return null;

	return (
		<Section title="Sources" Icon={BookOpen}>
			{families > 1 && (
				<p className="text-[0.8125rem] text-ink-muted">
					Described by <span className="tabular">{families}</span> families.
				</p>
			)}
			{person.trust.conflicted && (
				<p className="mt-1 text-[0.8125rem] text-accent-ink">
					Their records disagree on the dates.
				</p>
			)}
			{note && <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">{note}</p>}
		</Section>
	);
}

/** One labelled block. The heading carries the icon, so no row has to repeat it. */
function Section({
	title,
	Icon,
	note,
	count,
	children,
}: {
	title: string;
	Icon: typeof Users;
	note?: string;
	count?: number;
	children: React.ReactNode;
}) {
	return (
		<section className="mt-4 first:mt-3">
			<h3 className="mb-1.5 flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint">
				<Icon className="size-3 shrink-0" strokeWidth={1.75} aria-hidden="true" />
				{title}
				{count !== undefined && <span className="tabular text-ink-faint">{count}</span>}
				{note && <span className="ml-auto font-normal normal-case tracking-normal">{note}</span>}
			</h3>
			{children}
		</section>
	);
}
