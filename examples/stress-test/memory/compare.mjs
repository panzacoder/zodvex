import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { assertGraphResult } from "./oracle.mjs";
import { sha256 } from "./provenance.mjs";

const kinds = ["native", "helpers", "full", "mini"];
const format = "zodvex-local-memory-v1";
const digestPattern = /^[a-f0-9]{64}$/;
const requireValue = (condition, message) => {
	if (!condition) throw new Error(message);
};
const same = (actual, expected, label) =>
	requireValue(
		isDeepStrictEqual(actual, expected),
		`Incompatible ${label}: ${JSON.stringify(actual)} versus ${JSON.stringify(expected)}`,
	);

function contract(manifest) {
	const {
		comparisonIdentity: identity,
		metadata: backend,
		runtime,
		versions,
		targetCount,
		width,
		profile,
		entries,
		mode,
		diagnosticForcedGc,
	} = manifest;
	requireValue(
		Number.isInteger(targetCount) &&
			targetCount >= 1 &&
			targetCount <= 512 &&
			Number.isInteger(width) &&
			width >= 1 &&
			width <= 64 &&
			["codec-rich", "fields-only"].includes(profile) &&
			entries === 0 &&
			mode === "static" &&
			diagnosticForcedGc === true,
		"Missing or unsupported local fixture dimensions",
	);
	for (const [group, names] of Object.entries({
		fixture: ["profile.mjs", "bundle.mjs"],
		collector: ["local.mjs", "oracle.mjs", "start-local.py"],
	}))
		for (const name of names)
			requireValue(
				digestPattern.test(identity?.[group]?.[name]),
				`Missing ${group} identity: ${name}`,
			);
	requireValue(
		digestPattern.test(backend?.sha256) &&
			(backend.sourceRevision === null ||
				typeof backend.sourceRevision === "string") &&
			typeof backend.flags === "string" &&
			backend.flags.length > 0 &&
			backend.reuseIsolates === false,
		"Missing or unsupported backend provenance",
	);
	for (const key of ["nodeCompatibility", "platform", "arch"])
		requireValue(
			typeof runtime?.[key] === "string" && runtime[key].length > 0,
			`Missing runtime ${key}`,
		);
	requireValue(
		runtime.bun === null || typeof runtime.bun === "string",
		"Missing runtime bun",
	);
	const dependencies = Object.fromEntries(
		["convex", "convex-helpers", "zod", "esbuild"].map((name) => {
			requireValue(
				typeof versions?.[name] === "string" && versions[name].length > 0,
				`Missing dependency version ${name}`,
			);
			return [name, versions[name]];
		}),
	);
	requireValue(
		typeof versions.zodvex === "string" &&
			digestPattern.test(manifest.zodvexBuild?.sha256) &&
			Number.isInteger(manifest.zodvexBuild.files) &&
			manifest.zodvexBuild.files > 0,
		"Missing library build identity",
	);
	return {
		shape: { targetCount, width, profile, entries, mode, diagnosticForcedGc },
		fixture: identity.fixture,
		collector: identity.collector,
		dependencies,
		runtime,
		backend: {
			sha256: backend.sha256,
			sourceRevision: backend.sourceRevision,
			flags: backend.flags,
			reuseIsolates: backend.reuseIsolates,
		},
	};
}

