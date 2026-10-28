/**
 * `next/link`, for the SPA.
 *
 * Aliased in place of the real thing so the shared components import
 * `next/link` unchanged. Rewriting the four files that use it to take a different
 * component would fork them from the Next app, and the whole point of aliasing
 * `components/` rather than copying it is that there is ONE canvas.
 *
 * There is no client-side router here: this app has four screens and the
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

/**
 * Keep the sample family on a link back into it.
 *
 * In the Next app the demo is a cookie, so it follows a visitor from link to link. Here
 * it is the `?demo=1` in the URL, which a link such as the view toggles' "/tree?combined=0"
 * does not carry -- and since a signed-out visit to /tree without it now goes to the front
 * door, flipping a toggle in the sample would have thrown the visitor out of it. So the
 * flag rides along on any link into /tree while the page itself has it, as the cookie
 * would.
 */
function keepDemo(href: string): string {
	if (new URLSearchParams(window.location.search).get("demo") !== "1") return href;
	const url = new URL(href, window.location.href);
	if (url.origin !== window.location.origin) return href;
	if (!url.pathname.startsWith(`${import.meta.env.BASE_URL}tree`)) return href;
	url.searchParams.set("demo", "1");
	return `${url.pathname}${url.search}${url.hash}`;
}

export default function Link({ href, prefetch, replace, scroll, ...rest }: LinkProps) {
	void prefetch;
	void replace;
	void scroll;
	// `base` is applied by Vite to assets, not to hand-written hrefs, so an
	// app-absolute path has to carry the mount itself or it lands on the apex.
	const resolved = href.startsWith("/") ? `${import.meta.env.BASE_URL}${href.slice(1)}` : href;
	return <a href={keepDemo(resolved)} {...rest} />;
}
