/**
 * The dot lattice as its own layer, behind whatever sits on it.
 *
 * `.kf-lattice` is a `mask-image`, and a mask applies to the element AND everything inside
 * it -- worn on a wrapper it faded the wrapper's own text and buttons with the dots, below
 * 4.5:1 in the light theme. As a sibling layer only the dots fade. The parent must be
 * positioned and `isolate`, so the negative z-index lands above its background and below
 * its content.
 *
 * Its own module, with no imports, because the SPA's first screens use it too and anything
 * heavier here would ride into the landing page's bundle.
 */
export function Lattice() {
	return <div aria-hidden className="kf-lattice pointer-events-none absolute inset-0 -z-10" />;
}
