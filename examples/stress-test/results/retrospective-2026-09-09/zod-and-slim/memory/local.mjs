import {
	readFileSync,
	appendFileSync,
	writeFileSync,
	mkdirSync,
} from "node:fs";
import { bundleProbe } from "./bundle.mjs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertGraphResult } from "./oracle.mjs";
import { captureProvenance, sha256 } from "./provenance.mjs";
const [dir, countText = "128", widthText = "32", profile = "codec-rich"] =
	process.argv.slice(2);
const targetCount = Number(countText),
	width = Number(widthText);
if (
	!dir ||
	!Number.isInteger(targetCount) ||
	targetCount < 1 ||
	targetCount > 512 ||
	!Number.isInteger(width) ||
	width < 1 ||
	width > 64 ||
	!["codec-rich", "fields-only"].includes(profile)
)
	throw new Error(
		"Usage: bun memory/local.mjs BACKEND_DIR [COUNT=128] [WIDTH=32] [PROFILE=codec-rich]",
	);
const metadata = JSON.parse(readFileSync(dir + "/metadata.json", "utf8"));
if (
	!["127.0.0.1", "localhost", "[::1]"].includes(
		new URL(metadata.url).hostname,
	) ||
	metadata.reuseIsolates !== false
)
	throw new Error("Dedicated local backend with fresh isolates required");
const key = readFileSync(dir + "/admin-key", "utf8").trim();
const log = dir + "/backend-pty.log";
const out = fileURLToPath(
	new URL(
		"../results/local/memory-heap-" + randomUUID() + "/",
		import.meta.url,
	),
);
mkdirSync(out + "sources", { recursive: true });
const output = out + "calls.jsonl";
const provenance = captureProvenance();
const manifest = {
	format: "zodvex-retrospective-memory-v1",
	runId: randomUUID(),
	startedAt: new Date().toISOString(),
	...provenance,
	metadata,
	targetCount,
	width,
	profile,
	entries: 0,
	mode: "static",
	diagnosticForcedGc: true,
	plannedCalls: 8,
	scope:
		"Retained local Convex V8 object bytes after forced GC, not external/peak/hosted memory",
};
writeFileSync(out + "manifest.json", JSON.stringify(manifest, null, 2));
const observations = [];
for (const count of [0, targetCount])
	for (const kind of ["native", "helpers", "full", "mini"]) {
		const dimensions = { count, width, profile, entries: 0 };
		const id = crypto.randomUUID();
		const { source, bytes, inputs } = await bundleProbe(kind, dimensions, {
			mode: "static",
			gc: "after-operation",
			nonce: id,
		});
		writeFileSync(out + "sources/" + id + ".js", source);
		writeFileSync(out + "sources/" + id + ".inputs.json", JSON.stringify(inputs, null, 2));
		const offset = readFileSync(log).length;
		const response = await fetch(metadata.url + "/api/run_test_function", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				adminKey: key,
				args: {},
				bundle: { path: "testQuery.js", source },
				format: "convex_encoded_json",
			}),
			signal: AbortSignal.timeout(20000),
		});
		const raw = await response.json();
		let records = [],
			excerpt = "",
			lastLength = -1,
			quiet = 0;
		const deadline = Date.now() + 1000;
		do {
			await new Promise((resolve) => setTimeout(resolve, 30));
			excerpt = readFileSync(log).subarray(offset).toString();
			quiet = excerpt.length === lastLength ? quiet + 1 : 0;
			lastLength = excerpt.length;
			records = excerpt.split("\n").flatMap((line) => {
				const at = line.indexOf("GC: {");
				if (at < 0) return [];
				try {
					const gc = JSON.parse(line.slice(at + 4).trim());
					return gc.reason === "testing"
						? [{ identity: line.slice(0, at).match(/^\[[^\]]+\]/)?.[0], ...gc }]
						: [];
				} catch {
					return [];
				}
			});
		} while ((records.length < 2 || quiet < 3) && Date.now() < deadline);
		let verificationError = null;
		try {
			assertGraphResult(raw.value, { ...dimensions, kind, nonce: id });
		} catch (error) {
			verificationError = error.message;
		}
		const valid =
			!verificationError &&
			response.ok &&
			raw.status === "success" &&
			raw.value?.nonce === id &&
			records.length >= 2 &&
			quiet >= 3 &&
			records.every(
				(r) =>
					r.identity &&
					r.gc === "mc" &&
					Number.isFinite(r.end_object_size) &&
					r.end_object_size > 0,
			) &&
			new Set(records.map((r) => r.identity)).size === 1;
		const retained = {
			afterStaticGraphAndOperation: records.at(-1)?.end_object_size ?? null,
		};
		const row = {
			timestamp: new Date().toISOString(),
			bundleHash: sha256(source),
			inputsHash: sha256(JSON.stringify(inputs, null, 2)),
			verificationError,
			id,
			kind,
			...dimensions,
			mode: "static",
			diagnosticForcedGc: true,
			backend: metadata,
			bytes,
			status: response.status,
			valid,
			retained,
			totalRetainedObjectBytes: valid
				? retained.afterStaticGraphAndOperation
				: null,
			raw,
			gc: records,
		};
		appendFileSync(output, JSON.stringify(row) + "\n");
		observations.push(row);
		writeFileSync(out + `gc-${id}.log`, excerpt);
		console.log(
			JSON.stringify({
				kind,
				count,
				valid,
				retained,
				bytes: row.totalRetainedObjectBytes,
				error: valid ? undefined : raw,
			}),
		);
		if (!valid) throw new Error("Invalid Convex heap diagnostic");
	}

// Do not certify a collection if its library, dependencies or measurement code
// changed while it was running. Individual observations remain available.
const finalProvenance = captureProvenance();
for (const key of ["zodvexBuild", "versions", "runtime", "comparisonIdentity"])
	if (!isDeepStrictEqual(provenance[key], finalProvenance[key]))
		throw new Error(
			`${key} changed during collection; rerun with a stable build`,
		);
writeFileSync(
	out + "summary.json",
	JSON.stringify(
		{
			format: manifest.format,
			runId: manifest.runId,
			completedAt: new Date().toISOString(),
			valid: true,
			plannedCalls: manifest.plannedCalls,
			observedCalls: observations.length,
			manifestSha256: sha256(readFileSync(out + "manifest.json")),
			callsSha256: sha256(readFileSync(output)),
			deltas: ["native", "helpers", "full", "mini"].map((kind) => {
				const control = observations.find(
					(row) => row.kind === kind && row.count === 0,
				);
				const target = observations.find(
					(row) => row.kind === kind && row.count === targetCount,
				);
				const deltaBytes =
					target.totalRetainedObjectBytes - control.totalRetainedObjectBytes;
				return {
					kind,
					controlBytes: control.totalRetainedObjectBytes,
					targetBytes: target.totalRetainedObjectBytes,
					deltaBytes,
					bytesPerModel: deltaBytes / targetCount,
				};
			}),
		},
		null,
		2,
	),
);
console.log("Evidence: " + out);
