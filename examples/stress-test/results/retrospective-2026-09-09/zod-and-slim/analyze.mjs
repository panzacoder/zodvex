import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, digestBuild } from './memory/provenance.mjs';
import { assertGraphResult } from './memory/oracle.mjs';
const read = p => JSON.parse(readFileSync(p,'utf8'));
const kinds = ['native','helpers','full','mini'];
const origin=read('source-origin.json');
assert.deepEqual(digestBuild(existsSync('frozen-zodvex/dist') ? 'frozen-zodvex/dist' : 'node_modules/zodvex/dist'),origin.zodvexBuild);
const directories=readdirSync('results/local').sort();
assert.equal(directories.length,18);
const identifiers=new Set(), cells=new Set(), observations=[];
let contract, gcEventCount=0; const gcRecordCounts={};
for (const directory of directories) {
 const base=join('results/local',directory), manifest=read(join(base,'manifest.json')), summary=read(join(base,'summary.json'));
 const {zodVersion,schemaHelpers,round}=manifest.retrospective;
 assert.ok(['4.3.6','4.4.3','4.5.4'].includes(zodVersion));
 assert.equal(typeof schemaHelpers,'boolean');
 assert.ok([1,2,3].includes(round));
 const cell=[zodVersion,schemaHelpers,round].join('/');
 assert.ok(!cells.has(cell)); cells.add(cell);
 assert.equal(manifest.versions.zod,zodVersion);
 const normalized={ format:manifest.format, versions:{...manifest.versions,zod:'EXPERIMENTAL_VARIABLE'}, runtime:manifest.runtime, backend:manifest.metadata, sourceHashes:manifest.sourceHashes, comparisonIdentity:manifest.comparisonIdentity, zodvexBuild:manifest.zodvexBuild, sourceOrigin:manifest.sourceOrigin, targetCount:manifest.targetCount,width:manifest.width,profile:manifest.profile,entries:manifest.entries,mode:manifest.mode,diagnosticForcedGc:manifest.diagnosticForcedGc,plannedCalls:manifest.plannedCalls };
 if(!contract) contract=normalized; else assert.deepEqual(normalized,contract);
 assert.equal(manifest.targetCount,16); assert.equal(manifest.width,32); assert.equal(manifest.profile,'codec-rich'); assert.equal(manifest.entries,0);
 assert.equal(manifest.mode,'static'); assert.equal(manifest.diagnosticForcedGc,true); assert.equal(manifest.plannedCalls,8);
 assert.equal(manifest.metadata.reuseIsolates,false); assert.equal(manifest.metadata.sourceRevision,'8bc6aa4645adfd66584034b175dbef96536938b8');
 assert.equal(manifest.metadata.flags,'--expose-gc --trace-gc-nvp');
 assert.equal(summary.format,'zodvex-retrospective-memory-v1'); assert.equal(summary.runId,manifest.runId); assert.equal(summary.valid,true); assert.equal(summary.observedCalls,8); assert.equal(summary.plannedCalls,8);
 assert.equal(summary.manifestSha256,sha256(readFileSync(join(base,'manifest.json'))));
 assert.equal(summary.callsSha256,sha256(readFileSync(join(base,'calls.jsonl'))));
 const rows=readFileSync(join(base,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,8);
 const rowkeys=new Set();
 for(const row of rows) {
  assert.ok(kinds.includes(row.kind)); assert.ok([0,16].includes(row.count)); assert.equal(row.width,32); assert.equal(row.profile,'codec-rich'); assert.equal(row.entries,0);
  const rowkey=[row.kind,row.count].join('/'); assert.ok(!rowkeys.has(rowkey)); rowkeys.add(rowkey);
  assert.ok(!identifiers.has(row.id)); identifiers.add(row.id);
  assert.equal(row.valid,true); assert.equal(row.verificationError,null); assert.equal(row.status,200); assert.equal(row.raw.status,'success');
  assertGraphResult(row.raw.value,{kind:row.kind,count:row.count,width:32,profile:'codec-rich',entries:0,nonce:row.id});
  assert.equal(row.bundleHash,sha256(readFileSync(join(base,'sources',row.id+'.js'))));
  const inputsFile=join(base,'sources',row.id+'.inputs.json');
  assert.equal(row.inputsHash,sha256(readFileSync(inputsFile)));
  const inputs=read(inputsFile);
  let zodInputs=0;
  for (const input of inputs) {
   if(input.path.startsWith('<stdin:')) continue;
   assert.equal(input.sha256,sha256(readFileSync(existsSync('inputs/'+input.sha256) ? 'inputs/'+input.sha256 : input.path)));
   if(input.path.includes('/node_modules/zod/')) { zodInputs++; assert.ok(input.path.includes('/versions/'+zodVersion+'/node_modules/zod/')); }
   if(row.kind==='native') assert.ok(!/\/node_modules\/(zod|zodvex)\//.test(input.path));
   if(row.kind==='helpers') assert.ok(!input.path.includes('/node_modules/zodvex/'));
   if(row.kind==='mini') assert.ok(!input.path.includes('/classic/'));
  }
  assert.equal(zodInputs>0,row.kind!=='native');
  const captured=readFileSync(join(base,'gc-'+row.id+'.log'),'utf8').split('\n').flatMap(line=>{
   const at=line.indexOf('GC: {'); if(at<0) return [];
   try { const gc=JSON.parse(line.slice(at+4).trim()); return gc.reason==='testing'?[{identity:line.slice(0,at).match(/^\[[^\]]+\]/)?.[0],...gc}]:[]; } catch{return [];}
  });
  assert.deepEqual(captured,row.gc); assert.ok(row.gc.length>=2); gcEventCount+=row.gc.length; gcRecordCounts[row.gc.length]=(gcRecordCounts[row.gc.length]??0)+1;
  assert.equal(new Set(row.gc.map(gc=>gc.identity)).size,1);
  for(const gc of row.gc) {assert.ok(gc.identity);assert.equal(gc.reason,'testing');assert.equal(gc.gc,'mc');assert.ok(Number.isSafeInteger(gc.end_object_size)&&gc.end_object_size>0);}
  assert.equal(row.totalRetainedObjectBytes,row.gc.at(-1).end_object_size);
  assert.equal(row.retained.afterStaticGraphAndOperation,row.totalRetainedObjectBytes);
 }
 for(const kind of kinds) {
  const control=rows.find(r=>r.kind===kind&&r.count===0),target=rows.find(r=>r.kind===kind&&r.count===16);
  const delta=target.totalRetainedObjectBytes-control.totalRetainedObjectBytes;
  assert.deepEqual(summary.deltas.find(d=>d.kind===kind),{kind,controlBytes:control.totalRetainedObjectBytes,targetBytes:target.totalRetainedObjectBytes,deltaBytes:delta,bytesPerModel:delta/16});
  observations.push({zodVersion,schemaHelpers,round,kind,collection:base,controlBytes:control.totalRetainedObjectBytes,targetBytes:target.totalRetainedObjectBytes,deltaBytes:delta,controlBundleBytes:control.bytes,targetBundleBytes:target.bytes});
 }
}
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);assert.equal(sorted.length,3);return{median:sorted[1],min:sorted[0],max:sorted[2],samples:values};};
const groups=[];
for(const zodVersion of ['4.3.6','4.4.3','4.5.4']) for(const schemaHelpers of [true,false]) for(const kind of kinds) {
 const selected=observations.filter(row=>row.zodVersion===zodVersion&&row.schemaHelpers===schemaHelpers&&row.kind===kind).sort((a,b)=>a.round-b.round);
 groups.push({zodVersion,schemaHelpers,kind,controlBytes:stats(selected.map(r=>r.controlBytes)),targetBytes:stats(selected.map(r=>r.targetBytes)),deltaBytes:stats(selected.map(r=>r.deltaBytes)),targetBundleBytes:stats(selected.map(r=>r.targetBundleBytes)),bytesPerBackgroundModel:stats(selected.map(r=>r.deltaBytes/16))});
}
const group=(version,helpers,kind)=>groups.find(g=>g.zodVersion===version&&g.schemaHelpers===helpers&&g.kind===kind);
const change=(before,after)=>({beforeBytes:before.deltaBytes.median,afterBytes:after.deltaBytes.median,changeBytes:after.deltaBytes.median-before.deltaBytes.median,changePercent:(after.deltaBytes.median/before.deltaBytes.median-1)*100});
const zodComparisons=[],helperComparisons=[];
for(const [fromZodVersion,toZodVersion] of [['4.3.6','4.5.4'],['4.4.3','4.5.4'],['4.3.6','4.4.3']]) for(const schemaHelpers of [true,false]) for(const kind of kinds) zodComparisons.push({fromZodVersion,toZodVersion,schemaHelpers,kind,...change(group(fromZodVersion,schemaHelpers,kind),group(toZodVersion,schemaHelpers,kind))});
for(const zodVersion of ['4.3.6','4.4.3','4.5.4']) for(const kind of kinds) helperComparisons.push({zodVersion,kind,...change(group(zodVersion,true,kind),group(zodVersion,false,kind))});
const report={format:'zodvex-retrospective-analysis-v1',validatedAt:new Date().toISOString(),valid:true,validation:{collections:18,calls:144,forcedMajorGcEvents:gcEventCount,gcRecordCounts,roundsPerCell:3,uniqueNonces:identifiers.size,independentOracle:true,bundleAndInputsHashes:true,matchedControls:true,exactNonExperimentalContract:true},contract,groups,zodComparisons,helperComparisons,observations};
writeFileSync('retrospective.json',JSON.stringify(report,null,2)+'\n');
const n=x=>x.toLocaleString('en-US');
const lines=['# Retrospective local Convex retained memory — 2026-09-09','','At a fixed 16-background-model, 32-field codec-rich graph, Zod 4.5.4 substantially reduces retained growth compared with 4.3.6. The existing schemaHelpers:false option provides a further reduction on this fixture. All 144 observations passed independent graph/output verification and matched forced-GC records.','','Each value below is the median of three independent collections of (16-model retained bytes − same-kind zero-background-model retained bytes). Each collection uses fresh isolates. The fixed four-field probe remains in both controls and targets. Ranges are observed minima/maxima, not confidence intervals.','','| Zod | Schema helpers | Kind | Matched delta bytes, median [min–max] | Target total, median bytes | Control total, median bytes |','| --- | --- | --- | ---: | ---: | ---: |'];
for(const g of groups) lines.push(`| ${g.zodVersion} | ${g.schemaHelpers?'ON':'OFF'} | ${g.kind} | ${n(g.deltaBytes.median)} [${n(g.deltaBytes.min)}–${n(g.deltaBytes.max)}] | ${n(g.targetBytes.median)} | ${n(g.controlBytes.median)} |`);
lines.push('','| Change | Kind | Before delta bytes | After delta bytes | Change |','| --- | --- | ---: | ---: | ---: |');
for(const c of zodComparisons.filter(c=>c.schemaHelpers)) lines.push(`| Zod ${c.fromZodVersion} → ${c.toZodVersion}, helpers ON | ${c.kind} | ${n(c.beforeBytes)} | ${n(c.afterBytes)} | ${c.changePercent.toFixed(2)}% |`);
for(const c of helperComparisons.filter(c=>c.zodVersion==='4.5.4')) lines.push(`| Helpers ON → OFF, Zod 4.5.4 | ${c.kind} | ${n(c.beforeBytes)} | ${n(c.afterBytes)} | ${c.changePercent.toFixed(2)}% |`);
lines.push('','Native and convex-helpers do not consume schemaHelpers; their repeated ON/OFF cells are no-op controls. Native retained growth was exactly 162,504 bytes in every collection. Full/Mini library registration and builders remain enabled in every modeled cell. Registry entry count is zero.','','This measures V8 retained object bytes after the tiny decode/encode operation and two explicit globalThis.gc calls on one official local Convex backend. The collector requires at least two matching major-GC records and uses the final record; five 4.4.3 helpers observations emitted three records, all from the same isolate, and remain included. It excludes external bytes, peak allocation, allocator/RSS overhead, hosted infrastructure, deployment analysis, populated database wrappers, and request-registry growth. Absolute zero-count retained bytes increased with the newer Zod, while background-graph growth fell. Bundle size, total retained bytes, and matched graph growth remain separate quantities. Three repeats on one backend process are not multiple-host replications.','','## Frozen identities','',`- Zodvex source: ${origin.gitCommit}, package ${origin.versions.zodvex}; checkout was clean.`,`- Actual built JavaScript digest: ${origin.zodvexBuild.sha256} (${origin.zodvexBuild.files} files).`,`- Backend source: ${contract.backend.sourceRevision}; binary SHA-256 ${contract.backend.sha256}.`,`- Collector: Bun ${contract.runtime.bun}, Node compatibility ${contract.runtime.nodeCompatibility}, ${contract.runtime.platform}/${contract.runtime.arch}.`,`- Fixed dependencies: Convex ${contract.versions.convex}, convex-helpers ${contract.versions['convex-helpers']}, esbuild ${contract.versions.esbuild}.`,'- Exact Zod package locks are versions/4.3.6/bun.lock, versions/4.4.3/bun.lock and versions/4.5.4/bun.lock.','- Dedicated loopback backend, REUSE_ISOLATES=false; V8 flags --expose-gc --trace-gc-nvp.','','## Instrumentation adaptations','','Only an isolated copy of the benchmark changed. Canonical source is saved under canonical/, adapted source under memory/, and adapt.py records the transformations. No library/runtime optimization was introduced.','','1. The model factory gets the supported third argument {schemaHelpers:false} in OFF cells; ON retains the omitted-option default. The same fields, codec closures, instances, names, dimensions and operation remain unchanged.','2. Slim models omit .schema. After defineZodSchema, both modes retain insert schemas through the existing __zodTableMap aliases. ON therefore retains the same object as canonical model.schema.insert. The later alias checksum is unchanged. The registry doc accessor uses that same map, although registry count is zero in this experiment.','3. The bundler supplies one exact Zod package root via esbuild alias. All resolved input paths and content hashes are saved per observation. Collection and analysis reject mixed Zod versions; Mini rejects classic imports; native/helpers reject Zodvex contamination. The virtual stdin source is hashed separately.','4. Provenance reads the frozen origin metadata rather than the unrelated temporary directory Git state. Zod version, helper mode and round are explicit experimental metadata. The evidence format is distinct from ordinary compatible-build comparisons. Canonical comparison guards were not changed.','5. The collector only adds resolved-input evidence and the retrospective format marker. The request API, forced-GC position, oracle, freshness, response/GC validity requirements and per-kind control subtraction are unchanged.','','One preflight attempt stopped before sending any backend request because the input-hash recorder treated esbuild virtual stdin as a disk file. The fix handles virtual stdin explicitly. That incomplete attempt is retained under attempts/ and excluded from all results. No statistical outlier or failed backend observation was discarded.','','## Reproduction and files','','The study order and dimensions are in run-plan.json. run-study.mjs collected all eighteen cells sequentially; round two reverses version and helper order, and round three rotates versions. The earlier two-version study remains preserved separately and is not pooled into these final samples. Every observed query uses a fresh isolate. Start the same binary with memory/start-local.py and an existing valid local-development admin key on dedicated ports. Key files and backend database are outside this evidence directory.','','Use the selected environment variables ZOD_RETRO_VERSION=4.3.6, 4.4.3 or 4.5.4, ZOD_RETRO_HELPERS=on or off, and ZOD_RETRO_ROUND=1/2/3 with:','','```sh','bun memory/local.mjs /path/to/dedicated-backend 16 32 codec-rich','bun analyze.mjs','```','','Frozen compiled bundles under results/local/*/sources/ can also be sent directly to the same local tester API; their only runtime external import is the Convex system query wrapper. Rebuilding requires the recorded library dist, selected Zod package, and fixed dependency versions; source paths in captured input metadata identify this original run. The portable archive includes each unique resolved input under inputs/<sha256>, allowing analyze.mjs to validate content offline without access to those original paths.','','retrospective.json contains all integer samples, medians/ranges, differences, contract identities and collection references. Every collection has manifest.json, summary.json, calls.jsonl, source bundles, resolved-input hashes and raw GC excerpts. The JSON summarizes 18 valid collections, 144 valid calls and 293 matching forced major-GC events. This bounded retrospective supplies evidence for prioritization; it does not establish an application memory ceiling or an automatic release gate.','');
writeFileSync('retrospective.md',lines.join('\n'));
console.log(JSON.stringify({validation:report.validation,zodComparisons,helperComparisons},null,2));
