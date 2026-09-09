// Optional graph-capacity experiment: no deployment push or database data reads.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { bundleProbe } from "./bundle.mjs";
import { connect } from "./mcp-client.mjs";
import { assertGraphResult, decodeMcpResult } from "./oracle.mjs";
import { captureProvenance } from "./provenance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const options = new Map(
	process.argv.slice(2).map((arg) => {
		if (!arg.startsWith("--")) throw new Error("Use --name=value arguments");
		const [key, ...value] = arg.slice(2).split("=");
		return [key, value.join("=")];
	}),
);
for (const key of options.keys())
	if (
		![
			"deployment",
			"kinds",
			"counts",
			"width",
			"profile",
			"mode",
			"entries",
			"rounds",
			"output",
			"help",
		].includes(key)
	)
		throw new Error(`Unknown option ${key}`);
if (options.has("help")) {
	console.log(
		"bun memory/run.mjs --deployment=<dedicated-dev> [--kinds=native,helpers,full,mini] [--counts=256,512] [--width=32] [--profile=codec-rich] [--mode=handler] [--entries=0] [--rounds=3] [--output=<new-directory>]",
	);
	process.exit(0);
}
const deployment = options.get("deployment");
if (!deployment || !/^[a-z]+-[a-z]+-\d+$/.test(deployment))
	throw new Error("Explicit dedicated --deployment required");
const kinds = (options.get("kinds") || "native,helpers,full,mini").split(",");
const counts = (options.get("counts") || "256,512").split(",").map(Number);
const width = Number(options.get("width") || 32);
const entries = Number(options.get("entries") || 0);
const rounds = Number(options.get("rounds") || 3);
const profile = options.get("profile") || "codec-rich";
const mode = options.get("mode") || "handler";
if (
	new Set(kinds).size !== kinds.length ||
	kinds.some((k) => !["native", "helpers", "full", "mini"].includes(k))
)
	throw new Error("Invalid kinds");
if (
	new Set(counts).size !== counts.length ||
	counts.some((n) => !Number.isInteger(n) || n < 0 || n > 8192)
)
	throw new Error("Counts must be distinct integers 0..8192");
if (
	!Number.isInteger(width) ||
	width < 1 ||
	width > 64 ||
	!Number.isInteger(entries) ||
	entries < 0 ||
	entries > 8192
)
	throw new Error("Invalid width or entries");
if (
	!Number.isInteger(rounds) ||
	rounds < 1 ||
	rounds > 7 ||
	!["fields-only", "codec-rich"].includes(profile) ||
	!["handler", "static"].includes(mode)
)
	throw new Error("Invalid rounds/profile/mode");
const plannedCalls = kinds.length * counts.length * rounds;
if (plannedCalls > 64) throw new Error("Maximum 64 calls; select fewer cases");
const output = resolve(
	options.get("output") ||
		join(root, "results/local", `memory-${randomUUID()}`),
);
if (existsSync(output))
	throw new Error(
		"Output exists; preserve prior evidence with a new directory",
	);
mkdirSync(join(output, "sources"), { recursive: true });
const hash = (text) => createHash("sha256").update(text).digest("hex");
const { gitCommit, gitStatus, versions, runtime, sourceHashes } =
	captureProvenance();
const manifest = {
	startedAt: new Date().toISOString(),
	target: `https://${deployment}.convex.cloud`,
	gitCommit,
	gitStatus,
	versions,
	runtime,
	kinds,
	counts,
	width,
	entries,
	rounds,
	profile,
	mode,
	plannedCalls,
	sourceHashes,
	scope:
		"Factory-defined retained schema graphs; one-off analysis and ordinary query execution paths are classified separately. No measured hosted heap bytes or universal model ceiling.",
};
writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
const observations = [];
let client,
	abort = null;
try {
	client = await connect(deployment);
	const cells = kinds.flatMap((kind) =>
		counts.map((count) => ({ kind, count, width, profile, entries })),
	);
	const deadline = Date.now() + 180000;
	for (let round = 0; round < rounds; round++) {
		// Record alternating order; this neither controls GC nor guarantees fresh isolates.
		for (const cell of round % 2 ? [...cells].reverse() : cells) {
			if (Date.now() > deadline)
				throw new Error("Exceeded three-minute call budget");
			const nonce = randomUUID();
			const bundle = await bundleProbe(cell.kind, cell, { mode, nonce });
			writeFileSync(join(output, "sources", `${nonce}.js`), bundle.source);
			const raw = await client.run(bundle.source);
			const text =
				raw.content
					?.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join("\n") || JSON.stringify(raw);
			let outcome = "ok",
				phase = "query",
				verificationError = null;
			if (raw.isError) {
				outcome = /out of memory/i.test(text)
					? "memory"
					: /timed out|timeout/i.test(text)
						? "time"
						: "other";
				phase = /InvalidModules|Could not analyze/i.test(text)
					? "analysis"
					: /Query failed/.test(text)
						? "query"
						: "unknown";
			} else {
				try {
					assertGraphResult(decodeMcpResult(raw), { ...cell, nonce });
				} catch (error) {
					outcome = "harness";
					verificationError = error.message;
				}
			}
			const row = {
				...cell,
				round,
				nonce,
				mode,
				timestamp: new Date().toISOString(),
				outcome,
				phase,
				verificationError,
				bundleBytes: bundle.bytes,
				bundleHash: hash(bundle.source),
				raw,
			};
			observations.push(row);
			appendFileSync(join(output, "calls.jsonl"), JSON.stringify(row) + "\n");
			console.log(
				`${cell.kind} ${cell.count}+1 models width=${width}: ${outcome} (${phase})`,
			);
		}
	}
} catch (error) {
	abort = error.message;
} finally {
	client?.close();
}
const valid =
	!abort &&
	observations.length === plannedCalls &&
	observations.every(
		(row) =>
			["ok", "memory", "time"].includes(row.outcome) && row.phase !== "unknown",
	);
writeFileSync(
	join(output, "summary.json"),
	JSON.stringify(
		{
			completedAt: new Date().toISOString(),
			valid,
			abort,
			plannedCalls,
			observedCalls: observations.length,
			outcomes: observations.map(({ raw, ...row }) => row),
		},
		null,
		2,
	),
);
console.log(
	`Evidence: ${output}; ${valid ? "VALID observations" : "INVALID run"}`,
);
if (!valid) process.exitCode = 1;
