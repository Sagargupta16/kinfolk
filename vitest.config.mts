import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	envDir: false,
	resolve: {
		alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
	},
	test: {
		include: ["tests/**/*.test.{ts,tsx}"],
		environment: "node",
		setupFiles: ["./tests/setup.ts"],
		clearMocks: true,
		restoreMocks: true,
		unstubGlobals: true,
		unstubEnvs: true,
		testTimeout: 30_000,
		env: {
			DATABASE_URL: "",
			AUTH_SECRET: "test-only-not-a-real-secret",
			AUTH_GITHUB_ID: "",
			AUTH_GITHUB_SECRET: "",
		},
	},
});
