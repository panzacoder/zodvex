import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(join(root, "package.json"));

export function captureProvenance() {
	const versions = Object.fromEntries(
		["convex", "convex-helpers", "zod", "zodvex"].map((name) => [
			name,
			JSON.parse(
				readFileSync(join(root, "node_modules", name, "package.json"), "utf8"),
			).version,
		]),
	);
	versions.esbuild = createRequire(require.resolve("convex/package.json"))(
		"esbuild/package.json",
	).version;
	const git = (args) => {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		if (result.status !== 0)
			throw new Error(
				`Cannot capture benchmark git provenance: ${result.error?.message || result.stderr.trim()}`,
			);
		return result.stdout.trim();
	};
	return {
		gitCommit: git(["rev-parse", "HEAD"]),
		gitStatus: git(["status", "--short"]),
		versions,
		runtime: {
			nodeCompatibility: process.version,
			bun: process.versions.bun ?? null,
			platform: process.platform,
			arch: process.arch,
		},
		sourceHashes: Object.fromEntries(
			readdirSync(here)
				.filter((name) => name.endsWith(".mjs"))
				.map((name) => [
					name,
					createHash("sha256")
						.update(readFileSync(join(here, name)))
						.digest("hex"),
				]),
		),
	};
}
