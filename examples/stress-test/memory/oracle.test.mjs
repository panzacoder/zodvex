import { strict as assert } from "node:assert";
import { test } from "vitest";
import {
	assertGraphResult,
	decodeMcpResult,
	expectedGraphResult,
} from "./oracle.mjs";

const dimensions = {
	kind: "full",
	count: 512,
	width: 32,
	profile: "codec-rich",
	entries: 0,
	nonce: "test",
};

test("known 512-model rich fixture has independently calculated dimensions and checksum", () => {
	const result = expectedGraphResult(dimensions);
	assert.equal(result.checksum, 4511);
	assert.deepEqual(result.output, {
		seq: 1,
		at: 1700000001000,
		secret: "CAPACITY",
		payload: "tiny",
	});
	assert.equal(result.manifest.totalModels, 513);
	assert.equal(result.manifest.backgroundTopLevelFields, 16384);
	assert.equal(result.manifest.fields, 24580);
	assert.equal(result.manifest.codecSites, 12290);
	assert.equal(result.manifest.schemaConstructors, 65544);
});

test("partial scalar cycles and registry entries count independently", () => {
	const input = {
		...dimensions,
		count: 2,
		width: 5,
		profile: "fields-only",
		entries: 3,
	};
	const result = expectedGraphResult(input);
	assert.equal(result.checksum, 57); // benchmarkRows:13; unused0/1:14; three registry keys:30
	assert.equal(result.manifest.schemaConstructors, 35);
	assert.equal(result.manifest.fields, 20);
	assert.equal(result.manifest.codecSites, 2);
	assert.equal(
		expectedGraphResult({ ...input, kind: "helpers" }).manifest
			.schemaConstructors,
		38,
	);
	assert.equal(
		expectedGraphResult({ ...input, kind: "native" }).manifest
			.schemaConstructors,
		37,
	);
});

test("partial rich cycles count nested fields and semantic native codec sites", () => {
	const input = { ...dimensions, count: 2, width: 5 };
	const result = expectedGraphResult(input);
	assert.equal(result.manifest.schemaConstructors, 46);
	assert.equal(result.manifest.fields, 18);
	assert.equal(result.manifest.codecSites, 10);
	const native = expectedGraphResult({ ...input, kind: "native" });
	assert.equal(native.manifest.schemaConstructors, 29);
	assert.equal(native.manifest.codecSites, 10);
	assert.equal(native.manifest.allocatedCodecs, 0);
});

test("checks the whole result, including independent dimensions and exact wire values", () => {
	const expected = expectedGraphResult(dimensions);
	assert.doesNotThrow(() =>
		assertGraphResult(structuredClone(expected), dimensions),
	);
	for (const corrupt of [
		(value) => {
			value.checksum++;
		},
		(value) => {
			value.nonce = "different";
		},
		(value) => {
			value.manifest.backgroundModels--;
		},
		(value) => {
			value.manifest.fields--;
		},
		(value) => {
			value.manifest.schemaConstructors--;
		},
		(value) => {
			value.output.at--;
		},
		(value) => {
			value.output.secret = "capacity";
		},
		(value) => {
			value.output.extra = true;
		},
		(value) => {
			value.extra = true;
		},
	]) {
		const value = structuredClone(expected);
		corrupt(value);
		assert.throws(() => assertGraphResult(value, dimensions));
	}
});

test("decodes MCP success and rejects missing, malformed, or error results", () => {
	const value = expectedGraphResult(dimensions);
	const content = [{ type: "text", text: JSON.stringify({ result: value }) }];
	assert.deepEqual(decodeMcpResult({ content }), value);
	for (const raw of [
		null,
		{},
		{ isError: true, content },
		{ content: [] },
		{ content: [{ type: "text", text: "not JSON" }] },
		{ content: [{ type: "text", text: "{}" }] },
		{
			content: [
				{ type: "text", text: JSON.stringify({ error: "OOM", result: value }) },
			],
		},
	])
		assert.throws(() => decodeMcpResult(raw));
});

test("rejects invalid dimensions instead of silently coercing them", () => {
	for (const change of [
		{ kind: "unknown" },
		{ profile: "unknown" },
		{ count: -1 },
		{ count: 1.5 },
		{ count: "512" },
		{ count: Number.MAX_SAFE_INTEGER },
		{ width: 0 },
		{ entries: -1 },
		{ nonce: null },
	]) {
		assert.throws(() => expectedGraphResult({ ...dimensions, ...change }));
	}
});
