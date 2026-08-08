"use client";

/**
 * Find a person by name and go to them.
 *
 * The one navigation the canvas could not do. Zoom, level of detail and the
 * social-links toggle all answer "show me less of this"; none of them answers
 * "where is Halvor", and on 117 people across 10760px the answer was to pan until
 * you saw him.
 *
 * Deliberately a jump rather than a filter. Hiding the people who do not match
 * would destroy the only thing a family tree is for -- who somebody sits between
 * -- so a hit moves the viewport and selects the card, leaving every relative
 * around them on screen.
 */
import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Degree } from "@/lib/tree/density";
import type { FlowNode } from "@/lib/tree/graph";
import { searchPeople } from "@/lib/tree/search";
import { cn } from "@/lib/utils";
import { SearchEmpty } from "./TreeStates";

/** Why a row is in the list, when it is not the obvious reason. */
const REASON: Record<string, string> = {
	nickname: "nickname",
	birthName: "born",
	place: "born in",
};

export function TreeSearch({
	nodes,
	selfId,
	degree,
	onGoTo,
	focusRef,
}: {
	nodes: FlowNode[];
	/** Sorts the viewer first among namesakes, and marks their row. */
	selfId?: string;
	/** Ranks the better-connected of two people with the same name first. */
	degree?: Map<string, Degree>;
	/** Handed the fused node id; the canvas owns what "go there" means. */
	onGoTo: (id: string) => void;
	/**
	 * Filled with a function that focuses the input, for the `/` shortcut.
	 *
	 * A ref holding a callback rather than a `focus` boolean prop: focusing is an EVENT,
	 * and a boolean would have to be set and then unset, which means the second `/` in a
	 * session does nothing until something clears the flag.
	 */
	focusRef?: React.RefObject<(() => void) | null>;
}) {
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	// Which row the arrow keys are on, and the query it belongs to. Index -1 is
	// "none", so the first Down goes to the top of the list rather than the second
	// row.
	const [cursor, setCursor] = useState({ query: "", index: -1 });
	const inputRef = useRef<HTMLInputElement>(null);
	const listId = useId();

	// People only. A union dot has no name, and offering one as a result would be
	// offering to navigate to a junction.
	const people = useMemo(
		() => nodes.flatMap((node) => (node.type === "person" ? [node.data] : [])),
		[nodes],
	);

	const hits = useMemo(
		() => searchPeople(people, query, 8, { selfId, degree }),
		[people, query, selfId, degree],
	);

	/**
	 * The highlighted row, valid only for the query it was chosen against.
	 *
	 * A bare index would survive the query changing under it and point at a
	 * different person, so Enter would travel to somebody nobody picked. Storing the
	 * query with it invalidates the choice the moment the list is rebuilt -- which an
	 * effect could not do, because an effect runs AFTER a render in which the stale
	 * index was already live.
	 */
	const active = cursor.query === query && cursor.index < hits.length ? cursor.index : -1;

	/**
	 * Publish the focus handle upwards, rather than binding `/` here.
	 *
	 * This component used to own its own `/` listener. Once the canvas gained a
	 * shortcuts table (see TreeShortcuts.tsx) that became a second place deciding what a
	 * keystroke means -- two `keydown` handlers for one key, each with its own idea of
	 * when typing should be exempt, and a help sheet documenting only one of them. So the
	 * binding lives in the table and this exposes the action it invokes.
	 */
	useEffect(() => {
		if (!focusRef) return;
		focusRef.current = () => inputRef.current?.focus();
		return () => {
			focusRef.current = null;
		};
	}, [focusRef]);

	function go(id: string) {
		onGoTo(id);
		// Query kept, selection dropped: after landing on a cousin the next thing you
		// want is usually the sibling two rows down the same list.
		setOpen(false);
		inputRef.current?.blur();
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Escape") {
			// Claim the press BEFORE the surface stack sees it (React handlers run
			// first): leaving the search box is this key's whole job here, and without
			// the claim the same press would also close whatever panel is open behind.
			event.preventDefault();
			setOpen(false);
			inputRef.current?.blur();
			return;
		}

		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			// Otherwise the caret jumps to either end of the text while the list moves.
			event.preventDefault();
			if (hits.length === 0) return;
			const step = event.key === "ArrowDown" ? 1 : -1;
			// Wraps, so Up from the top reaches the last hit rather than dead-ending.
			setCursor({ query, index: (active + step + hits.length) % hits.length });
			return;
		}

		if (event.key === "Enter") {
			// No cursor means "I typed a name and hit Enter", which should take the best
			// match rather than doing nothing.
			const hit = hits[active === -1 ? 0 : active];
			if (hit) go(hit.id);
		}
	}

	const showList = open && query.trim().length >= 2;

	return (
		<div className="relative w-full">
			<div
				className={cn(
					"kf-search-control flex items-center gap-2 rounded-md border bg-surface/90 pl-2.5 pr-1 backdrop-blur-sm",
					"transition-colors duration-(--duration-fast) ease-(--ease-out)",
					showList ? "border-hairline-strong" : "border-hairline",
				)}
			>
				<Search aria-hidden className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.5} />
				<input
					ref={inputRef}
					type="search"
					// No `role="combobox"`: the full pattern needs aria-activedescendant
					// tracking the highlighted row, and this list manages its cursor in
					// state instead. Claiming the role without the wiring makes a screen
					// reader hunt for options it cannot reach; the plain searchbox with an
					// aria-controls hint is honest about what is implemented.
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onKeyDown={onKeyDown}
					placeholder="Find a person"
					aria-label="Find a person in this graph"
					aria-controls={listId}
					// 44px, and the appearance reset removes the browser's own clear button:
					// there is already one to its right, and two would be a choice nobody
					// asked to make.
					className={cn(
						"h-11 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none",
						"placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden",
					)}
				/>
				{query && (
					<button
						type="button"
						onClick={() => {
							setQuery("");
							inputRef.current?.focus();
						}}
						aria-label="Clear search"
						className={cn(
							"flex size-11 shrink-0 items-center justify-center rounded text-ink-faint",
							"transition-colors duration-(--duration-fast) ease-(--ease-out) hover:text-ink",
						)}
					>
						<X aria-hidden className="size-3.5" strokeWidth={1.5} />
					</button>
				)}
			</div>

			{showList && (
				<ul
					id={listId}
					// Not role="listbox" with options: these rows are buttons that move the
					// viewport, and a listbox would promise a selection model that does not
					// exist here.
					className={cn(
						"kf-sheet absolute inset-x-0 top-[calc(100%+0.25rem)] z-20",
						"overflow-hidden rounded-lg",
					)}
				>
					{hits.length === 0 && (
						<li>
							{/* Echoes the query back, because the commonest cause is a typo and a
							    reader cannot spot one they cannot see -- and it names the matching
							    rule, since "no match" on a name you are sure of reads as broken
							    until you know the search is not fuzzy. */}
							<SearchEmpty query={query.trim()} />
						</li>
					)}

					{hits.map((hit, index) => (
						<li key={hit.id}>
							<button
								type="button"
								// Mouse down, not click: click fires after the input's blur, by
								// which point the list has closed and taken this row with it.
								onMouseDown={(event) => {
									event.preventDefault();
									go(hit.id);
								}}
								onMouseEnter={() => setCursor({ query, index })}
								className={cn(
									"flex min-h-11 w-full items-baseline gap-2 border-b border-hairline px-3",
									"text-left last:border-b-0 transition-colors duration-(--duration-fast)",
									index === active ? "bg-surface-raised" : "hover:bg-surface-raised",
								)}
							>
								<span className="min-w-0 flex-1 truncate text-sm text-ink">{hit.name}</span>
								{/* Marked as well as ranked first: "you" in a list of five Fortins
								    is the difference between finding yourself and trusting that
								    the top row is you. */}
								{hit.isSelf && (
									<span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-wider text-accent">
										you
									</span>
								)}
								{REASON[hit.matched] && (
									<span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-wider text-ink-faint">
										{REASON[hit.matched]}
									</span>
								)}
								{/* Dates, because eleven people here share a surname and the
								    only thing that tells two Fortins apart is when they lived. */}
								{hit.dates && (
									<span className="tabular shrink-0 font-mono text-[0.625rem] text-ink-muted">
										{hit.dates}
									</span>
								)}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
