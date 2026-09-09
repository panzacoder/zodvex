import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(root + "/package.json");
const version = process.env.ZOD_RETRO_VERSION;
if (!["4.3.6", "4.4.3", "4.5.4"].includes(version)) throw new Error("Explicit retrospective Zod version required");
const zodRoot = realpathSync(root + "/versions/" + version + "/node_modules/zod");
const schemaHelpers = process.env.ZOD_RETRO_HELPERS;
if (!["on", "off"].includes(schemaHelpers)) throw new Error("Explicit schema helper mode required");
const esbuild = createRequire(require.resolve("convex/package.json"))(
	"esbuild",
);
export async function bundleProbe(
	kind,
	dimensions,
	{ mode = "static", gc = false, nonce = "probe", deployed = false } = {},
) {
	const native = kind === "native",
		mini = kind === "mini",
		modeled = kind === "full" || mini;
	const imports = `import {query as testerQuery} from '${deployed ? "../_generated/server.js" : "convex:/_system/repl/wrappers.js"}';
 import {v} from 'convex/values';
 import {queryGeneric,mutationGeneric,actionGeneric,internalQueryGeneric,internalMutationGeneric,internalActionGeneric,defineTable,defineSchema} from 'convex/server';
 import {createGraphFactory} from ${JSON.stringify(fileURLToPath(new URL("./profile.mjs", import.meta.url)))};
 ${native ? "" : `import * as z from '${mini ? "zod/mini" : "zod"}';`}
 ${modeled ? `import {defineZodModel} from '${mini ? "zodvex/mini" : "zodvex"}'; import {defineZodSchema,initZodvex} from '${mini ? "zodvex/mini/server" : "zodvex/server"}';` : ""}
 ${kind === "helpers" ? `import {zCustomQuery} from 'convex-helpers/server/zod4'; import {NoOp} from 'convex-helpers/server/customFunctions';` : ""}`;
	const setup = `const server={query:queryGeneric,mutation:mutationGeneric,action:actionGeneric,internalQuery:internalQueryGeneric,internalMutation:internalMutationGeneric,internalAction:internalActionGeneric};
 const api={kind:${JSON.stringify(kind)},schemaHelpers:${schemaHelpers === "on"},server,${native ? "v,defineTable,defineSchema,makeBuilders:()=>server" : `s:{${["number", "string", "boolean", "optional", "nullable", "object", "array", "union", "date", "codec", "instanceof", "parse", "encode"].map((k) => `${JSON.stringify(k)}:z.${k}`).join(",")}},${modeled ? "defineZodModel,defineZodSchema,initZodvex" : `makeBuilders:()=>({query:zCustomQuery(server.query,NoOp)})`}`}};
 const build=createGraphFactory(api);
 const dimensions=${JSON.stringify(dimensions)};
 ${mode === "static" ? "const graph=build(dimensions);" : ""}`;
	const body = `export default testerQuery({args:${deployed ? "{nonce:v.string()}" : "{}"},returns:v.object({checksum:v.number(),output:v.object({seq:v.number(),at:v.number(),secret:v.string(),payload:v.string()}),manifest:v.any(),nonce:v.string()}),handler:${deployed ? "(_ctx,a)" : "()"}=>{
 ${gc === true ? `if(typeof globalThis.gc!=='function') throw new Error('GC diagnostic unavailable'); globalThis.gc(); globalThis.gc();` : ""}
 ${mode === "static" ? "" : "const graph=build(dimensions);"}
 ${gc === true ? `globalThis.gc(); globalThis.gc();` : ""}
 const output=graph.operation();
 ${gc ? `globalThis.gc(); globalThis.gc();` : ""}
 return {checksum:graph.checksum(),output,manifest:graph.manifest,nonce:${deployed ? "a.nonce" : JSON.stringify(nonce)}};
 }});`;
	const built = await esbuild.build({
		stdin: {
			contents: imports + setup + body,
			resolveDir: root,
			sourcefile: "graphProbe.ts",
			loader: "ts",
		},
		alias: { zod: zodRoot },
		bundle: true,
		platform: "browser",
		format: "esm",
		target: "esnext",
		external: [
			deployed ? "../_generated/server.js" : "convex:/_system/repl/wrappers.js",
		],
		conditions: ["convex", "module"],
		treeShaking: true,
		minifySyntax: true,
		minifyIdentifiers: true,
		keepNames: true,
		define: { "process.env.NODE_ENV": '"production"' },
		write: false,
		metafile: true,
		logLevel: "silent",
	});
	const source = built.outputFiles[0].text;
	const inputs = Object.entries(built.metafile.inputs)
		.filter(([k]) => !k.startsWith("<"))
		.map(([k]) => k);
	if (native && inputs.some((k) => /\/zod\/|\/zodvex\//.test(k)))
		throw new Error("Native graph contaminated");
	if (mini && inputs.some((k) => k.includes("/classic/")))
		throw new Error("Mini imports classic");
	if (kind === "helpers" && inputs.some((k) => k.includes("/zodvex/")))
		throw new Error("Helpers imports Zodvex");
	const inputEvidence = inputs.map((path) => {
        if (path === "graphProbe.ts") return { path: "<stdin:graphProbe.ts>", sha256: createHash("sha256").update(imports + setup + body).digest("hex") };
        const absolute = realpathSync(resolve(path));
        if (absolute.includes("/node_modules/zod/") && !absolute.startsWith(zodRoot + "/"))
            throw new Error("Mixed Zod versions: " + absolute);
        return { path: absolute, sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex") };
    });
    if (!native && !inputEvidence.some((input) => input.path.startsWith(zodRoot + "/")))
        throw new Error("Expected chosen Zod package in bundle");
    return { source, bytes: Buffer.byteLength(source), inputs: inputEvidence };
}
