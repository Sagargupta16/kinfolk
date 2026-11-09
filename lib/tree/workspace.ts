/**
 * The workspace's surfaces as ONE state machine: who is viewed, whose profile is open, the
 * feed, the one strip on the canvas, and a travel the canvas has not finished yet.
 *
 * They used to be six pieces of state in two components, held together by effects and a
 * message protocol. The stage owned the feed; the canvas owned the profile and the strip;
 * the stage closed the canvas's profile by sending it a nonce the canvas had to acknowledge;
 * the canvas reported the profile back up so the stage could hide the feed; three effects
 * closed the strip AFTER a profile, a new subject or the People tab had already been
 * committed; and a travel request sat in state until the canvas acknowledged it. Each of
 * those was the fix for a bug that shipped: a panel that reopened itself after arriving from
 * search (an unacknowledged travel replaying), a feed button that toggled a rail the viewer
 * could not see, a strip painted over the profile it opened. And one combination still got
 * through, because only one ordering had been patched: open a profile, THEN a strip, and on a
 * phone both docked along the bottom, the strip over the sheet.
 *
 * Here every rule is one transition, so it holds whatever order things happen in:
 *
 *   - The strip belongs to the viewed person. A new subject closes it.
 *   - The strip and the profile never show together: opening either closes the other.
 *   - The feed is a background surface. It waits under a profile or a strip and comes back
 *     when they close; asking for it closes whatever covers it.
 *   - A travel is completed exactly once, by the canvas reporting it arrived. Arriving opens
 *     the profile only when the request asked for it, and a pick made meanwhile cancels it.
 *   - A detail-level or arrangement switch rebuilds the canvas and closes the strip, whose
 *     point belongs to the old layout. The profile, the feed and a pending travel survive it,
 *     as the folds and the trail already did.
 *
 * Pure, no React: the transition table is a thing you assert, not a thing you look at.
 * Every event returns the SAME object when it changes nothing, so a redundant dispatch costs
 * no render.
 */
import type { AddSlot } from "./node-add";

/**
 * The one small strip a card action opens: adding from a pressed `+`, or editing a card.
 *
 * The add strip keeps the whole SLOT, not only its target: the slot's point is where the
 * strip grows from, and where the new relative will be seen to come out of. Its accessible
 * name says whose relative it adds -- "Add a parent" with no name attached is how a father
 * gets recorded against the wrong person.
 */
export type Strip = { kind: "add"; slot: AddSlot } | { kind: "edit"; personId: string };

export type Workspace = {
	/**
	 * The durable subject: whose `+` handles are drawn, whose card wears the Viewing ticket,
	 * and who the orbit is centred on. Never React Flow's selection, the relation pin or the
	 * signed-in self.
	 */
	viewed: string | null;
	/** Whose profile is open, or null. */
	profile: string | null;
	/** Whether the feed is open. It is SHOWN only while nothing covers it: see `feedShown`. */
	feed: boolean;
	strip: Strip | null;
	/**
	 * A travel the canvas has not completed: search, the People directory, the feed, a
	 * breadcrumb or a relative in a profile asked to go to somebody. It waits here until a
	 * layout contains them -- a folded relative is brought back by becoming the viewed person.
	 */
	travel: { id: string; profile: boolean } | null;
};

export type WorkspaceEvent =
	/** A new subject: a pick, an arrival, or the stage following a fused id after a reload. */
	| { type: "view"; id: string | null }
	/** Go to somebody, viewing them at once; `profile` says whether arriving opens theirs. */
	| { type: "travel"; id: string; profile: boolean }
	/** The canvas centred and selected them. */
	| { type: "arrived"; id: string }
	| { type: "openProfile"; id: string }
	| { type: "toggleProfile"; id: string }
	| { type: "closeProfile" }
	| { type: "toggleFeed" }
	| { type: "closeFeed" }
	| { type: "openStrip"; strip: Strip }
	/** Pressing the control that opened the strip folds it back in. */
	| { type: "toggleStrip"; strip: Strip }
	| { type: "closeStrip" }
	/** A tap on the empty canvas: the transient surfaces go, the subject stays. */
	| { type: "clear" }
	/** The canvas was rebuilt for another detail level or arrangement. */
	| { type: "rearranged" }
	/** The people now in the graph. A profile, strip or travel about anybody else goes. */
	| { type: "present"; ids: ReadonlySet<string> };

