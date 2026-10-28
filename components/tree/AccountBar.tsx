"use client";

/**
 * The account menu plus the share panel it opens.
 *
 * Its own component so `TreeWorkspace` can stay a SERVER component. The workspace renders
 * the header and the stats, none of which need a client bundle -- and the toggles are
 * plain links on purpose, so the view survives a reload. Only this corner is interactive,
 * so only this corner ships JavaScript.
 *
 * Sharing has a direct header button and remains available from the account menu.
 * The access and record-link panels are loaded only when requested.
 */
import { Share2 } from "lucide-react";
import { lazy, Suspense, useCallback, useId, useRef, useState, useTransition } from "react";
import { LoadBoundary } from "@/components/ui/LoadBoundary";
import { shareState } from "@/lib/tree/share-actions";
import type { ShareState } from "@/lib/tree/sharing";
import { AccountMenu } from "./AccountMenu";
import { SharePanel } from "./SharePanel";

const LinkPanel = lazy(() =>
	import("./LinkPanel").then((module) => ({ default: module.LinkPanel })),
);

const SHARE_UNAVAILABLE = "Family access could not be loaded. Try again.";

/**
 * The sentence to show for a failed read of who has access.
 *
 * The SPA's shim throws one written for a person ("Your session has expired..."), so that
 * one is shown. A Next server action's error is not: in production its message is replaced
 * with a generic one and a `digest` is attached, and the generic text means nothing to
 * somebody looking at their family.
 */
function shareFailure(caught: unknown): string {
	if (caught instanceof Error && !("digest" in caught) && caught.message) return caught.message;
	return SHARE_UNAVAILABLE;
}

