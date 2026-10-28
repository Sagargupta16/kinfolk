import type { Link2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * One of the "Which connections" toggles in the Options panel.
 *
 * A LINK when the toggle changes which data is fetched (mine-only drops the linked
 * family's records, so it is a real reload), a BUTTON when it only changes what is
 * drawn. Social links are the second kind: the server always sends every edge, because
 * layout needs the relations to place somebody with no family, so hiding them was a
 * full page load (and in the SPA a full document reload) for data already on screen.
 */
export function ScopeToggle({
	href,
	onToggle,
	active,
	label,
	hint,
	Icon,
}: {
	active: boolean;
	label: string;
	hint: string;
	Icon: typeof Link2;
} & ({ href: string; onToggle?: never } | { onToggle: () => void; href?: never })) {
	const className = cn(
		"kf-header-control flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium",
		"transition-colors duration-(--duration-fast) ease-(--ease-out)",
		active
			? "border-hairline-strong text-accent-ink"
			: "border-hairline text-ink-muted hover:border-hairline-strong hover:text-ink",
	);
	const content = (
		<>
			<Icon className="size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
			<span>{label}</span>
		</>
	);

	if (href !== undefined) {
		return (
			<Link
				href={href}
				scroll={false}
				aria-current={active ? "true" : undefined}
				aria-label={label}
				title={hint}
				className={className}
			>
				{content}
			</Link>
		);
	}
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-pressed={active}
			aria-label={label}
			title={hint}
			className={className}
		>
			{content}
		</button>
	);
}
