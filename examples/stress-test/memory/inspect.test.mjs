import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = (source) => {
	const tmp = join(root, "tmp");
	mkdirSync(tmp, { recursive: true });
	const directory = mkdtempSync(join(tmp, "private-diagnostic-"));
	try {
		const schema = join(directory, "private-schema.ts");
		writeFileSync(schema, source);
		return spawnSync("node", [join(root, "memory/inspect.mjs"), schema], {
			encoding: "utf8",
			timeout: 15000,
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
};

test("local command emits only aggregates despite schema names, values and application logs", () => {
	const result = run(`
    import { defineZodModel } from 'zodvex'
    import { defineZodSchema } from 'zodvex/server'
    import { z } from 'zod'
    console.log('private-application-log')
    console.error('private-stderr-log')
    const private_table = defineZodModel('private_table', { private_field: z.literal('private-value') })
    export default defineZodSchema({ private_table })
  `);
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout + result.stderr).not.toMatch(/private[-_]/);
	const report = JSON.parse(result.stdout);
	expect(report).toMatchObject({
		format: "zodvex-local-schema-report-v1",
		census: { models: 1 },
		localImport: { repetitions: 3 },
	});
	expect(report.versions.zodvex).toMatch(/^\d+\.\d+\.\d+/);
	expect(Number.isFinite(report.localImport.heapUsed.medianDeltaBytes)).toBe(
		true,
	);
});

test("failed imports reveal neither error text nor schema path and emit no report", () => {
	const result = run(
		`console.log('private-secret'); throw new Error('private-error-message'); export default {}`,
	);
	expect(result.status).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).not.toMatch(/private[-_]/);
	expect(result.stderr).toContain("no report was produced");
});