export function AccountBar({
	name,
	email,
	/** The graph that can be shared, or null for a viewer who may only read. */
	editableTreeId,
	editableTrees,
}: {
	name: string | null;
	email: string | null;
	editableTreeId: string | null;
	editableTrees?: { id: string; name: string }[];
}) {
	const [state, setState] = useState<ShareState | null>(null);
	const [shareOpen, setShareOpen] = useState(false);
	const [shareError, setShareError] = useState<string | null>(null);
	const [selectedTreeId, setSelectedTreeId] = useState(editableTreeId);
	const [linksOpen, setLinksOpen] = useState(false);
	const request = useRef(0);
	const selectId = useId();
	const [, startTransition] = useTransition();
	const treeId = editableTrees?.some(({ id }) => id === selectedTreeId)
		? selectedTreeId
		: editableTreeId;

	/**
	 * Load who has access, then show the panel.
	 *
	 * Fetched on OPEN rather than passed down with the view. Most sessions never share
	 * anything, so putting the member and invite lists in every page render would be two
	 * extra queries per visit plus other people's names and email addresses in the payload
	 * of a page that was not going to use them.
	 */
	const load = useCallback(
		(requestedTreeId = treeId) => {
			if (!requestedTreeId) return;
			const sequence = ++request.current;
			setShareError(null);
			startTransition(async () => {
				try {
					const next = await shareState(requestedTreeId);
					if (sequence === request.current) setState(next);
				} catch (caught) {
					if (sequence === request.current) setShareError(shareFailure(caught));
				}
			});
		},
		[treeId],
	);

	return (
		<>
			{treeId && (
				<button
					type="button"
					aria-label="Share family"
					className="kf-share-trigger"
					onClick={() => {
						setLinksOpen(false);
						setShareOpen(true);
						load();
					}}
				>
					<Share2 className="size-4" aria-hidden="true" />
					<span>Share</span>
				</button>
			)}
			<AccountMenu
				name={name}
				email={email}
				// Absent when there is nothing this viewer may share, so the menu shows two
				// items instead of one that refuses.
				onShare={
					treeId
						? () => {
								setLinksOpen(false);
								setShareOpen(true);
								load();
							}
						: undefined
				}
				onLinks={() => {
					request.current++;
					setState(null);
					setShareOpen(false);
					setLinksOpen(true);
				}}
			/>

			{treeId && shareOpen && (
				/*
				 * Fixed, and anchored under the header rather than to the menu button.
				 *
				 * The panel is 22rem and the header is the top of a full-height flex column, so
				 * a normally-positioned child would either stretch the header or be clipped by
				 * it. Fixed also means the canvas can pan underneath without dragging it along.
				 */
				<div className="kf-share-anchor fixed right-3 top-16 z-40 sm:right-6">
					{editableTrees && editableTrees.length > 1 && (
						<div className="mb-2 w-[min(23rem,calc(100vw-1.5rem))] rounded-2xl border border-hairline bg-surface p-3 shadow-(--kf-shadow-panel)">
							<label htmlFor={selectId} className="mb-1 block text-xs text-ink-muted">
								Family to share
							</label>
							<select
								id={selectId}
								value={treeId}
								onChange={(event) => {
									setSelectedTreeId(event.target.value);
									setState(null);
									load(event.target.value);
								}}
								// 16px: iOS Safari zooms the page into any field smaller than that,
								// and this page is a fixed-height canvas with nowhere to zoom to.
								className="min-h-11 w-full rounded-md border border-hairline bg-canvas px-2 text-base"
							>
								{editableTrees.map((tree) => (
									<option key={tree.id} value={tree.id}>
										{tree.name}
									</option>
								))}
							</select>
						</div>
					)}
					{/*
					 * A failed RE-read, after an invite or a removal. The list underneath is the
					 * one from before the change, so it must not sit there unannounced looking
					 * current.
					 */}
					{state && shareError && (
						<div
							role="alert"
							className="mb-2 flex w-[min(23rem,calc(100vw-1.5rem))] items-center gap-2 rounded-2xl border border-danger/40 bg-surface py-1 pr-1 pl-4 text-sm text-danger shadow-(--kf-shadow-panel)"
						>
							<p className="min-w-0 flex-1 py-2 leading-snug">{shareError}</p>
							<button
								type="button"
								className="min-h-11 shrink-0 rounded-lg px-3 text-accent-ink hover:bg-surface-raised"
								onClick={() => load()}
							>
								Try again
							</button>
						</div>
					)}
					{state ? (
						<SharePanel
							key={treeId}
							treeId={treeId}
							state={state}
							onClose={() => {
								request.current++;
								setState(null);
								setShareError(null);
								setShareOpen(false);
							}}
							// Re-read after every change, so revoking an invite or removing somebody
							// updates the list rather than leaving it describing the previous state.
							onChanged={() => load()}
						/>
					) : (
						<div className="w-[min(23rem,calc(100vw-1.5rem))] rounded-2xl border border-hairline bg-surface p-4 text-sm">
							<p role={shareError ? "alert" : "status"}>
								{shareError ?? "Loading family access..."}
							</p>
							<div className="mt-2 flex gap-2">
								{shareError && (
									<button
										type="button"
										className="min-h-11 rounded-lg px-3 text-accent-ink hover:bg-surface-raised"
										onClick={() => load()}
									>
										Try again
									</button>
								)}
								<button
									type="button"
									// 44 wide as well as tall: the word alone is about 36px.
									className="min-h-11 min-w-11 rounded-lg px-3 text-ink-muted hover:bg-surface-raised hover:text-ink"
									onClick={() => {
										request.current++;
										setShareOpen(false);
									}}
								>
									Close
								</button>
							</div>
						</div>
					)}
				</div>
			)}
			{linksOpen && (
				<div className="kf-share-anchor fixed right-3 top-16 z-40 sm:right-6">
					{/*
					 * The panel is its own chunk, and a deploy since this tab opened can have
					 * removed it. Without a boundary that rejection unmounted the whole page.
					 */}
					<LoadBoundary
						fallback={
							<div
								role="alert"
								className="w-[min(26rem,calc(100vw-1.5rem))] rounded-2xl border border-hairline-strong bg-surface p-4 text-sm shadow-(--kf-shadow-panel)"
							>
								<p className="leading-relaxed text-ink-muted">
									Family links could not be loaded. If Kinfolk was updated since this page opened,
									reloading fetches the new version.
								</p>
								<div className="mt-2 flex gap-2">
									<button
										type="button"
										className="min-h-11 rounded-lg px-3 text-accent-ink hover:bg-surface-raised"
										onClick={() => window.location.reload()}
									>
										Reload
									</button>
									<button
										type="button"
										className="min-h-11 min-w-11 rounded-lg px-3 text-ink-muted hover:bg-surface-raised hover:text-ink"
										onClick={() => setLinksOpen(false)}
									>
										Close
									</button>
								</div>
							</div>
						}
					>
						<Suspense
							fallback={
								<p
									role="status"
									className="rounded-2xl border border-hairline bg-surface p-4 text-sm"
								>
									Loading family links...
								</p>
							}
						>
							<LinkPanel onClose={() => setLinksOpen(false)} />
						</Suspense>
					</LoadBoundary>
				</div>
			)}
		</>
	);
}
