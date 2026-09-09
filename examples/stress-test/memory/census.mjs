// Aggregate only. Never serialize names, literal values, schema definitions or code.
const kinds = new Set(
	"string number bigint boolean date symbol undefined nullable null any unknown never void array object union intersection tuple record map set literal enum promise lazy optional default prefault custom transform nonoptional readonly nan pipe success catch file template_literal".split(
		" ",
	),
);
const childKeys = [
	"innerType",
	"element",
	"keyType",
	"valueType",
	"left",
	"right",
	"in",
	"out",
	"rest",
	"contentType",
	"catchall",
];
const dataValues = (object) =>
	Object.values(Object.getOwnPropertyDescriptors(object))
		.filter((d) => "value" in d)
		.map((d) => d.value);
const isSchema = (value) =>
	value !== null &&
	typeof value === "object" &&
	typeof value._zod?.def?.type === "string";

export function schemaCensus(schema) {
	const map = schema?.__zodTableMap;
	if (!map || typeof map !== "object" || Array.isArray(map))
		throw new Error("Expected defineZodSchema default export");
	const entries = dataValues(map);
	const roots = entries.flatMap((entry) => [entry?.doc, entry?.insert]);
	if (roots.some((root) => !isSchema(root)))
		throw new Error("Incomplete Zod table map");
	return { models: entries.length, ...countSchemas(roots) };
}

export function countSchemas(roots) {
	const seen = new Set(),
		checks = new Set(),
		callbacks = new Set();
	const byKind = {},
		implementations = { classic: 0, mini: 0, core: 0 };
	let references = 0,
		fieldSlots = 0,
		codecs = 0,
		lazy = 0,
		accessors = 0,
		shapeGetters = 0,
		unknown = 0;
	const stack = [...roots];
	while (stack.length) {
		const schema = stack.pop();
		if (!isSchema(schema)) continue;
		references++;
		if (seen.has(schema)) continue;
		seen.add(schema);
		if (seen.size > 1000000)
			throw new Error("Diagnostic graph size budget exceeded");
		const { def, traits } = schema._zod;
		const kind = kinds.has(def.type) ? def.type : "unrecognized";
		byKind[kind] = (byKind[kind] ?? 0) + 1;
		if (kind === "unrecognized") unknown++;
		implementations[
			traits?.has("ZodMiniType")
				? "mini"
				: traits?.has("ZodType")
					? "classic"
					: "core"
		]++;
		if (traits?.has("$ZodCodec")) codecs++;
		// Do not evaluate explicit lazy schemas, defaults, or codec callbacks.
		if (kind === "lazy") lazy++;
		if (kind === "object") {
			// Zod 4.5 copies a deferred shape with object spread, which can evaluate
			// user field getters. Count that operation; it happens after heap sampling.
			if (Object.getOwnPropertyDescriptor(def, "shape")?.get) shapeGetters++;
			const fields = Object.getOwnPropertyDescriptors(def.shape);
			fieldSlots += Object.keys(fields).length;
			for (const descriptor of Object.values(fields)) {
				if ("value" in descriptor) stack.push(descriptor.value);
				else accessors++;
			}
		}
		const descriptors = Object.getOwnPropertyDescriptors(def);
		for (const key of childKeys)
			if (descriptors[key] && "value" in descriptors[key])
				stack.push(descriptors[key].value);
		for (const key of ["options", "items", "parts"]) {
			const values = descriptors[key]?.value;
			if (Array.isArray(values)) stack.push(...values.filter(isSchema));
		}
		for (const value of dataValues(def))
			if (typeof value === "function") callbacks.add(value);
		for (const check of def.checks ?? []) {
			checks.add(check);
			if (check?._zod?.def?.schema) stack.push(check._zod.def.schema);
			if (isSchema(check)) stack.push(check);
			if (check?._zod?.def)
				for (const value of dataValues(check._zod.def))
					if (typeof value === "function") callbacks.add(value);
		}
	}
	return {
		schemaRoots: roots.length,
		uniqueSchemas: seen.size,
		repeatedSchemaReferences: references - seen.size,
		objectFieldSlots: fieldSlots,
		codecs,
		uniqueChecks: checks.size,
		explicitCallbackReferences: callbacks.size,
		unresolvedLazySchemas: lazy,
		fieldAccessorsSkipped: accessors,
		shapeGettersEvaluated: shapeGetters,
		unrecognizedSchemaKinds: unknown,
		definitionTraversalComplete: lazy === 0 && accessors === 0 && unknown === 0,
		implementations,
		schemasByKind: Object.fromEntries(
			Object.entries(byKind).sort(([a], [b]) => a.localeCompare(b)),
		),
	};
}
