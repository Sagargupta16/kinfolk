/**
 * `next/link`, for the SPA.
 *
 * Aliased in place of the real thing so the shared components import
 * `next/link` unchanged. Rewriting three files to use a different component
 * would fork them from the Next app, and the whole point of aliasing
 * `components/` rather than copying it is that there is ONE canvas.
 *
 * There is no client-side router here: this app has three screens and the
 * transitions between them are full navigations anyway, so an anchor is the
 * honest implementation rather than a placeholder. `prefetch` and the other
 * Next-only props are accepted and dropped, because a caller passing them is
 * not wrong -- they are just meaningless without a router.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
	href: string;
	children?: ReactNode;
	/** Accepted and ignored: there is no router to prefetch into. */
	prefetch?: boolean;
	replace?: boolean;
	scroll?: boolean;
};

export default function Link({ href, prefetch, replace, scroll, ...rest }: LinkProps) {
	void prefetch;
	void replace;
	void scroll;
	// `base` is applied by Vite to assets, not to hand-written hrefs, so an
	// app-absolute path has to carry the mount itself or it lands on the apex.
	const resolved = href.startsWith("/") ? `${import.meta.env.BASE_URL}${href.slice(1)}` : href;
	return <a href={resolved} {...rest} />;
}
