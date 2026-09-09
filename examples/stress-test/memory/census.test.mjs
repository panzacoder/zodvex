import { expect, test } from "vitest";
import * as z from "zod";
import * as mini from "zod/mini";
import { countSchemas, schemaCensus } from "./census.mjs";

test("counts unique instances and aliases separately", () => {
	const shared = z.string();
	const root = z.object({ left: shared, right: shared });
	expect(countSchemas([root, root])).toMatchObject({
		uniqueSchemas: 2,
		schemaRoots: 2,
		repeatedSchemaReferences: 2,
		objectFieldSlots: 2,
	});
	expect(
		countSchemas([z.object({ left: z.string(), right: z.string() })])
			.uniqueSchemas,
	).toBe(3);
});

test("census never includes names, literals, callback text, or custom type names", () => {
	const first = z.object({
		private_customer_name: z.literal("private_secret"),
		private_email: z.string(),
	});
	const renamed = z.object({ a: z.literal("another_value"), b: z.string() });
	expect(countSchemas([first])).toEqual(countSchemas([renamed]));
	const unknown = { _zod: { def: { type: "private_custom_type" } } };
	const result = countSchemas([first, unknown]);
	expect(JSON.stringify(result)).not.toMatch(/private_|another_value/);
	expect(result).toMatchObject({
		unrecognizedSchemaKinds: 1,
		definitionTraversalComplete: false,
	});
});

test("does not execute lazy or codec callbacks; records shape evaluation and handles cycles", () => {
	let calls = 0;
	const codec = z.codec(z.string(), z.date(), {
		decode: () => {
			calls++;
			return new Date();
		},
		encode: () => {
			calls++;
			return "";
		},
	});
	const root = z.object({
		codec,
		lazy: z.lazy(() => {
			calls++;
			return z.string();
		}),
		get recursive() {
			calls++;
			return root;
		},
	});
	expect(countSchemas([root])).toMatchObject({
		codecs: 1,
		unresolvedLazySchemas: 1,
		shapeGettersEvaluated: 1,
		definitionTraversalComplete: false,
	});
	expect(calls).toBe(1); // Zod evaluates the object field getter when exposing shape.
});

test("reports comparable classic and mini definitions without conflating their implementations", () => {
	const classic = countSchemas([z.object({ a: z.optional(z.string()) })]);
	const smaller = countSchemas([
		mini.object({ a: mini.optional(mini.string()) }),
	]);
	expect(classic.schemasByKind).toEqual(smaller.schemasByKind);
	expect(classic.implementations).toEqual({ classic: 3, mini: 0, core: 0 });
	expect(smaller.implementations).toEqual({ classic: 0, mini: 3, core: 0 });
});

test("checks default schema shape and counts only doc/insert roots", () => {
	const model = z.object({ value: z.string() });
	expect(
		schemaCensus({
			__zodTableMap: { private_table: { doc: model, insert: model } },
		}),
	).toMatchObject({ models: 1, schemaRoots: 2, uniqueSchemas: 2 });
	expect(() => schemaCensus({})).toThrow();
	expect(() =>
		schemaCensus({ __zodTableMap: { broken: { doc: model } } }),
	).toThrow();
});

test("traverses catchalls and property-check schemas", () => {
	expect(countSchemas([z.object({}).catchall(z.string())]).uniqueSchemas).toBe(
		2,
	);
	const root = z
		.object({ a: z.string() })
		.check(z.property("a", z.string().min(2)));
	expect(countSchemas([root])).toMatchObject({
		uniqueSchemas: 3,
		uniqueChecks: 2,
	});
});
