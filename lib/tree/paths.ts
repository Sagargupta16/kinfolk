/**
 * The geometry of a family connector, as strings.
 *
 * Pulled out of the edge component because it is arithmetic with a right answer, and
 * the previous version was wrong in two ways nobody could see in the file. Measured on
 * the live canvas:
 *
 *   - 82 of 150 paths were built from `L` commands alone, so every turn was a hard 90
 *     degree corner. The rounded-corner constant existed and only the fallback branch
 *     ever used it.
 *   - One shared sibling bar ran 6013px against a median of 200px. A single horizontal
 *     line crossing the whole canvas is not a family bracket; it is a rule, and it reads
 *     as one.
 *
 * SVG's y axis grows DOWNWARD throughout. "Down" means increasing y, and a parent sits
 * at a smaller y than its child.
 */

/** Corner radius, matched to the card's own so a join reads as part of the same set. */
export const CORNER = 10;

/**
 * The widest a shared sibling bar may run before the family is drawn as curves instead.
 *
 * A bracket says "these people are siblings" by being short enough to take in at once.
 * Past roughly a screen it stops being a bracket: the eye cannot hold both ends, and the
 * line reads as a divider lying across the canvas. The sample tree's median bar is 200px
 * and its widest was 6013px, so this is not a hypothetical.
 */
export const MAX_BAR_SPAN = 900;

/**
 * Round one corner of an orthogonal turn.
 *
 * Given the corner point and the direction the path arrives from and leaves towards, this
 * emits the line up TO the turn, then a quadratic through it. The control point is the
 * corner itself, which is what makes the curve tangent to both legs -- the property that
 * distinguishes a rounded corner from an arbitrary bend.
 */
function turn(
	cornerX: number,
	cornerY: number,
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	radius: number,
): string {
	// Clamped to half of each leg, so two turns on a short segment cannot overrun each
	// other and invert the path. This is what the hand-built version had no notion of.
	const inLeg = Math.hypot(cornerX - fromX, cornerY - fromY);
	const outLeg = Math.hypot(toX - cornerX, toY - cornerY);
	const r = Math.max(0, Math.min(radius, inLeg / 2, outLeg / 2));

	if (r < 0.5) return `L ${cornerX} ${cornerY}`;

	// Unit vectors along each leg, so this works for any of the four turn directions
	// without a sign table.
	const inX = (cornerX - fromX) / (inLeg || 1);
	const inY = (cornerY - fromY) / (inLeg || 1);
	const outX = (toX - cornerX) / (outLeg || 1);
	const outY = (toY - cornerY) / (outLeg || 1);

	const startX = cornerX - inX * r;
	const startY = cornerY - inY * r;
	const endX = cornerX + outX * r;
	const endY = cornerY + outY * r;

	return `L ${startX} ${startY} Q ${cornerX} ${cornerY} ${endX} ${endY}`;
}

/**
 * Parent down to a child, turning through a shared horizontal line.
 *
 * The classic pedigree elbow: leave the parent downward, run across at `barY`, arrive at
 * the child downward. Both turns are rounded, and both clamp -- a child almost directly
 * below its parent has only a few pixels of horizontal run, and an unclamped radius would
 * make the path bulge sideways past where it started.
 */
export function elbowPath(
	sourceX: number,
	sourceY: number,
	targetX: number,
	targetY: number,
	barY: number,
	radius = CORNER,
): string {
	// Straight drop: no turn to round, and a Q with coincident control points would
	// render as a degenerate wobble.
	if (Math.abs(targetX - sourceX) < 0.5) {
		return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
	}

	return [
		`M ${sourceX} ${sourceY}`,
		turn(sourceX, barY, sourceX, sourceY, targetX, barY, radius),
		turn(targetX, barY, sourceX, barY, targetX, targetY, radius),
		`L ${targetX} ${targetY}`,
	].join(" ");
}

/**
 * A vertical-tangent S-curve from one point to another.
 *
 * Used where a bracket would be too wide to read. Both tangents are vertical, so the line
 * still leaves a parent downward and arrives at a child from above -- the direction cue
 * the orthogonal route gets for free from its geometry, which a naive straight diagonal
 * would throw away.
 *
 * `tension` is the fraction of the vertical gap each control point extends. At 0 the curve
 * is a straight line; at 1 the control points reach the opposite endpoint's row and the
 * curve leaves and arrives almost perfectly vertically. 0.55 is the default because it
 * keeps the middle of the curve diagonal enough to follow while the ends stay clearly
 * vertical.
 */
export function curvePath(
	sourceX: number,
	sourceY: number,
	targetX: number,
	targetY: number,
	tension = 0.55,
): string {
	const dy = targetY - sourceY;
	const reach = dy * tension;
	return `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + reach} ${targetX} ${targetY - reach} ${targetX} ${targetY}`;
}