function loadCollection(directory) {
	directory = realpathSync(directory);
	const manifestText = readFileSync(join(directory, "manifest.json"), "utf8");
	const callsText = readFileSync(join(directory, "calls.jsonl"), "utf8");
	const manifest = JSON.parse(manifestText);
	const summary = JSON.parse(
		readFileSync(join(directory, "summary.json"), "utf8"),
	);
	requireValue(
		manifest.format === format && summary.format === format,
		"Missing supported local completion format; rerun older evidence",
	);
	requireValue(
		typeof manifest.runId === "string" &&
			manifest.runId.length > 0 &&
			summary.runId === manifest.runId,
		"Missing or inconsistent collection identity",
	);
	requireValue(
		summary.valid === true &&
			Number.isFinite(Date.parse(manifest.startedAt)) &&
			Number.isFinite(Date.parse(summary.completedAt)) &&
			Date.parse(summary.completedAt) >= Date.parse(manifest.startedAt),
		"Incomplete or invalid local collection",
	);
	requireValue(
		summary.manifestSha256 === sha256(manifestText) &&
			summary.callsSha256 === sha256(callsText),
		"Saved evidence hash mismatch",
	);
	const compatibility = contract(manifest);
	const rows = callsText
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	requireValue(
		manifest.plannedCalls === 8 &&
			summary.plannedCalls === 8 &&
			summary.observedCalls === 8 &&
			rows.length === 8,
		"Partial collection: expected four variants with zero and target controls",
	);
	const ids = new Set(),
		cells = new Map();
	for (const row of rows) {
		requireValue(
			typeof row.id === "string" &&
				/^[a-zA-Z0-9-]+$/.test(row.id) &&
				!ids.has(row.id),
			"Missing or duplicate call identity",
		);
		ids.add(row.id);
		requireValue(
			kinds.includes(row.kind) && [0, manifest.targetCount].includes(row.count),
			"Unexpected measurement cell",
		);
		for (const name of [
			"width",
			"profile",
			"entries",
			"mode",
			"diagnosticForcedGc",
		])
			same(row[name], manifest[name], `row ${name}`);
		const key = `${row.kind}:${row.count}`;
		requireValue(!cells.has(key), "Duplicate measurement cell");
		requireValue(
			row.valid === true &&
				row.verificationError === null &&
				row.status >= 200 &&
				row.status < 300 &&
				row.raw?.status === "success" &&
				Number.isSafeInteger(row.totalRetainedObjectBytes) &&
				row.totalRetainedObjectBytes > 0,
			"Invalid retained-byte measurement",
		);
		assertGraphResult(row.raw.value, { ...row, nonce: row.id });
		requireValue(
			Array.isArray(row.gc) &&
				row.gc.length >= 2 &&
				row.gc.every(
					(record) =>
						record.identity &&
						record.identity === row.gc[0].identity &&
						record.gc === "mc" &&
						record.reason === "testing" &&
						Number.isSafeInteger(record.end_object_size) &&
						record.end_object_size > 0,
				) &&
				row.gc.at(-1).end_object_size === row.totalRetainedObjectBytes,
			"Invalid or mismatched GC records",
		);
		const source = readFileSync(join(directory, "sources", `${row.id}.js`));
		requireValue(
			row.bundleHash === sha256(source),
			"Saved bundle hash mismatch",
		);
		cells.set(key, row.totalRetainedObjectBytes);
	}
	const deltas = Object.fromEntries(
		kinds.map((kind) => {
			requireValue(
				cells.has(`${kind}:0`) && cells.has(`${kind}:${manifest.targetCount}`),
				"Missing matched zero control",
			);
			return [
				kind,
				cells.get(`${kind}:${manifest.targetCount}`) - cells.get(`${kind}:0`),
			];
		}),
	);
	return { directory, manifest, compatibility, deltas, ids: [...ids] };
}

function stats(values) {
	const sorted = [...values].sort((a, b) => a - b),
		middle = Math.floor(sorted.length / 2);
	return {
		count: sorted.length,
		median:
			sorted.length % 2
				? sorted[middle]
				: (sorted[middle - 1] + sorted[middle]) / 2,
		min: sorted[0],
		max: sorted.at(-1),
	};
}

