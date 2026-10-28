/**
 * Capture the README screenshots and the Open Graph card from a running Kinfolk.
 *
 *   pnpm screenshots                                   # the live Pages app
 *   pnpm screenshots --base http://localhost:5173/     # a local `pnpm --dir frontend dev`
 *
 * Every shot is the read-only sample tree (`?demo=1`), so no account, token or real
 * family record is ever involved. Desktop and phone widths are both captured because
 * the phone layout (bottom sheets instead of a side panel) is different enough to
 * deserve its own picture.
 *
 * Output:
 *   docs/screenshots/*.webp      README images, WebP to keep the repository light
 *   app/opengraph-image.png      Next's file convention: the Vercel app's og:image
 *   frontend/public/og-image.png the Pages app's og:image, referenced in index.html
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import sharp from "sharp";

const args = process.argv.slice(2);
const baseFlag = args.indexOf("--base");
const base = new URL(
	(baseFlag >= 0 ? args[baseFlag + 1] : undefined) ?? "https://sagargupta.online/kinfolk/",
);
const demoUrl = new URL("tree?demo=1", base).toString();

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const OG = { width: 1200, height: 630 };

type Shot = {
	name: string;
	viewport: { width: number; height: number };
	scheme: "dark" | "light";
	/** Phone shots use touch emulation so the canvas picks its mobile layout. */
	mobile?: boolean;
	prepare?: (page: Page) => Promise<void>;
};

/** Settle animations and React Flow's fit-to-view before a capture. */
async function settle(page: Page, ms = 1200) {
	await page.waitForTimeout(ms);
}

async function openPerson(page: Page, name: string) {
	// Through search, as a visitor would: a card is not always inside the framed canvas
	// (0.8.1's taller gaps put Edward VII under the toolbar), and on the read-only sample
	// travelling to somebody opens their profile. The exact name, not a substring:
	// "Edward VII" is also the start of "Edward VIII".
	await page.getByLabel("Find a person in this graph").fill(name);
	await page
		.getByRole("button")
		.filter({ has: page.getByText(name, { exact: true }) })
		.first()
		.click();
	await settle(page, 1500);
}

async function zoomOut(page: Page, steps: number) {
	for (let i = 0; i < steps; i++) {
		await page.locator(".react-flow__controls-zoomout").click();
		await settle(page, 300);
	}
	await settle(page);
}

const shots: Shot[] = [
	{
		name: "tree-desktop-dark",
		viewport: DESKTOP,
		scheme: "dark",
		prepare: (page) => zoomOut(page, 1),
	},
	{
		name: "tree-desktop-light",
		viewport: DESKTOP,
		scheme: "light",
		prepare: (page) => zoomOut(page, 1),
	},
	{
		name: "person-desktop-dark",
		viewport: DESKTOP,
		scheme: "dark",
		prepare: (page) => openPerson(page, "Edward VII"),
	},
	{
		name: "people-desktop-dark",
		viewport: DESKTOP,
		scheme: "dark",
		prepare: async (page) => {
			await page.getByRole("button", { name: "People", exact: true }).click();
			await settle(page);
		},
	},
	{
		name: "person-phone-dark",
		viewport: PHONE,
		scheme: "dark",
		mobile: true,
		prepare: (page) => openPerson(page, "George VI"),
	},
];

const browser = await chromium.launch();
await mkdir("docs/screenshots", { recursive: true });

async function capture(shot: Shot): Promise<Buffer> {
	const context = await browser.newContext({
		viewport: shot.viewport,
		deviceScaleFactor: shot.mobile ? 2 : 1,
		colorScheme: shot.scheme,
		isMobile: shot.mobile ?? false,
		hasTouch: shot.mobile ?? false,
	});
	const page = await context.newPage();
	await page.goto(demoUrl, { waitUntil: "networkidle" });
	await page.locator(".react-flow__node-person").first().waitFor();
	await settle(page, 2000);
	await shot.prepare?.(page);
	const png = await page.screenshot();
	await context.close();
	return png;
}

const captured = new Map<string, Buffer>();
for (const shot of shots) {
	const png = await capture(shot);
	captured.set(shot.name, png);
	const out = `docs/screenshots/${shot.name}.webp`;
	const webp = await sharp(png).webp({ quality: 82 }).toBuffer();
	await writeFile(out, webp);
	console.log(`${out}  ${(webp.length / 1024).toFixed(0)} KiB`);
}

/**
 * The Open Graph card is composed rather than screenshotted whole: at 1200x630 the
 * app chrome (header, sample banner, toolbar) takes a third of the frame, and a link
 * preview on a phone is small enough that only a headline and the graph itself read.
 * So the canvas strip of the desktop shot is cropped out and set under a headline in
 * the app's own fonts and dark-theme tokens.
 */
const tree = captured.get("tree-desktop-dark");
if (!tree) throw new Error("The desktop tree shot is needed for the Open Graph card.");
const strip = await sharp(tree)
	.extract({ left: 0, top: 236, width: DESKTOP.width, height: 396 })
	.resize({ width: OG.width })
	.png()
	.toBuffer();

async function fontFace(family: string, file: string) {
	const data = await readFile(`node_modules/@fontsource-variable/${file}`);
	return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data.toString("base64")}) format("woff2");font-weight:100 900;}`;
}

const fonts = [
	await fontFace(
		"Bricolage",
		"bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2",
	),
	await fontFace("Inter", "inter/files/inter-latin-wght-normal.woff2"),
	await fontFace("Mono", "jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"),
].join("");

const card = `<!doctype html><html><head><style>${fonts}
	* { margin: 0; box-sizing: border-box; }
	body { width: ${OG.width}px; height: ${OG.height}px; background: #0b1012; color: #f4f6f7; overflow: hidden; position: relative; }
	.copy { position: absolute; inset: 56px 64px auto 64px; }
	.label { font: 500 20px Mono; letter-spacing: 0.08em; color: #94a3ac; text-transform: uppercase; }
	.label b { color: #60a5fa; font-weight: 600; }
	h1 { margin-top: 18px; font: 650 68px/1.02 Bricolage; letter-spacing: -0.02em; }
	p { margin-top: 18px; max-width: 760px; font: 400 26px/1.35 Inter; color: #b1bec6; }
	.url { position: absolute; top: 56px; right: 64px; font: 500 20px Mono; color: #7db6fc; }
	.strip { position: absolute; left: 0; right: 0; bottom: 0; height: 330px; border-top: 1px solid #263137;
		background: url(data:image/png;base64,${strip.toString("base64")}) center top / cover no-repeat; }
	.strip::before { content: ""; position: absolute; inset: 0; background: linear-gradient(#0b1012 0%, transparent 28%); }
</style></head><body>
	<div class="copy">
		<div class="label"><b>Kinfolk</b> / family atlas</div>
		<h1>A family tree is not a tree.</h1>
		<p>Each relative keeps their own record. Consent links join them into one graph.</p>
	</div>
	<div class="url">sagargupta.online/kinfolk</div>
	<div class="strip"></div>
</body></html>`;

const ogContext = await browser.newContext({ viewport: OG, deviceScaleFactor: 1 });
const ogPage = await ogContext.newPage();
await ogPage.setContent(card, { waitUntil: "load" });
await ogPage.evaluate(() => document.fonts.ready);
const og = await ogPage.screenshot();
await ogContext.close();

const ogPng = await sharp(og).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
for (const out of ["app/opengraph-image.png", "frontend/public/og-image.png"]) {
	await writeFile(out, ogPng);
	console.log(`${out}  ${(ogPng.length / 1024).toFixed(0)} KiB`);
}

await browser.close();
