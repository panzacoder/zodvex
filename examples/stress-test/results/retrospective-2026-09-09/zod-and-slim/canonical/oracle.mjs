import { deepStrictEqual } from "node:assert/strict";

const COUNTER_SCOPE =
	"Explicit fixture constructor calls and source fields/codecs; excludes library-generated helper schemas and runtime heap objects.";

function numberedKeyLengths(prefix, count) {
	// Sum decimal digit widths by ranges, without constructing the model graph
	// or looping once per model. Index zero contributes one digit.
	let sum = prefix.length * count + (count > 0 ? 1 : 0);
	for (let start = 1, digits = 1; start < count; start *= 10, digits++) {
		sum += (Math.min(count, start * 10) - start) * digits;
	}
	return sum;
}

/** Independent expected result; deliberately imports nothing from the fixture. */
export function expectedGraphResult({
	kind,
	count,
	width,
	profile,
	entries = 0,
	nonce,
}) {
	if (
		!["native", "helpers", "full", "mini"].includes(kind) ||
		!["fields-only", "codec-rich"].includes(profile) ||
		!Number.isSafeInteger(count) ||
		count < 0 ||
		count > 8192 ||
		!Number.isSafeInteger(width) ||
		width < 1 ||
		width > 64 ||
		!Number.isSafeInteger(entries) ||
		entries < 0 ||
		entries > 8192 ||
		typeof nonce !== "string"
	) {
		throw new Error("Invalid oracle dimensions");
	}
	const native = kind === "native";
	const modeled = kind === "full" || kind === "mini";
	const rich = profile === "codec-rich";
	// Occurrences of each position in the four-field cycle, including remainders.
	const positions = [3, 2, 1, 0].map((offset) =>
		Math.floor((width + offset) / 4),
	);
	const perFieldConstructors = rich
		? native
			? [1, 1, 4, 4]
			: [3, 3, 6, 4]
		: [1, 1, 1, 2];
	const backgroundConstructors = positions.reduce(
		(sum, n, index) => sum + n * perFieldConstructors[index],
		0,
	);
	const codecSites =
		2 + count * (rich ? positions[0] + positions[1] + positions[2] : 0);
	const checksum =
		"benchmarkRows".length +
		numberedKeyLengths("unused", count) +
		numberedKeyLengths("unused/fn", entries);
	const schemaConstructors =
		(native ? 5 : modeled ? 8 : 9) +
		count * (backgroundConstructors + (modeled ? 0 : 1)) +
		entries * (native ? 6 : 5);
	const fields =
		4 + count * (width + (rich ? positions[2] * 2 : 0)) + entries * 2;
	const manifest = {
		backgroundModels: count,
		totalModels: count + 1,
		backgroundTopLevelFields: count * width,
		fixedProbeFields: 4,
		profile,
		registryEntries: entries,
		schemaConstructors,
		fields,
		codecSites,
		allocatedCodecs: native ? 0 : codecSites,
		counterScope: COUNTER_SCOPE,
	};
	if (
		[
			checksum,
			...Object.values(manifest).filter((value) => typeof value === "number"),
		].some((value) => !Number.isSafeInteger(value))
	)
		throw new Error("Oracle dimensions exceed safe integer arithmetic");
	return {
		checksum,
		manifest,
		nonce,
		output: { seq: 1, at: 1700000001000, secret: "CAPACITY", payload: "tiny" },
	};
}

/** Reject mismatched dimensions, counters, output, nonce, or unexpected fields. */
export function assertGraphResult(result, dimensions) {
	deepStrictEqual(result, expectedGraphResult(dimensions));
	return result;
}

/** Decode only successful MCP results. Error responses must remain failures. */
export function decodeMcpResult(raw) {
	if (
		!raw ||
		typeof raw !== "object" ||
		raw.isError === true ||
		!Array.isArray(raw.content)
	) {
		throw new Error("MCP query did not return a successful content response");
	}
	const text = raw.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	let payload;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new Error("MCP query returned malformed JSON");
	}
	if (
		!payload ||
		typeof payload !== "object" ||
		Object.hasOwn(payload, "error") ||
		!Object.hasOwn(payload, "result") ||
		!payload.result ||
		typeof payload.result !== "object"
	) {
		throw new Error("MCP query did not contain a successful result");
	}
	return payload.result;
}