/**
 * An edge that bends AROUND the centre of an orbit, rather than cutting across it.
 *
 * The orbit's first implementation reused the layered router and the result was a web:
 * median edge length 2423px with 94 of 150 over 2000px, every one a straight chord slicing
 * through the middle of the rings. A chord is the wrong shape on a radial layout for a
 * reason that is structural rather than cosmetic -- it crosses rings it has nothing to do
 * with, so the encoding "radius means distance" is contradicted by lines that ignore radius
 * entirely.
 *
 * So the control points are pushed OUTWARD along each endpoint's own radius. The curve
 * leaves a node heading away from the centre and arrives at the other one the same way,
 * which keeps it in the annulus between the two rings instead of through the middle. Two
 * nodes on the same ring get an arc that follows the ring; a node and its parent one ring
 * in get a gentle radial hop.
 *
 * `cx`/`cy` are the orbit's centre, which is the origin in `radialLayout`'s coordinates.
 */
export function orbitPath(
	sourceX: number,
	sourceY: number,
	targetX: number,
	targetY: number,
	cx = 0,
	cy = 0,
	/** How far the control points bow outward, as a fraction of each endpoint's radius. */
	/**
	 * How far the control points bow outward, as a fraction of the separation.
	 *
	 * 0.3 rather than the 0.75 a first attempt used. The bow was being asked to rescue edges
	 * that spanned 122 degrees of arc, which it cannot -- at 0.75 those became wide loops
	 * instead of straight chords, which is a different ugly rather than a fix. Once the
	 * ANGLES were allocated by wedge so relatives sit near each other, the separation to
	 * cover is small and the bow only has to keep a short edge off the straight line.
	 */
	bow = 0.3,
): string {
	const sourceRadius = Math.hypot(sourceX - cx, sourceY - cy);
	const targetRadius = Math.hypot(targetX - cx, targetY - cy);

	// A node AT the centre has no outward direction, so there is nothing to bow along and a
	// straight spoke is the honest line -- it is the one edge that should cross the middle.
	if (sourceRadius < 1 || targetRadius < 1) {
		return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
	}

	// Unit vectors pointing away from the centre at each end.
	const sourceOutX = (sourceX - cx) / sourceRadius;
	const sourceOutY = (sourceY - cy) / sourceRadius;
	const targetOutX = (targetX - cx) / targetRadius;
	const targetOutY = (targetY - cy) / targetRadius;

	const separation = Math.hypot(targetX - sourceX, targetY - sourceY);

	/*
	 * An edge spanning distant wedges is drawn STRAIGHT, not bowed.
	 *
	 * Bowing exists to keep a short edge from lying flat along a chord it could follow round
	 * instead. It cannot help an edge that genuinely crosses the graph -- a cousin marriage,
	 * or a person fused across two families -- because there is no short way round: measured,
	 * bowing those produced four sweeping 3700-4700px loops, and capping the reach barely
	 * moved them because the cap scales with the same radii that make them long.
	 *
	 * So past a threshold the curve gives up and says the true thing: these two are far
	 * apart. A straight line reads as a long-distance link, where a giant arc reads as
	 * another ring and competes with the structure.
	 */
	const outerRadius = Math.max(sourceRadius, targetRadius);
	if (separation > outerRadius * 1.2) {
		return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
	}

	const reach = separation * bow;

	return [
		`M ${sourceX} ${sourceY}`,
		`C ${sourceX + sourceOutX * reach} ${sourceY + sourceOutY * reach}`,
		`${targetX + targetOutX * reach} ${targetY + targetOutY * reach}`,
		`${targetX} ${targetY}`,
	].join(" ");
}

/**
 * The bracket for one family: a horizontal run with both ends turned downward.
 *
 * Drawn as a single path by ONE elected edge per union rather than once per child, because
 * N children each drawing the full run would stack N identical strokes -- brightest where
 * they pile up, and each animating its own draw-on.
 *
 * The end caps are what make it a bracket rather than a rule. A bare horizontal line has
 * to be read together with the drop lines crossing it; turning its ends down closes the
 * shape, so it reads as one mark that encloses a set of siblings.
 */
export function bracketPath(
	left: number,
	right: number,
	barY: number,
	/** How far the turned-down ends descend. Short: they are a cap, not a drop line. */
	capDepth = CORNER,
	radius = CORNER,
): string {
	const span = right - left;
	if (span < 1) return "";

	// Too tight to turn both ends: draw the plain run rather than two overlapping curves.
	if (span < radius * 2 + 1) return `M ${left} ${barY} L ${right} ${barY}`;

	return [
		`M ${left} ${barY + capDepth}`,
		turn(left, barY, left, barY + capDepth, right, barY, radius),
		turn(right, barY, left, barY, right, barY + capDepth, radius),
		`L ${right} ${barY + capDepth}`,
	].join(" ");
}
