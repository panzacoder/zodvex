import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "vitest";
import { compareCollections, formatComparison } from "./compare.mjs";
import { expectedGraphResult } from "./oracle.mjs";
import { digestBuild } from "./provenance.mjs";

const temporary = [];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const scratch = () => {
	const dir = mkdtempSync(join(tmpdir(), "zodvex-memory-compare-"));
	temporary.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of temporary.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

// Synthetic saved evidence, with deliberately different zero-control readings.
function collection(
	delta,
	{ build = "a", change = () => {}, changeRows = () => {} } = {},
) {
	const directory = scratch();
	const manifest = {
		format: "zodvex-local-memory-v1",
		runId: randomUUID(),
		startedAt: "2026-09-09T20:00:00.000Z",
		gitCommit: "commit",
		gitStatus: "",
		versions: {
			convex: "1",
			"convex-helpers": "2",
			zod: "4",
			esbuild: "5",
			zodvex: build,
		},
		zodvexBuild: { sha256: hash(build), files: 1 },
		runtime: {
			nodeCompatibility: "v24",
			bun: "1.3",
			platform: "darwin",
			arch: "arm64",
		},
		comparisonIdentity: {
			fixture: { "profile.mjs": hash("profile"), "bundle.mjs": hash("bundle") },
			collector: {
				"local.mjs": hash("local"),
				"oracle.mjs": hash("oracle"),
				"start-local.py": hash("launcher"),
			},
		},
		metadata: {
			sha256: hash("backend"),
			sourceRevision: null,
			flags: "--expose-gc --trace-gc-nvp",
			reuseIsolates: false,
		},
		targetCount: 128,
		width: 32,
		profile: "codec-rich",
		entries: 0,
		mode: "static",
		diagnosticForcedGc: true,
		plannedCalls: 8,
	};
	change(manifest);
	const rows = [0, 128].flatMap((count) =>
		["native", "helpers", "full", "mini"].map((kind, index) => {
			const id = randomUUID(),
				total = 1000 + index * 100 + (count ? delta : 0);
			const dimensions = {
				kind,
				count,
				width: 32,
				profile: "codec-rich",
				entries: 0,
				nonce: id,
			};
			const source = `// Saved ${id}`;
			mkdirSync(join(directory, "sources"), { recursive: true });
			writeFileSync(join(directory, "sources", `${id}.js`), source);
			return {
				...dimensions,
				id,
				mode: "static",
				diagnosticForcedGc: true,
				valid: true,
				status: 200,
				verificationError: null,
				bundleHash: hash(source),
				totalRetainedObjectBytes: total,
				raw: { status: "success", value: expectedGraphResult(dimensions) },
				gc: Array.from({ length: 2 }, () => ({
					identity: "[1:2]",
					reason: "testing",
					gc: "mc",
					end_object_size: total,
				})),
			};
		}),
	);
	changeRows(rows);
	const manifestText = JSON.stringify(manifest),
		callsText = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
	writeFileSync(join(directory, "manifest.json"), manifestText);
	writeFileSync(join(directory, "calls.jsonl"), callsText);
	writeFileSync(
		join(directory, "summary.json"),
		JSON.stringify({
			format: manifest.format,
			runId: manifest.runId,
			completedAt: "2026-09-09T20:01:00.000Z",
			valid: true,
			plannedCalls: 8,
			observedCalls: rows.length,
			manifestSha256: hash(manifestText),
			callsSha256: hash(callsText),
		}),
	);
	return directory;
}

test("compares per-collection matched zero deltas before taking the median and range", () => {
	const result = compareCollections(
		[collection(100), collection(300), collection(200)],
		[
			collection(80, { build: "b" }),
			collection(140, { build: "b" }),
			collection(120, { build: "b" }),
		],
	);
	assert.equal(result.comparisons.length, 4);
	assert.deepEqual(result.comparisons[2], {
		kind: "full",
		baseline: { count: 3, median: 200, min: 100, max: 300 },
		candidate: { count: 3, median: 120, min: 80, max: 140 },
		changeBytes: -80,
		changePercent: -40,
		baselineBytesPerModel: 1.5625,
		candidateBytesPerModel: 0.9375,
	});
	assert.match(formatComparison(result), /-40\.00%/);
	assert.equal(result.warnings.length, 0);
});

test("rejects incompatible dependencies, shape, fixture, collector, backend and runtime", () => {
	const baseline = collection(100);
	for (const change of [
		(m) => {
			m.versions.zod = "different";
		},
		(m) => {
			delete m.versions.esbuild;
		},
		(m) => {
			m.width = 8;
		},
		(m) => {
			m.comparisonIdentity.fixture["profile.mjs"] = hash("changed");
		},
		(m) => {
			m.comparisonIdentity.collector["local.mjs"] = hash("changed");
		},
		(m) => {
			m.metadata.sha256 = hash("changed");
		},
		(m) => {
			m.metadata.flags = "different";
		},
		(m) => {
			m.runtime.arch = "different";
		},
		(m) => {
			delete m.zodvexBuild;
		},
	])
		assert.throws(() =>
			compareCollections([baseline], [collection(80, { change })]),
		);
});

test("ignores backend process locations and git metadata, while identifying library builds", () => {
	const baseline = collection(100);
	const candidate = collection(80, {
		build: "b",
		change: (m) => {
			m.metadata.pid = 999;
			m.metadata.url = "http://127.0.0.1:1234";
			m.metadata.binary = "/different/path";
			m.gitCommit = "different";
			m.gitStatus = "M file";
		},
	});
	assert.equal(
		compareCollections([baseline], [candidate]).comparisons[0].changePercent,
		-20,
	);
	assert.throws(
		() => compareCollections([baseline, candidate], [collection(80)]),
		/build|version/i,
	);
});

test("rejects partial, duplicate, corrupted, invalid and oracle-failing evidence", () => {
	const baseline = collection(100);
	for (const changeRows of [
		(rows) => {
			rows.pop();
		},
		(rows) => {
			rows[7] = rows[6];
		},
		(rows) => {
			rows[0].valid = false;
		},
		(rows) => {
			rows[0].totalRetainedObjectBytes = null;
		},
		(rows) => {
			rows[0].raw.value.output.secret = "wrong";
		},
		(rows) => {
			rows[0].gc[1].identity = "[other]";
		},
	])
		assert.throws(() =>
			compareCollections([baseline], [collection(80, { changeRows })]),
		);
	const candidate = collection(80);
	rmSync(join(candidate, "summary.json"));
	assert.throws(() => compareCollections([baseline], [candidate]));
	const corrupt = collection(80);
	writeFileSync(
		join(corrupt, "calls.jsonl"),
		readFileSync(join(corrupt, "calls.jsonl"), "utf8") + "\n",
	);
	assert.throws(
		() => compareCollections([baseline], [corrupt]),
		/hash|digest/i,
	);
	assert.throws(
		() => compareCollections([baseline, baseline], [collection(80)]),
		/duplicate|reused/i,
	);
});

test("single collections remain descriptive and a zero baseline has no percentage", () => {
	const result = compareCollections([collection(0)], [collection(80)]);
	assert.equal(result.comparisons[0].changePercent, null);
	assert.equal(result.warnings.length, 1);
	assert.match(formatComparison(result), /unavailable/);
});

test("CLI emits JSON for compatible evidence and fails for an incomplete collection", () => {
	const baseline = collection(100),
		candidate = collection(80);
	const args = [
		fileURLToPath(new URL("./compare.mjs", import.meta.url)),
		`--baseline=${baseline}`,
		`--candidate=${candidate}`,
		"--json",
	];
	const success = spawnSync(process.execPath, args, { encoding: "utf8" });
	assert.equal(success.status, 0, success.stderr);
	assert.equal(JSON.parse(success.stdout).comparisons[0].changeBytes, -20);
	rmSync(join(candidate, "summary.json"));
	const failure = spawnSync(process.execPath, args, { encoding: "utf8" });
	assert.equal(failure.status, 1);
	assert.match(failure.stderr, /Cannot compare/);
	assert.equal(failure.stdout, "");
});

test("build digest follows runtime JS content, independently of filesystem order and declarations", () => {
	const directory = scratch();
	writeFileSync(join(directory, "index.js"), "export const x = 1;");
	const original = digestBuild(directory);
	writeFileSync(join(directory, "index.d.ts"), "declare const x: number;");
	assert.deepEqual(digestBuild(directory), original);
	writeFileSync(join(directory, "index.js"), "export const x = 2;");
	assert.notEqual(digestBuild(directory).sha256, original.sha256);
	assert.throws(() => digestBuild(scratch()), /empty|JavaScript/i);
});
