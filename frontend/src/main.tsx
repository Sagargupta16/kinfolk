/**
 * The SPA entry point.
 *
 * `app/globals.css` is imported directly rather than copied, so the design tokens,
 * the React Flow overrides and every `.kf-*` rule are the SAME file the Next app
 * uses. A second stylesheet would drift, and this repo's whole contrast and stroke
 * discipline lives in that one place.
 *
 * StrictMode is deliberately absent. It double-invokes effects in development, and
 * `TreeCanvas` runs ELK layout in an effect -- so every data change would lay the
 * graph out twice locally and behave differently from production, which is the
 * opposite of what a development warning should do.
 */
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import "@xyflow/react/dist/style.css";
import { MotionPreference } from "@/components/ui/MotionPreference";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element to mount into.");

createRoot(root).render(
	<MotionPreference>
		<App />
	</MotionPreference>,
);
