import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

function baseUrl(value: string, label: string): URL {
	const url = new URL(value);
	if (
		(url.protocol !== "https:" &&
			!(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(`${label} must be an HTTPS URL without credentials, query, or fragment.`);
	}
	if (!url.pathname.endsWith("/")) url.pathname += "/";
	return url;
}

async function response(url: URL, status: number | number[] = 200) {
	const result = await fetch(url, {
		redirect: "manual",
		cache: "no-store",
		signal: AbortSignal.timeout(20_000),
	});
	if (!(Array.isArray(status) ? status : [status]).includes(result.status))
		throw new Error(`${url.pathname}: HTTP ${result.status}, expected ${status}`);
	return result;
}

export async function checkApi(value: string, expectedCommit?: string) {
	const base = baseUrl(value, "PRODUCTION_URL");
	if (base.pathname !== "/") throw new Error("PRODUCTION_URL must be the API origin.");
	const health = (await (await response(new URL("api/health", base))).json()) as {
		status?: string;
		database?: string;
		auth?: string;
		commit?: string;
	};
	if (health.status !== "ready" || health.database !== "ready" || health.auth !== "configured") {
		throw new Error("API readiness failed.");
	}
	if (expectedCommit && health.commit !== expectedCommit) {
		throw new Error("The API is still serving another commit.");
	}
	const checks = await Promise.allSettled([
		(async () => {
			const html = await (await response(base)).text();
			if (!html.includes("_next/static") || !html.includes("Kinfolk"))
				throw new Error("The API origin is not serving Kinfolk.");
		})(),
		response(new URL("signin", base)),
		(async () => {
			const providers = (await (await response(new URL("api/auth/providers", base))).json()) as {
				github?: { id?: string; callbackUrl?: string };
			};
			if (
				providers.github?.id !== "github" ||
				providers.github.callbackUrl !== new URL("api/auth/callback/github", base).href
			) {
				throw new Error("The GitHub provider or callback URL is incorrect.");
			}
		})(),
		(async () => {
			const redirect = await response(new URL("tree", base), 307);
			if (
				new URL(redirect.headers.get("location") ?? "", base).href !== new URL("signin", base).href
			) {
				throw new Error("The signed-out tree does not redirect to sign-in.");
			}
		})(),
		response(new URL("api/tree", base), 401),
		(async () => {
			const body = (await (await response(new URL("api/tree?demo=1", base))).json()) as {
				view?: { isDemo?: boolean; nodes?: unknown[]; stats?: { people?: number } };
			};
			if (body.view?.isDemo !== true || !body.view.nodes?.length || !body.view.stats?.people) {
				throw new Error("The demo API did not return the sample graph.");
			}
		})(),
	]);
	const failed = checks.filter((result) => result.status === "rejected");
	if (failed.length) throw new Error(failed.map((result) => String(result.reason)).join("\n"));
}

export async function checkSpa(value: string, expectedCommit?: string) {
	const base = baseUrl(value, "SPA_URL");
	const html = await (await response(base)).text();
	if (!html.includes('id="root"') || !html.includes("<title>Kinfolk</title>")) {
		throw new Error("The Pages URL is not serving the Kinfolk app.");
	}
	if (expectedCommit && !html.includes(`name="kinfolk-commit" content="${expectedCommit}"`)) {
		throw new Error("Pages is still serving another commit.");
	}
	const deepLink = await (await response(new URL("tree", base), [200, 404])).text();
	if (
		!deepLink.includes('id="root"') ||
		!deepLink.includes("<title>Kinfolk</title>") ||
		(expectedCommit && !deepLink.includes(`name="kinfolk-commit" content="${expectedCommit}"`))
	) {
		throw new Error("The Pages tree deep link does not serve this Kinfolk app shell.");
	}
	const manifest = (await (await response(new URL("asset-manifest.json", base))).json()) as Record<
		string,
		{ file?: string; css?: string[]; assets?: string[] }
	>;
	const files = new Set(
		Object.values(manifest).flatMap((entry) => [
			...(entry.file ? [entry.file] : []),
			...(entry.css ?? []),
			...(entry.assets ?? []),
		]),
	);
	if (files.size === 0 || ![...files].some((file) => file.includes("TreeWorkspace"))) {
		throw new Error("Pages has no canvas asset in its manifest.");
	}
	files.add("theme-init.js");
	const checks = await Promise.allSettled(
		[...files].map(async (file) => {
			const url = new URL(file, base);
			if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
				throw new Error("Unexpected asset URL.");
			const asset = await response(url);
			const type = asset.headers.get("content-type") ?? "";
			if (
				(file.endsWith(".js") && !/javascript/.test(type)) ||
				(file.endsWith(".css") && !/text\/css/.test(type))
			) {
				throw new Error(`${file}: incorrect content type`);
			}
			if ((await asset.arrayBuffer()).byteLength === 0) throw new Error(`${file}: empty asset`);
		}),
	);
	const failed = checks.filter((result) => result.status === "rejected");
	if (failed.length) throw new Error(failed.map((result) => String(result.reason)).join("\n"));
}

async function main() {
	const apiOnly = process.argv.includes("--api");
	const spaOnly = process.argv.includes("--spa");
	if (apiOnly && spaOnly) throw new Error("Choose either --api or --spa, or omit both.");
	const wait = process.argv.includes("--wait");
	const expected = process.env.EXPECTED_COMMIT;
	const metadata = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	) as { homepage: string };
	const api = process.env.PRODUCTION_URL;
	const spa = process.env.SPA_URL ?? metadata.homepage;
	if (!spaOnly && !api) throw new Error("PRODUCTION_URL is required.");
	const attempts = wait ? 30 : 3;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			if (!spaOnly && api) await checkApi(api, expected);
			if (!apiOnly) await checkSpa(spa, expected);
			console.log("Kinfolk readiness, deployment identity, and requested surface checks passed.");
			return;
		} catch (error) {
			if (attempt === attempts) throw error;
			console.log(`Check ${attempt}/${attempts} did not pass; retrying.`);
			await setTimeout(10_000);
		}
	}
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
	void main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : "Production verification failed.");
		process.exitCode = 1;
	});
}
