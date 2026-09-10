import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { MotionPreference } from "@/components/ui/MotionPreference";
import { MOTION_ATTR, THEME_ATTR, THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
	title: "Kinfolk",
	description: "Map the people around you, then join your graph to your relatives'.",
};

export const viewport: Viewport = {
	/**
	 * `maximumScale` is deliberately absent.
	 *
	 * The canvas has its own pinch-zoom, so locking the page scale is tempting -- and it
	 * would also disable the browser's own zoom, which is how a low-vision reader reads
	 * anything at all. React Flow already stops propagation on the gestures it handles,
	 * so the two do not fight.
	 */
	width: "device-width",
	initialScale: 1,
	/** Both, so the fixed toolbars stay on the right surface as the scheme changes. */
	themeColor: [
		{ media: "(prefers-color-scheme: dark)", color: "#0b1012" },
		{ media: "(prefers-color-scheme: light)", color: "#f5f7f8" },
	],
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html
			lang="en"
			// The server writes the DEFAULT, and the inline script below corrects it before
			// paint. Both attributes are present in the markup so CSS has something to match
			// even if the script is blocked.
			{...{ [THEME_ATTR]: "dark", [MOTION_ATTR]: "on" }}
			// The script mutates these two attributes before React hydrates, so the client
			// tree legitimately differs from the server's. Without this, every visitor with a
			// non-default theme gets a hydration mismatch warning for a difference we caused
			// on purpose.
			suppressHydrationWarning
		>
			<head>
				{/*
				 * Theme resolution, synchronous and above the body.
				 *
				 * A server render cannot read `localStorage`, so without this the first paint
				 * is whatever the markup said and the correct theme lands a frame later -- a
				 * white flash on the way into a dark canvas, which is the most-noticed bug in
				 * any theme implementation.
				 *
				 * `next/script` is not an option at any strategy: `beforeInteractive` still
				 * defers past first paint. It has to execute where it sits.
				 */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a render-blocking
				    inline script is the only way to set the theme before first paint, and the
				    content is a module-scope constant in lib/theme.ts with no interpolation. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
			</head>
			<body>
				<MotionPreference>{children}</MotionPreference>
			</body>
		</html>
	);
}
