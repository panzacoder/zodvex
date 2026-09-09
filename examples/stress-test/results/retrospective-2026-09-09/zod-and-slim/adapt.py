from pathlib import Path
root=Path(__file__).parent
p=root/'memory/profile.mjs'
s=p.read_text().replace('models[name] = api.defineZodModel(name, fields); // default schema helpers ON\n\t\t\t\tsourceSchemas[name] = models[name].schema.insert;', 'models[name] = api.defineZodModel(name, fields, api.schemaHelpers ? undefined : { schemaHelpers: false });')
s=s.replace('const names = Object.keys(models);','// Slim models omit .schema; retain the same table-map insert alias for both modes.\n\t\tif (modeled) for (const name of Object.keys(models)) sourceSchemas[name] = schema.__zodTableMap[name].insert;\n\t\tconst names = Object.keys(models);')
s=s.replace('const doc = modeled ? models[name].schema.doc : sourceSchemas[name];','const doc = modeled ? schema.__zodTableMap[name].doc : sourceSchemas[name];')
p.write_text(s)
p=root/'memory/bundle.mjs'
s=p.read_text().replace('import { createRequire }', 'import { readFileSync, realpathSync } from "node:fs";\nimport { resolve } from "node:path";\nimport { createHash } from "node:crypto";\nimport { createRequire }',1)
s=s.replace('const esbuild =', 'const version = process.env.ZOD_RETRO_VERSION;\nif (!["4.3.6", "4.4.3", "4.5.4"].includes(version)) throw new Error("Explicit retrospective Zod version required");\nconst zodRoot = realpathSync(root + "/versions/" + version + "/node_modules/zod");\nconst schemaHelpers = process.env.ZOD_RETRO_HELPERS;\nif (!["on", "off"].includes(schemaHelpers)) throw new Error("Explicit schema helper mode required");\nconst esbuild =',1)
s=s.replace('const api={kind:${JSON.stringify(kind)},server,','const api={kind:${JSON.stringify(kind)},schemaHelpers:${schemaHelpers === "on"},server,')
s=s.replace('\t\tbundle: true,','\t\talias: { zod: zodRoot },\n\t\tbundle: true,')
s=s.replace('return { source, bytes: Buffer.byteLength(source), inputs };','''const inputEvidence = inputs.map((path) => {
        if (path === "graphProbe.ts") return { path: "<stdin:graphProbe.ts>", sha256: createHash("sha256").update(imports + setup + body).digest("hex") };
        const absolute = realpathSync(resolve(path));
        if (absolute.includes("/node_modules/zod/") && !absolute.startsWith(zodRoot + "/"))
            throw new Error("Mixed Zod versions: " + absolute);
        return { path: absolute, sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex") };
    });
    if (!native && !inputEvidence.some((input) => input.path.startsWith(zodRoot + "/")))
        throw new Error("Expected chosen Zod package in bundle");
    return { source, bytes: Buffer.byteLength(source), inputs: inputEvidence };''')
p.write_text(s)
p=root/'memory/local.mjs'
s=p.read_text().replace('format: "zodvex-local-memory-v1"','format: "zodvex-retrospective-memory-v1"')
s=s.replace('const { source, bytes } = await bundleProbe','const { source, bytes, inputs } = await bundleProbe')
s=s.replace('writeFileSync(out + "sources/" + id + ".js", source);','writeFileSync(out + "sources/" + id + ".js", source);\n\t\twriteFileSync(out + "sources/" + id + ".inputs.json", JSON.stringify(inputs, null, 2));')
s=s.replace('bundleHash: sha256(source),','bundleHash: sha256(source),\n\t\t\tinputsHash: sha256(JSON.stringify(inputs, null, 2)),')
p.write_text(s)
p=root/'memory/provenance.mjs'
s=p.read_text().replace('readFileSync(join(root, "node_modules", name, "package.json"), "utf8")','readFileSync(name === "zod" ? join(root, "versions", process.env.ZOD_RETRO_VERSION, "node_modules/zod/package.json") : join(root, "node_modules", name, "package.json"), "utf8")')
a=s.index('\tconst git = (args) => {')
b=s.index('\treturn {',a)
# Find the return AFTER git function body, not its inner code (none).
s=s[:a]+s[b:]
s=s.replace('gitCommit: git(["rev-parse", "HEAD"]),\n\t\tgitStatus: git(["status", "--short"]),','sourceOrigin: JSON.parse(readFileSync(join(root, "source-origin.json"), "utf8")),\n\t\tretrospective: { zodVersion: process.env.ZOD_RETRO_VERSION, schemaHelpers: process.env.ZOD_RETRO_HELPERS === "on", round: Number(process.env.ZOD_RETRO_ROUND) },')
p.write_text(s)
