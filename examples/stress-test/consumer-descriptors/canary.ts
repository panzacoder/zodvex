import { mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { z } from 'zod'
import { generateFixture, here } from './generate'
import { generateModelDescriptors } from './historical-emitter'
import { validatedTextCodec } from './codecs.mjs'
import { captureProvenance, sha256 } from '../memory/provenance.mjs'

const [backendDir, outputArg] = process.argv.slice(2)
if (!backendDir || !outputArg) throw new Error('Usage: bun consumer-descriptors/canary.ts BACKEND_DIR NEW_OUTPUT_DIR')
const out = resolve(outputArg)
if (existsSync(out)) throw new Error('Preserve prior evidence: choose a new output directory')
const metadata = JSON.parse(readFileSync(join(backendDir, 'metadata.json'), 'utf8'))
if (new URL(metadata.url).hostname !== '127.0.0.1' || new URL(metadata.url).port !== '3240') throw new Error('This canary requires the dedicated local backend at 127.0.0.1:3240')
const key = readFileSync(join(backendDir, 'admin-key'), 'utf8').trim()
const project = join(out, 'project')
const convex = join(project, 'convex')
mkdirSync(convex, { recursive: true })
generateFixture(join(convex, 'fixture'), 0)
// Diagnostic-only entry names are not Convex function-module names.
for (const name of ['diagnostic-full.ts', 'diagnostic-descriptor.ts']) rmSync(join(convex, 'fixture', name))
renameSync(join(convex, 'fixture/db-fixture.mjs'), join(convex, 'fixture/db_fixture.mjs'))
const installedVersions = captureProvenance().versions
writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'descriptor-local-canary', private: true, type: 'module', dependencies: {
  convex: installedVersions.convex, zod: installedVersions.zod, zodvex: installedVersions.zodvex,
} }, null, 2))
writeFileSync(join(project, 'convex.json'), JSON.stringify({ functions: 'convex/' }))
writeFileSync(join(convex, 'schema.ts'), `import {defineSchema,defineTable} from 'convex/server';
import {v} from 'convex/values';
export default defineSchema({
 probe:defineTable({name:v.string(),createdAt:v.number(),secret:v.string(),updatedAt:v.optional(v.number()),nested:v.object({history:v.array(v.number()),note:v.string()})}),
 events:defineTable(v.union(v.object({kind:v.literal('checked'),text:v.string()}),v.object({kind:v.literal('plain'),name:v.string()})))
});\n`)
// A string is valid at the storage boundary; decoded output must have length >=3.
const eventSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('checked'), text: validatedTextCodec }), z.object({ kind: z.literal('plain'), name: z.string() })])
const emitted = generateModelDescriptors([{ tableName: 'events', exportName: 'EventModel', sourceFile: 'events.ts', schemas: { doc: eventSchema, insert: eventSchema } as any }],
  [{ exportName: 'validatedTextCodec', sourceFile: 'codecs.mjs', schema: validatedTextCodec }])
