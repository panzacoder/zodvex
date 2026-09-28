import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const oldRoot = path.resolve(process.argv[2] ?? "");
const runId = `${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID().slice(0, 8)}`;
const out = path.resolve(
	process.argv[3] ??
		path.join(here, "../results/local", `compile-audit-${runId}`),
);
const baselineRoot = process.argv[4]
	? path.resolve(process.argv[4])
	: undefined;
if (!process.argv[2])
	throw new Error(
		"Usage: bun run.ts <installed, built PR63 worktree> [output-directory]",
	);
mkdirSync(path.dirname(out), { recursive: true });
mkdirSync(out); // Never overwrite a previous evidence directory, even when explicitly supplied.
const fixture = mkdtempSync(
	path.join(oldRoot, "examples/stress-test/.compile-audit-"),
);
const scratchDirectories = [fixture];
try {
	const convex = path.join(fixture, "convex");
	mkdirSync(path.join(convex, "_generated"), { recursive: true });
	for (const name of ["endpoints", "values", "functions", "server", "probe"]) {
		const destination =
			name === "probe"
				? path.join(fixture, "probe.ts")
				: name === "server"
					? path.join(convex, "_generated/server.ts")
					: path.join(convex, `${name}.ts`);
		cpSync(path.join(here, `fixtures/${name}.ts.template`), destination);
	}
	function child(args: string[], logName: string) {
		const result = spawnSync(args[0], args.slice(1), {
			cwd: oldRoot,
			timeout: 60_000,
			maxBuffer: 8 * 1024 * 1024,
		});
		writeFileSync(
			path.join(out, logName),
			Buffer.concat([
				result.stdout ?? Buffer.alloc(0),
				result.stderr ?? Buffer.alloc(0),
				Buffer.from(result.error ? String(result.error) : ""),
			]),
		);
		if (result.error || result.status !== 0)
			throw new Error(
				`${logName}: process exited ${result.status}, ${result.error ?? result.signal ?? "no signal"}; see saved log`,
			);
	}
	const compiler = path.join(
		oldRoot,
		"packages/zodvex/src/public/cli/compile.ts",
	);
	const compilerRunner = path.join(fixture, "compile.ts");
	writeFileSync(
		compilerRunner,
		`import { runCompile } from ${JSON.stringify(compiler)};\nconst result = await runCompile(${JSON.stringify(convex)}, { verbose: true });\nawait Bun.write(${JSON.stringify(path.join(out, "compiler-result.json"))}, JSON.stringify(result, null, 2) + '\\n');\n`,
	);
	cpSync(convex, path.join(out, "before-source"), { recursive: true });
	child(
		[
			process.execPath,
			path.join(fixture, "probe.ts"),
			path.join(out, "before.json"),
		],
		"before.log",
	);
	try {
		child([process.execPath, compilerRunner], "compiler.log");
	} finally {
		cpSync(convex, path.join(out, "after-source"), { recursive: true });
	}
	child(
		[
			process.execPath,
			path.join(fixture, "probe.ts"),
			path.join(out, "after.json"),
		],
		"after.log",
	);
	const before = JSON.parse(
		readFileSync(path.join(out, "before.json"), "utf8"),
	);
	const after = JSON.parse(readFileSync(path.join(out, "after.json"), "utf8"));
	const checks = [
		{
			name: "plain control remains unchanged",
			passed: before[0].value === "control" && after[0].value === "control",
		},
		{
			name: "Date argument decoding is lost",
			passed: before[1].value === true && after[1].value === false,
		},
		{
			name: "class argument decoding is lost",
			passed: before[2].value === true && after[2].value === false,
		},
		{
			name: "Date return encoding is lost",
			passed:
				before[3].type === "Number" &&
				after[3].type === "Date" &&
				!!after[3].wireError,
		},
		{
			name: "class return encoding is lost",
			passed:
				before[4].value === "ticket-1" &&
				after[4].type === "Ticket" &&
				!!after[4].wireError,
		},
		{
			name: "argument refinement is lost",
			passed: before[5].status === "threw" && after[5].value === "invalid",
		},
		{
			name: "argument default is lost",
			passed: before[6].value === "filled" && after[6].type === "undefined",
		},
	];
	if (baselineRoot) {
		const baselineFixture = mkdtempSync(
			path.join(baselineRoot, "examples/stress-test/.compile-audit-current-"),
		);
		scratchDirectories.push(baselineFixture);
		cpSync(
			path.join(out, "before-source"),
			path.join(baselineFixture, "convex"),
			{ recursive: true },
		);
		cpSync(
			path.join(here, "fixtures/probe.ts.template"),
			path.join(baselineFixture, "probe.ts"),
		);
		child(
			[
				process.execPath,
				path.join(baselineFixture, "probe.ts"),
				path.join(out, "current-foundation.json"),
			],
			"current-foundation.log",
		);
		const current = JSON.parse(
			readFileSync(path.join(out, "current-foundation.json"), "utf8"),
		);
		for (let i = 0; i < before.length; i++) {
			checks.push({
				name: `current foundation agrees with precompile ${before[i].name}`,
				passed:
					current[i].status === before[i].status &&
					current[i].type === before[i].type &&
					JSON.stringify(current[i].value) === JSON.stringify(before[i].value),
			});
		}
	}
	const sha256 = (file: string) =>
		createHash("sha256").update(readFileSync(file)).digest("hex");
	const distHashes = (root: string) =>
		Object.fromEntries(
			readdirSync(path.join(root, "packages/zodvex/dist"), { recursive: true })
				.filter(
					(file): file is string =>
						typeof file === "string" && file.endsWith(".js"),
				)
				.sort()
				.map((file) => [
					file,
					sha256(path.join(root, "packages/zodvex/dist", file)),
				]),
		);
	const collectorHashes = Object.fromEntries(
		[
			"run.ts",
			...readdirSync(path.join(here, "fixtures")).map(
				(file) => `fixtures/${file}`,
			),
		].map((file) => [file, sha256(path.join(here, file))]),
	);
	const git = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: oldRoot })
		.stdout.toString()
		.trim();
	const versions = Object.fromEntries(
		["zod", "convex", "convex-helpers"].map((name) => [
			name,
			JSON.parse(
				readFileSync(
					path.join(
						oldRoot,
						`examples/stress-test/node_modules/${name}/package.json`,
					),
					"utf8",
				),
			).version,
		]),
	);
	const sourceHashes = Object.fromEntries(
		[
			"packages/zodvex/src/public/cli/compile.ts",
			"packages/zodvex/src/public/cli/compileSerialize.ts",
			"bun.lock",
		].map((file) => [file, sha256(path.join(oldRoot, file))]),
	);
	const baseline = baselineRoot
		? {
				git: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: baselineRoot })
					.stdout.toString()
					.trim(),
				versions: Object.fromEntries(
					["zod", "convex", "convex-helpers"].map((name) => [
						name,
						JSON.parse(
							readFileSync(
								path.join(
									baselineRoot,
									`examples/stress-test/node_modules/${name}/package.json`,
								),
								"utf8",
							),
						).version,
					]),
				),
				lockSha256: sha256(path.join(baselineRoot, "bun.lock")),
				distHashes: distHashes(baselineRoot),
			}
		: undefined;
	writeFileSync(
		path.join(out, "summary.json"),
		`${JSON.stringify(
			{
				status: "INCOMPLETE EXPERIMENT — NOT A PERFORMANCE RANKING",
				auditPassed: checks.every((check) => check.passed),
				git,
				bun: Bun.version,
				versions,
				sourceHashes,
				collectorHashes,
				distHashes: distHashes(oldRoot),
				baseline,
				checks,
				passed: checks.filter((check) => check.passed).length,
				total: checks.length,
			},
			null,
			2,
		)}\n`,
	);
	if (checks.some((check) => !check.passed))
		throw new Error(
			"An expected audit observation failed; inspect summary and raw results",
		);
	console.log(
		`Audit observations verified: ${checks.length}/${checks.length}. Evidence: ${out}`,
	);
} finally {
	for (const directory of scratchDirectories)
		rmSync(directory, { recursive: true, force: true });
}
