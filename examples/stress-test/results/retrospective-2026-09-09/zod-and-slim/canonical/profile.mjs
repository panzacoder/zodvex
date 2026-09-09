// Framework imports are supplied by the caller so the four graphs stay separate.
// This is a construction-capacity prototype, not a measured hosted heap size.
export class SecretText {
	constructor(value) {
		this.value = value;
	}
	toWire() {
		return this.value;
	}
}

export const probeWire = {
	seq: 1,
	at: 1700000000000,
	secret: "capacity",
	payload: "tiny",
};

export function createGraphFactory(api) {
	const native = api.kind === "native";
	const modeled = api.kind === "full" || api.kind === "mini";
	const s = native ? api.v : api.s;
	return function buildGraph({ count, width, profile, entries = 0 }) {
		if (
			!Number.isInteger(count) ||
			count < 0 ||
			!Number.isInteger(width) ||
			width < 1 ||
			!Number.isInteger(entries) ||
			entries < 0 ||
			!["fields-only", "codec-rich"].includes(profile)
		) {
			throw new Error("Invalid graph fixture arguments");
		}
		// These count explicit fixture constructor calls, not library-internal objects.
		// No primitive instance is reused between fields or between models.
		const counters = {
			schemaConstructors: 0,
			fields: 0,
			codecSites: 0,
			allocatedCodecs: 0,
		};
		const make = (method, ...args) => {
			counters.schemaConstructors++;
			return s[method](...args);
		};
		const object = (fields) => {
			counters.fields += Object.keys(fields).length;
			return make("object", fields);
		};
		const date = () => {
			counters.codecSites++;
			if (native) return make("number");
			counters.allocatedCodecs++;
			return make("codec", make("number"), make("date"), {
				decode: (value) => new Date(value),
				encode: (value) => value.getTime(),
			});
		};
		const secret = () => {
			counters.codecSites++;
			if (native) return make("string");
			counters.allocatedCodecs++;
			return make("codec", make("string"), make("instanceof", SecretText), {
				decode: (value) => new SecretText(value),
				encode: (value) => value.toWire(),
			});
		};
		const field = (index) => {
			if (profile === "fields-only") {
				switch (index % 4) {
					case 0:
						return make("string");
					case 1:
						return make("number");
					case 2:
						return make("boolean");
					case 3:
						return make("optional", make("string"));
				}
			}
			switch (index % 4) {
				case 0:
					return date();
				case 1:
					return secret();
				case 2:
					return object({ at: date(), tag: make("optional", make("string")) });
				case 3:
					return make(
						"array",
						native
							? make("union", make("string"), make("number"))
							: make("union", [make("string"), make("number")]),
					);
			}
		};
		const models = {};
		const sourceSchemas = {};
		// One fixed, tiny codec model. Background width/count never changes its data.
		const add = (name, fields) => {
			if (modeled) {
				counters.fields += Object.keys(fields).length;
				models[name] = api.defineZodModel(name, fields); // default schema helpers ON
				sourceSchemas[name] = models[name].schema.insert;
			} else {
				sourceSchemas[name] = object(fields);
				models[name] = native
					? api.defineTable(sourceSchemas[name])
					: sourceSchemas[name];
			}
		};
		add("benchmarkRows", {
			seq: make("number"),
			at: date(),
			secret: secret(),
			payload: make("string"),
		});
		for (let i = 0; i < count; i++) {
			const fields = {};
			for (let j = 0; j < width; j++) fields[`f${j}`] = field(j);
			add(`unused${i}`, fields);
		}
		const schema = modeled
			? api.defineZodSchema(models)
			: native
				? api.defineSchema(models)
				: null;
		const names = Object.keys(models);
		const registry = {};
		for (let i = 0; i < entries; i++) {
			const name = names[i % names.length];
			const doc = modeled ? models[name].schema.doc : sourceSchemas[name];
			const args = object({
				id: make("string"),
				label: make("optional", make("string")),
			});
			const returns = native
				? make("union", doc, make("null"))
				: make("nullable", doc);
			registry[`unused/fn${i}`] = { args, returns };
		}
		const builders = modeled
			? api.initZodvex(
					schema,
					api.server,
					entries ? { registry: () => registry } : undefined,
				)
			: api.makeBuilders();

		return {
			kind: api.kind,
			options: { count, width, profile, entries },
			models,
			sourceSchemas,
			schema,
			registry,
			builders,
			manifest: {
				backgroundModels: count,
				totalModels: count + 1,
				backgroundTopLevelFields: count * width,
				fixedProbeFields: 4,
				profile,
				registryEntries: entries,
				...counters,
				counterScope:
					"Explicit fixture constructor calls and source fields/codecs; excludes library-generated helper schemas and runtime heap objects.",
			},
			operation() {
				const input = { ...probeWire };
				const decoded = native
					? {
							...input,
							at: new Date(input.at),
							secret: new SecretText(input.secret),
						}
					: api.s.parse(sourceSchemas.benchmarkRows, input);
				if (
					!(decoded.at instanceof Date) ||
					!(decoded.secret instanceof SecretText)
				)
					throw new Error("Codec decode failed");
				decoded.at = new Date(decoded.at.getTime() + 1000);
				decoded.secret = new SecretText(decoded.secret.toWire().toUpperCase());
				const output = native
					? {
							...decoded,
							at: decoded.at.getTime(),
							secret: decoded.secret.toWire(),
						}
					: api.s.encode(sourceSchemas.benchmarkRows, decoded);
				if (
					JSON.stringify(output) !==
					JSON.stringify({
						...probeWire,
						at: probeWire.at + 1000,
						secret: "CAPACITY",
					})
				) {
					throw new Error("Codec round trip mismatch");
				}
				return output;
			},
			// Call after the operation and after GC measurements. The retained graph
			// includes every model, table schema, registry entry and builder closure.
			checksum() {
				let sum = 0;
				for (const [name, model] of Object.entries(models)) {
					if (!model || !sourceSchemas[name]) throw new Error("Missing model");
					sum += name.length;
					if (
						modeled &&
						schema.__zodTableMap[name].insert !== sourceSchemas[name]
					)
						throw new Error("Lost table-map alias");
				}
				for (const [name, entry] of Object.entries(registry)) {
					if (!entry.args || !entry.returns)
						throw new Error("Missing registry schema");
					sum += name.length;
				}
				if (Object.keys(builders).length === 0)
					throw new Error("Lost builders");
				return sum;
			},
		};
	};
}
