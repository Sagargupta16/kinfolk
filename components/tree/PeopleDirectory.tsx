"use client";

import { ArrowUpRight, Search, UserRound } from "lucide-react";
import { motion } from "motion/react";
import { useId, useMemo, useState } from "react";
import { displayName, type FlowNode, lifespan } from "@/lib/tree/graph";
import type { Kinship } from "@/lib/tree/kinship";
import { searchPeople } from "@/lib/tree/search";
import { cn } from "@/lib/utils";

/** A readable alternative to the canvas, using the same authorized people and profiles. */
export function PeopleDirectory({
	nodes,
	selfId,
	kinship,
	selectedId,
	detailOpen,
	onSelect,
}: {
	nodes: FlowNode[];
	selfId?: string;
	kinship?: Map<string, Kinship>;
	selectedId: string | null;
	detailOpen: boolean;
	onSelect: (id: string) => void;
}) {
	const [query, setQuery] = useState("");
	const searchId = useId();
	const people = useMemo(
		() =>
			nodes
				.flatMap((node) => (node.type === "person" ? [node.data] : []))
				.sort((a, b) => displayName(a.primary).localeCompare(displayName(b.primary))),
		[nodes],
	);
	const results = useMemo(() => {
		if (query.trim().length < 2) return people;
		const hits = new Set(
			searchPeople(people, query, people.length, { selfId }).map(({ id }) => id),
		);
		return people.filter(({ id }) => hits.has(id));
	}, [people, query, selfId]);

	return (
		<motion.section
			aria-label="Family directory"
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
			className={cn(
				"kf-directory absolute inset-0 z-10 overflow-y-auto bg-canvas",
				detailOpen && "kf-directory--reading",
			)}
		>
			<div className="kf-directory-inner">
				<header className="kf-directory-heading">
					<div>
						<p className="kf-workspace-eyebrow">Your family, person by person</p>
						<h2>
							Familiar faces.
							<br />
							Stories to keep.
						</h2>
						<p>
							{people.length} {people.length === 1 ? "person" : "people"} in your visible family
							trees. Choose a name to open their profile.
						</p>
					</div>
					<div className="kf-directory-search">
						<label htmlFor={searchId}>Find someone</label>
						<div className="kf-search-control flex items-center gap-2 border px-3">
							<Search aria-hidden="true" className="size-4 shrink-0 text-ink-faint" />
							<input
								id={searchId}
								type="search"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								aria-describedby={`${searchId}-status`}
								placeholder="Name, nickname or birthplace"
								className="h-11 min-w-0 w-full bg-transparent text-sm outline-none"
							/>
						</div>
					</div>
				</header>
				<p id={`${searchId}-status`} role="status" className="kf-directory-count">
					{query.trim().length >= 2
						? `${results.length} matching ${results.length === 1 ? "person" : "people"}`
						: query.trim().length === 1
							? "Type one more character to search"
							: "All people"}
				</p>
				<ul className="kf-directory-list">
					{results.map((person) => {
						const name = displayName(person.primary);
						const isSelf = person.sources.some(({ id }) => id === selfId);
						const relationship = kinship?.get(person.id)?.label;
						return (
							<li key={person.id}>
								<button
									type="button"
									onClick={() => onSelect(person.id)}
									aria-pressed={detailOpen && selectedId === person.id}
									className="kf-directory-person"
								>
									<span className="kf-directory-initial" aria-hidden="true">
										{name.trim().charAt(0) || <UserRound className="size-5" />}
									</span>
									<span className="kf-directory-name">
										<strong>
											{name}
											{isSelf && (
												<>
													{" "}
													<small>You</small>
												</>
											)}
										</strong>
										<span>
											{(isSelf ? "Your profile" : relationship) ??
												person.primary.currentPlace ??
												person.primary.birthPlace ??
												"Family record"}
										</span>
									</span>
									<span className="kf-directory-dates">{lifespan(person.primary)}</span>
									<ArrowUpRight className="size-4 shrink-0 text-ink-faint" aria-hidden="true" />
								</button>
							</li>
						);
					})}
				</ul>
				{results.length === 0 && (
					<p className="py-8 text-sm text-ink-muted">
						No one matches that search. Try a first name or a different spelling.
					</p>
				)}
			</div>
		</motion.section>
	);
}