/** Read-only comparison. A performance change never changes the command's exit code. */
export function compareCollections(baselineDirectories, candidateDirectories) {
	requireValue(
		baselineDirectories.length > 0 && candidateDirectories.length > 0,
		"Explicit baseline and candidate directories are required",
	);
	const seenRuns = new Set(),
		seenCalls = new Set();
	const groups = [baselineDirectories, candidateDirectories].map(
		(directories) =>
			directories.map((directory) => {
				let run;
				try {
					run = loadCollection(directory);
				} catch (error) {
					throw new Error(`${directory}: ${error.message}`);
				}
				requireValue(
					!seenRuns.has(run.manifest.runId) &&
						run.ids.every((id) => !seenCalls.has(id)),
					"Duplicate or reused collection/calls; repeats must be independent",
				);
				seenRuns.add(run.manifest.runId);
				for (const id of run.ids) seenCalls.add(id);
				return run;
			}),
	);
	const reference = groups[0][0];
	for (const group of groups)
		for (const run of group) {
			for (const [name, value] of Object.entries(reference.compatibility))
				same(run.compatibility[name], value, name);
			same(
				run.manifest.zodvexBuild,
				group[0].manifest.zodvexBuild,
				"library build within a repeat group",
			);
			same(
				run.manifest.versions.zodvex,
				group[0].manifest.versions.zodvex,
				"library version within a repeat group",
			);
		}
	const identify = (group) =>
		group.map(({ directory, manifest }) => ({
			directory,
			runId: manifest.runId,
			startedAt: manifest.startedAt,
			gitCommit: manifest.gitCommit,
			gitStatus: manifest.gitStatus,
			libraryVersion: manifest.versions.zodvex,
			buildSha256: manifest.zodvexBuild.sha256,
		}));
	return {
		scope:
			"Local Convex retained object-byte deltas after forced GC; descriptive comparison, no performance gate",
		contract: reference.compatibility,
		baseline: identify(groups[0]),
		candidate: identify(groups[1]),
		warnings: groups.some((group) => group.length < 3)
			? [
					"Fewer than three independent collections on one or both sides; repeat before interpreting small changes.",
				]
			: [],
		comparisons: kinds.map((kind) => {
			const [baseline, candidate] = groups.map((group) =>
				stats(group.map((run) => run.deltas[kind])),
			);
			const changeBytes = candidate.median - baseline.median;
			return {
				kind,
				baseline,
				candidate,
				changeBytes,
				changePercent:
					baseline.median === 0 ? null : (changeBytes / baseline.median) * 100,
				baselineBytesPerModel: baseline.median / reference.manifest.targetCount,
				candidateBytesPerModel:
					candidate.median / reference.manifest.targetCount,
			};
		}),
	};
}

export function formatComparison(report) {
	const { targetCount, width, profile } = report.contract.shape;
	const sample = (value) => `${value.median} [${value.min}, ${value.max}]`;
	return `# Local model graph memory comparison

${report.scope}.

${targetCount} background models + one probe; width ${width}; ${profile}; static; zero registry entries.
Each sample subtracts the same collection's zero-model control. Values are bytes; brackets show observed min/max, not confidence intervals.

Baseline: ${report.baseline.length} collection(s), Zodvex ${report.baseline[0].libraryVersion}, built JS SHA-256 ${report.baseline[0].buildSha256}.
Candidate: ${report.candidate.length} collection(s), Zodvex ${report.candidate[0].libraryVersion}, built JS SHA-256 ${report.candidate[0].buildSha256}.
Backend SHA-256: ${report.contract.backend.sha256}; dependencies: ${JSON.stringify(report.contract.dependencies)}.

${report.warnings.join("\n")}

| Variant | Baseline delta median [min, max] | Candidate delta median [min, max] | Change bytes | Change % | Bytes/model baseline → candidate |
|---|---:|---:|---:|---:|---:|
${report.comparisons.map((row) => `| ${row.kind} | ${sample(row.baseline)} | ${sample(row.candidate)} | ${row.changeBytes} | ${row.changePercent === null ? "unavailable" : `${row.changePercent.toFixed(2)}%`} | ${row.baselineBytesPerModel.toFixed(2)} → ${row.candidateBytesPerModel.toFixed(2)} |`).join("\n")}

Negative change means fewer retained bytes. Bytes/model is an average at this count, not a sizing formula. Hosted capacity and construction peaks require separate measurements.
`;
}

if (
	process.argv[1] &&
	realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		const args = process.argv.slice(2);
		if (args.includes("--help")) {
			console.log(
				"bun memory/compare.mjs --baseline=DIR[,DIR,DIR] --candidate=DIR[,DIR,DIR] [--json]",
			);
		} else {
			const options = new Map();
			for (const arg of args) {
				const match = /^--(baseline|candidate)=(.+)$/.exec(arg);
				if (match) {
					requireValue(
						!options.has(match[1]),
						`Duplicate option --${match[1]}`,
					);
					options.set(match[1], match[2].split(","));
				} else requireValue(arg === "--json", `Unknown option ${arg}`);
			}
			const report = compareCollections(
				options.get("baseline") || [],
				options.get("candidate") || [],
			);
			console.log(
				args.includes("--json")
					? JSON.stringify(report, null, 2)
					: formatComparison(report),
			);
		}
	} catch (error) {
		console.error(`Cannot compare: ${error.message}`);
		process.exitCode = 1;
	}
}