writeFileSync(join(convex, 'fixture/_zodvex/models/events.js'), emitted.files[0].js)
writeFileSync(join(convex, 'canary.ts'), `import {internalMutation} from './_generated/server';
import {v} from 'convex/values';
import {z} from 'zod';
import {ZodvexDatabaseWriter} from 'zodvex/server';
import {tableMap as full} from './fixture/eager';
import {tableMap as descriptor} from './fixture/descriptor';
import eventDescriptor from './fixture/_zodvex/models/events.js';
import {validatedTextCodec} from './fixture/codecs.mjs';
import {runtimeValue,TS} from './fixture/db_fixture.mjs';
const eventSchema=z.discriminatedUnion('kind',[z.object({kind:z.literal('checked'),text:validatedTextCodec}),z.object({kind:z.literal('plain'),name:z.string()})]);
const rowValidator=v.object({kind:v.string(),encoded:v.boolean(),decoded:v.boolean(),codecPatch:v.boolean(),ordinaryPatch:v.boolean(),unset:v.boolean(),replace:v.boolean()});
export const verify=internalMutation({args:{},returns:v.object({rows:v.array(rowValidator),wireValidStored:v.boolean(),fullRejected:v.boolean(),descriptorReturnedRaw:v.boolean(),cleaned:v.boolean()}),handler:async(ctx)=>{
 const rows=[];
 for(const [kind,tableMap] of [['full',full],['descriptor',descriptor]] as const){
  const db=new ZodvexDatabaseWriter(ctx.db,tableMap);
  const id=await db.insert('probe',runtimeValue());
  const wire=await ctx.db.get('probe',id);
  const got=await db.get('probe',id);
  await db.patch('probe',id,{updatedAt:new Date(TS+2),name:'patched'});
  const patched=await db.get('probe',id);
  await db.patch('probe',id,{updatedAt:undefined});
  const unset=await db.get('probe',id);
  await db.replace('probe',id,{...runtimeValue(),name:'replaced'});
  const replaced=await db.get('probe',id);
  rows.push({kind,encoded:wire?.createdAt===TS&&wire?.secret==='value',decoded:got?.createdAt.getTime()===TS&&got?.secret.reveal()==='value',codecPatch:patched?.updatedAt?.getTime()===TS+2,ordinaryPatch:patched?.name==='patched',unset:!('updatedAt' in unset!),replace:replaced?.name==='replaced'&&replaced?.secret.reveal()==='value'});
  await ctx.db.delete('probe',id);
 }
 const id=await ctx.db.insert('events',{kind:'checked',text:'x'});
 const wire=await ctx.db.get('events',id);
 const fullDb=new ZodvexDatabaseWriter(ctx.db,{events:{doc:eventSchema,insert:eventSchema}});
 const descriptorDb=new ZodvexDatabaseWriter(ctx.db,{events:eventDescriptor});
 let fullRejected=false;
 try{await fullDb.get('events',id)}catch{fullRejected=true}
 const decoded=await descriptorDb.get('events',id);
 await ctx.db.delete('events',id);
 return {rows,wireValidStored:wire?.kind==='checked'&&wire.text==='x',fullRejected,descriptorReturnedRaw:(decoded as any)?.text==='x',cleaned:(await ctx.db.query('probe').take(1)).length===0&&(await ctx.db.query('events').take(1)).length===0};
}});\n`)
// JS fixture modules are checked through the generated consumer graph and runtime canary.
writeFileSync(join(convex, 'fixture/_zodvex/models/events.d.ts'), "import type {$ZodType} from 'zod/v4/core';\ndeclare const descriptor:{doc:$ZodType;insert:$ZodType};export default descriptor;\n")
const require = createRequire(join(here, '../package.json'))
const cli = join(require.resolve('convex/package.json'), '..', 'dist/cli.bundle.cjs')
const environment: NodeJS.ProcessEnv = { ...process.env, CONVEX_SELF_HOSTED_URL: metadata.url, CONVEX_SELF_HOSTED_ADMIN_KEY: key }
delete environment.CONVEX_DEPLOYMENT
delete environment.CONVEX_DEPLOY_KEY
const sanitize = (value: string) => value.replaceAll(key, '[redacted]')
const result = spawnSync(process.execPath, [cli, 'dev', '--once', '--typecheck', 'disable'], { cwd: project, env: environment, encoding: 'utf8', timeout: 60000 })
writeFileSync(join(out, 'deploy.stdout.log'), sanitize(result.stdout ?? ''))
writeFileSync(join(out, 'deploy.stderr.log'), sanitize(result.stderr ?? ''))
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ ...captureProvenance(), metadata, scope: 'Self-cleaning local deployed mutation canary; not capacity measurement', sourceSha256: sha256(readFileSync(join(convex, 'canary.ts'))), deployExitCode: result.status }, null, 2))
if (result.status !== 0) throw new Error('Local canary deploy failed; see sanitized evidence')
const tsc = join(require.resolve('typescript/package.json'), '..', 'bin/tsc')
const typed = spawnSync(process.execPath, [tsc, '--noEmit', '--allowJs', '--allowImportingTsExtensions', '--skipLibCheck', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ESNext', join(convex, 'canary.ts')], { cwd: project, encoding: 'utf8', timeout: 20000 })
writeFileSync(join(out, 'typecheck.log'), sanitize((typed.stdout ?? '') + (typed.stderr ?? '')))
if (typed.status !== 0) throw new Error('Local canary type check failed')
const called = await fetch(metadata.url + '/api/mutation', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Convex ${key}` },
  body: JSON.stringify({ path: 'canary:verify', args: {}, format: 'json' }),
  signal: AbortSignal.timeout(10000),
})
const raw = await called.json()
writeFileSync(join(out, 'call.json'), JSON.stringify({ httpStatus: called.status, raw }, null, 2))
if (!called.ok || raw.status !== 'success') throw new Error('Local deployed canary invocation failed')
const response = raw.value
writeFileSync(join(out, 'response.json'), JSON.stringify(response, null, 2))
const checks = {
  actualStorageAcceptsWire: response.wireValidStored === true,
  fullRejectsInvalidDecodedValue: response.fullRejected === true,
  descriptorLeaksRawWireValue: response.descriptorReturnedRaw === true,
  rowsCleaned: response.cleaned === true,
  codecOperations: response.rows.length === 2 && response.rows.every((row: any) => row.encoded && row.decoded && row.codecPatch && row.unset && row.replace),
  fullOrdinaryPatch: response.rows.find((row: any) => row.kind === 'full')?.ordinaryPatch === true,
  descriptorOrdinaryPatchGap: response.rows.find((row: any) => row.kind === 'descriptor')?.ordinaryPatch === false,
}
writeFileSync(join(out, 'summary.json'), JSON.stringify({ validObservation: Object.values(checks).every(Boolean), typecheckExitCode: typed.status, checks }, null, 2))
console.log(JSON.stringify({ response, checks }, null, 2))
if (!Object.values(checks).every(Boolean)) process.exitCode = 1