/** Where the workspace opens: on the default subject, with nothing open. */
export function initialWorkspace(viewed: string | null): Workspace {
	return { viewed, profile: null, feed: false, strip: null, travel: null };
}

/** Whether the feed is on screen: open, and not covered by a profile or a strip. */
export function feedShown(state: Workspace): boolean {
	return state.feed && state.profile === null && state.strip === null;
}

/** Two strips are the same strip when they came from the same control. */
function sameStrip(a: Strip | null, b: Strip): boolean {
	if (!a || a.kind !== b.kind) return false;
	return a.kind === "add"
		? a.slot.key === (b as Extract<Strip, { kind: "add" }>).slot.key
		: a.personId === (b as Extract<Strip, { kind: "edit" }>).personId;
}

/** Whose card a strip is about, as a fused id where the strip knows one. */
function stripPerson(strip: Strip): string | null {
	return strip.kind === "edit" ? strip.personId : null;
}

export function workspace(state: Workspace, event: WorkspaceEvent): Workspace {
	switch (event.type) {
		case "view":
			if (event.id === state.viewed) return state;
			// The strip goes with its subject: left open it would still be anchored to the old
			// card while the handles moved to another, two subjects on screen at once. And a
			// pick made while a travel waited for its layout is the newer intent: the travel
			// would otherwise land later and take the subject back.
			return { ...state, viewed: event.id, strip: null, travel: null };

		case "travel":
			return {
				...state,
				viewed: event.id,
				strip: event.id === state.viewed ? state.strip : null,
				travel: { id: event.id, profile: event.profile },
			};

		case "arrived": {
			const { travel } = state;
			if (!travel || travel.id !== event.id) return state;
			if (!travel.profile) return { ...state, travel: null };
			return { ...state, travel: null, profile: travel.id, strip: null };
		}

		case "openProfile":
			if (state.profile === event.id && state.strip === null) return state;
			return { ...state, profile: event.id, strip: null };

		case "toggleProfile":
			if (state.profile === event.id) return { ...state, profile: null };
			return { ...state, profile: event.id, strip: null };

		case "closeProfile":
			return state.profile === null ? state : { ...state, profile: null };

		case "toggleFeed":
			if (feedShown(state)) return { ...state, feed: false };
			return { ...state, feed: true, profile: null, strip: null };

		case "closeFeed":
			return state.feed ? { ...state, feed: false } : state;

		case "openStrip":
			if (sameStrip(state.strip, event.strip) && state.profile === null) return state;
			return { ...state, strip: event.strip, profile: null };

		case "toggleStrip":
			if (sameStrip(state.strip, event.strip)) return { ...state, strip: null };
			return { ...state, strip: event.strip, profile: null };

		case "closeStrip":
			return state.strip === null ? state : { ...state, strip: null };

		case "clear":
			if (state.profile === null && state.strip === null) return state;
			return { ...state, profile: null, strip: null };

		case "rearranged":
			return state.strip === null ? state : { ...state, strip: null };

		case "present": {
			const profile = state.profile && !event.ids.has(state.profile) ? null : state.profile;
			const editing = state.strip ? stripPerson(state.strip) : null;
			const strip = editing && !event.ids.has(editing) ? null : state.strip;
			const travel = state.travel && !event.ids.has(state.travel.id) ? null : state.travel;
			if (profile === state.profile && strip === state.strip && travel === state.travel) {
				return state;
			}
			return { ...state, profile, strip, travel };
		}
	}
}
