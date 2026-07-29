"use client";

/**
 * The account menu plus the share panel it opens.
 *
 * Its own component so `TreeWorkspace` can stay a SERVER component. The workspace renders
 * the header and the stats, none of which need a client bundle -- and the toggles are
 * plain links on purpose, so the view survives a reload. Only this corner is interactive,
 * so only this corner ships JavaScript.
 *
 * It also owns the seam between the two: sharing is reached from the menu rather than from
 * a second header button, because the header is the scarcest space on a phone and "share"
 * and "sign out" are both things you do to your account rather than to the canvas.
 */
import { useCallback, useState, useTransition } from "react";
import { type ShareState, shareState } from "@/lib/tree/share-actions";
import { AccountMenu } from "./AccountMenu";
import { SharePanel } from "./SharePanel";

export function AccountBar({
	name,
	email,
	/** The graph that can be shared, or null for a viewer who may only read. */
	editableTreeId,
}: {
	name: string | null;
	email: string | null;
	editableTreeId: string | null;
}) {
	const [state, setState] = useState<ShareState | null>(null);
	const [, startTransition] = useTransition();

	/**
	 * Load who has access, then show the panel.
	 *
	 * Fetched on OPEN rather than passed down with the view. Most sessions never share
	 * anything, so putting the member and invite lists in every page render would be two
	 * extra queries per visit plus other people's names and email addresses in the payload
	 * of a page that was not going to use them.
	 */
	const load = useCallback(() => {
		if (!editableTreeId) return;
		startTransition(async () => {
			setState(await shareState(editableTreeId));
		});
	}, [editableTreeId]);

	return (
		<>
			<AccountMenu
				name={name}
				email={email}
				// Absent when there is nothing this viewer may share, so the menu shows two
				// items instead of one that refuses.
				onShare={editableTreeId ? load : undefined}
			/>

			{editableTreeId && state && (
				/*
				 * Fixed, and anchored under the header rather than to the menu button.
				 *
				 * The panel is 22rem and the header is the top of a full-height flex column, so
				 * a normally-positioned child would either stretch the header or be clipped by
				 * it. Fixed also means the canvas can pan underneath without dragging it along.
				 */
				<div className="fixed right-3 top-16 z-40 sm:right-6">
					<SharePanel
						treeId={editableTreeId}
						state={state}
						onClose={() => setState(null)}
						// Re-read after every change, so revoking an invite or removing somebody
						// updates the list rather than leaving it describing the previous state.
						onChanged={load}
					/>
				</div>
			)}
		</>
	);
}
