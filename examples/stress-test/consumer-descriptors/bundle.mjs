import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(root, "package.json"));
const esbuild = createRequire(require.resolve("convex/package.json"))("esbuild");

export async function bundleConsumer(directory, kind, count, nonce) {
  const source = `
import {query} from 'convex:/_system/repl/wrappers.js';
import {v} from 'convex/values';
import {tableMap} from ${JSON.stringify(join(directory, kind + '.ts'))};
import {initialized} from ${JSON.stringify(join(directory, 'counters.mjs'))};
import {exercise} from ${JSON.stringify(join(directory, 'db-fixture.mjs'))};
export default query({args:{},returns:v.any(),handler:async()=>{
 const operation = await exercise(tableMap);
 if(typeof globalThis.gc!=='function') throw new Error('GC diagnostic unavailable');
 globalThis.gc(); globalThis.gc();
 // Keep the actual central map live through measurement; verify its membership.
 const names=Object.keys(tableMap).sort();
 return {nonce:${JSON.stringify(nonce)},kind:${JSON.stringify(kind)},count:${count},operation,
  models:initialized.models,descriptors:initialized.descriptors,tables:names,
  checksum:names.reduce((total,name)=>total+name.length,0)};
}});`;
  const result = await esbuild.build({
    stdin: { contents: source, resolveDir: root, sourcefile: "consumerProbe.ts", loader: "ts" },
    bundle: true, platform: "browser", format: "esm", target: "esnext",
    external: ["convex:/_system/repl/wrappers.js"], conditions: ["convex", "module"],
    treeShaking: true, minifySyntax: true, minifyIdentifiers: true, keepNames: true,
    define: { "process.env.NODE_ENV": '"production"' }, write: false, metafile: true, logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile.inputs).filter(path => !path.startsWith('<'));
  const modelInputs = inputs.filter(path => /\/models\/[^/]+\.ts$/.test(path));
  const descriptorInputs = inputs.filter(path => /\/_zodvex\/models\/[^/]+\.js$/.test(path) && !path.endsWith('/index.js'));
  if (kind === 'descriptor' && (modelInputs.length !== 0 || descriptorInputs.length !== count + 1)) {
    throw new Error('Generated descriptor bundle includes original models or loses descriptors');
  }
  if (kind === 'eager' && (modelInputs.length !== count + 1 || descriptorInputs.length !== 0)) {
    throw new Error('Full consumer model import graph mismatch');
  }
  return { source: result.outputFiles[0].text, inputs, modelInputs, descriptorInputs };
}
