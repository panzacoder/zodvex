import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const require = createRequire(join(root, "package.json"));

export const sha256 = (value) =>
	createHash("sha256").update(value).digest("hex");

/** Identify the actual built JS, rather than assuming dist matches checkout HEAD. */
export function digestBuild(directory) {
	const files = [];
	const visit = (relative = "") => {
		for (const entry of readdirSync(join(directory, relative), {
			withFileTypes: true,
		})) {
			const path = join(relative, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (/\.(?:js|mjs|cjs)$/.test(entry.name))
				files.push([path, sha256(readFileSync(join(directory, path)))]);
		}
	};
	visit();
	if (!files.length)
		throw new Error("Built JavaScript directory is empty; build Zodvex first");
	files.sort(([a], [b]) => a.localeCompare(b, "en"));
	return { sha256: sha256(JSON.stringify(files)), files: files.length };
}

export function captureProvenance() {
	const versions = Object.fromEntries(
		["convex", "convex-helpers", "zod", "zodvex"].map((name) => [
			name,
			JSON.parse(
				readFileSync(name === "zod" ? join(root, "versions", process.env.ZOD_RETRO_VERSION, "node_modules/zod/package.json") : join(root, "node_modules", name, "package.json"), "utf8"),
			).version,
		]),
	);
	versions.esbuild = createRequire(require.resolve("convex/package.json"))(
		"esbuild/package.json",
	).version;
	const sourceHashes = Object.fromEntries(
		readdirSync(here)
			.filter((name) => name.endsWith(".mjs") || name === "start-local.py")
			.sort()
			.map((name) => [name, sha256(readFileSync(join(here, name)))]),
	);
	return {
		sourceOrigin: JSON.parse(readFileSync(join(root, "source-origin.json"), "utf8")),
		retrospective: { zodVersion: process.env.ZOD_RETRO_VERSION, schemaHelpers: process.env.ZOD_RETRO_HELPERS === "on", round: Number(process.env.ZOD_RETRO_ROUND) },
		versions,
		zodvexBuild: digestBuild(join(root, "node_modules/zodvex/dist")),
		comparisonIdentity: {
			fixture: Object.fromEntries(
				["profile.mjs", "bundle.mjs"].map((name) => [name, sourceHashes[name]]),
			),
			collector: Object.fromEntries(
				["local.mjs", "oracle.mjs", "start-local.py"].map((name) => [
					name,
					sourceHashes[name],
				]),
			),
		},
		runtime: {
			nodeCompatibility: process.version,
			bun: process.versions.bun ?? null,
			platform: process.platform,
			arch: process.arch,
		},
		sourceHashes,
	};
}
