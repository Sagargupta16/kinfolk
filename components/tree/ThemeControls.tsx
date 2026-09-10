"use client";

/**
 * Theme and motion switches.
 *
 * Both read their initial value from the DOM rather than from `localStorage`, and that
 * is the point: the inline script in `app/layout.tsx` has already resolved the stored
 * choice onto `<html>` before this component ever mounts, so reading the attribute
 * cannot disagree with what is on screen. Reading storage again would introduce a
 * second source of truth that could differ from the paint.
 *
 * State starts at the SSR default and is corrected in an effect, because the server has
 * no `localStorage` and no `matchMedia` -- guessing during render makes the first
 * client paint disagree with the markup it hydrates.
 */
import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	applyMotion,
	applyScheme,
	isThemeChoice,
	MOTION_ATTR,
	MOTION_KEY,
	resolveScheme,
	THEME_KEY,
	type ThemeChoice,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const CHOICES: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
	{ value: "light", label: "Light", Icon: Sun },
	{ value: "dark", label: "Dark", Icon: Moon },
	{ value: "system", label: "System", Icon: Monitor },
];

export function ThemeControls({ className }: { className?: string }) {
	const [choice, setChoice] = useState<ThemeChoice>("system");
	const [motion, setMotion] = useState(true);

	useEffect(() => {
		setMotion(document.documentElement.getAttribute(MOTION_ATTR) !== "off");
		try {
			const stored = localStorage.getItem(THEME_KEY);
			if (isThemeChoice(stored)) setChoice(stored);
		} catch {
			// A private window throws on `localStorage` access rather than returning null.
			// The attribute the inline script wrote is still correct, so there is nothing to
			// recover -- only the control's own label would be wrong, for one session.
		}
	}, []);

	/**
	 * Follow the OS while the choice is `system`, and only then.
	 *
	 * Without this, picking `system` resolves once and then never changes again -- so a
	 * canvas left open through dusk stays in the wrong scheme, which is the one thing
	 * `system` promises not to do.
	 */
	useEffect(() => {
		if (choice !== "system") return;
		const query = window.matchMedia("(prefers-color-scheme: light)");
		const onChange = () => applyScheme(resolveScheme("system"));
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, [choice]);

	const pickTheme = useCallback((next: ThemeChoice) => {
		setChoice(next);
		applyScheme(resolveScheme(next));
		try {
			localStorage.setItem(THEME_KEY, next);
		} catch {
			// Unwritable storage costs persistence, not the switch: the attribute is already
			// applied, so the choice holds for this session.
		}
	}, []);

	const pickMotion = useCallback((next: boolean) => {
		setMotion(next);
		applyMotion(next);
		try {
			localStorage.setItem(MOTION_KEY, next ? "on" : "off");
		} catch {
			/* see above */
		}
	}, []);

	return (
		<div className={cn("kf-header-theme flex items-center gap-1.5", className)}>
			{/*
			 * A fieldset rather than role="radiogroup": the same semantics, carried by a
			 * native element with no ARIA attribute to keep in sync. The label lives in
			 * `aria-label` because a visible <legend> would spend a line saying what three
			 * icons already say.
			 */}
			<fieldset
				aria-label="Colour theme"
				className="kf-command-group flex overflow-hidden rounded-lg border border-hairline bg-surface/80"
			>
				{CHOICES.map(({ value, label, Icon }) => (
					<button
						key={value}
						type="button"
						onClick={() => pickTheme(value)}
						// `aria-pressed` rather than `aria-checked`: these are buttons, not radios,
						// and a screen reader announcing "not checked" on two of three every time
						// is noise. Pressed states read as one selected.
						aria-pressed={choice === value}
						title={`${label} theme`}
						className={cn(
							// 44px is the touch floor, and these sit in a header a thumb reaches for.
							"flex size-11 items-center justify-center",
							"transition-colors duration-(--duration-fast) ease-(--ease-out)",
							choice === value
								? "bg-surface-raised text-accent-ink"
								: "text-ink-faint hover:bg-surface-raised hover:text-ink",
						)}
					>
						<Icon aria-hidden="true" className="size-4" strokeWidth={1.5} />
						<span className="sr-only">{label}</span>
					</button>
				))}
			</fieldset>

			<fieldset
				aria-label="Motion"
				className="flex w-full overflow-hidden rounded-lg border border-hairline bg-surface/80"
			>
				{[
					{ enabled: true, label: "Full motion" },
					{ enabled: false, label: "Reduced motion" },
				].map(({ enabled, label }) => (
					<button
						key={label}
						type="button"
						onClick={() => pickMotion(enabled)}
						aria-pressed={motion === enabled}
						className={cn(
							"min-h-11 flex-1 px-2 text-xs transition-colors duration-(--duration-fast)",
							motion === enabled
								? "bg-surface-raised text-accent-ink"
								: "text-ink-faint hover:bg-surface-raised hover:text-ink",
						)}
					>
						{label}
					</button>
				))}
			</fieldset>
		</div>
	);
}
