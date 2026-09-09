import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256 } from '../memory/provenance.mjs'

export const modelName = i => `model${String(i).padStart(3, '0')}`

export function generateCase(directory, { unused, touched, width = 32 }) {
  if (![0, 16, 64].includes(unused) || ![1, 8].includes(touched) || width !== 32)
    throw new Error('Unsupported bounded experiment dimensions')
  const total = unused + touched
  const names = Array.from({ length: total }, (_, i) => modelName(i))
  const files = {
    'package.json': JSON.stringify({ name: 'zodvex-dynamic-import-probe', private: true,
      type: 'module', dependencies: { convex: '*', 'convex-helpers': '*', zod: '4.5.4', zodvex: '*' } }, null, 2),
    'convex.json': JSON.stringify({ functions: 'convex/', node: { externalPackages: [] } }),
    'convex/tsconfig.json': JSON.stringify({ compilerOptions: {
      strict: true, skipLibCheck: true, moduleResolution: 'Bundler', module: 'ESNext',
      target: 'ESNext', lib: ['ES2021', 'dom'], noEmit: true,
    }, include: ['./**/*.ts'], exclude: ['./_generated'] }, null, 2),
    // Schema deployment does not import the experimental consumer model graphs.
    'convex/schema.ts': `import { defineSchema } from 'convex/server'\nexport default defineSchema({})\n`,
    'convex/shared/observation.ts': `const initialized: string[] = []
export function recordModuleInit(marker: string) { initialized.push(marker) }
export function initializedModules() { return [...initialized].sort() }
`,
  }
  for (const name of ['shape.ts', 'operation.ts'])
    files[`convex/shared/${name}`] = readFileSync(new URL(name, import.meta.url), 'utf8')
  for (const name of names) files[`convex/models/${name}.ts`] = `import { defineZodModel } from 'zodvex'
import { makeFields } from '../shared/shape'
import { recordModuleInit } from '../shared/observation'
recordModuleInit('model-init:${name}')
export const model = defineZodModel('${name}', makeFields(${width}))
`
  files['convex/staticRegistry.ts'] = names.map(name =>
    `import { model as ${name} } from './models/${name}'`).join('\n') + `
export const registry = { ${names.join(', ')} }
export function load(table: string) {
  const model = registry[table as keyof typeof registry]
  if (!model) throw new Error('Unknown table key')
  return model
}
export function retainedChecksum() {
  return Object.entries(registry).reduce((sum, [name, model]) => sum + name.length + Object.keys(model.schema.insert.shape).length, 0)
}
`
  files['convex/dynamicRegistry.ts'] = `const loaders: Record<string, () => Promise<unknown>> = {
${names.map(name => `  '${name}': () => import('./models/${name}'),`).join('\n')}
}
export async function load(table: string) {
  const loader = loaders[table]
  if (!loader) throw new Error('Unknown table key')
  return (await loader() as typeof import('./models/model000')).model
}
export function retainedChecksum() { return Object.keys(loaders).reduce((sum, name) => sum + name.length, 0) }
`
  files['convex/shared/result.ts'] = `import { v } from 'convex/values'
export const resultValidator = v.object({
  nonce: v.string(), before: v.array(v.string()), after: v.array(v.string()),
  touched: v.array(v.string()), registryChecksum: v.number(), liveFields: v.number(),
  results: v.array(v.object({ date: v.number(), secret: v.string(), nestedDate: v.number(),
    nestedSecret: v.string(), arrayNumber: v.number(), roundTrip: v.boolean(),
    invalidInputRejected: v.boolean(), invalidUnionRejected: v.boolean(), invalidOutputRejected: v.boolean(), wireValidInvalidInputRejected: v.boolean() })),
})
export const argsValidator = { nonce: v.string(), tables: v.array(v.string()), gc: v.boolean() }
export function forceGc(enabled: boolean) {
  if (!enabled) return
  const gc = (globalThis as { gc?: () => void }).gc
  if (!gc) throw new Error('GC diagnostic unavailable')
  gc(); gc()
}
`
  for (const kind of ['static', 'dynamic']) files[`convex/${kind}.ts`] = `import { action, query, mutation } from './_generated/server'
import { decodeDoc, encodeDoc } from 'zodvex'
import { load, retainedChecksum } from './${kind}Registry'
import { exercise } from './shared/operation'
import { initializedModules } from './shared/observation'
import { resultValidator, argsValidator, forceGc } from './shared/result'
async function handler(_ctx: unknown, args: { nonce: string; tables: string[]; gc: boolean }) {
  if (args.tables.length < 1 || args.tables.length > 8 || new Set(args.tables).size !== args.tables.length)
    throw new Error('Invalid bounded table selection')
  const before = initializedModules()
  const loaded = []
  const results = []
  for (const table of args.tables) {
    const model = await load(table)
    loaded.push(model)
    results.push(exercise(model.schema.insert, ${width}, decodeDoc, encodeDoc))
  }
  forceGc(args.gc)
  return { nonce: args.nonce, before, after: initializedModules(), touched: args.tables,
    registryChecksum: retainedChecksum(), liveFields: loaded.reduce((sum, model) => sum + Object.keys(model.schema.insert.shape).length, 0), results }
}
export const probe = action({ args: argsValidator, returns: resultValidator, handler })
export const queryProbe = query({ args: argsValidator, returns: resultValidator, handler })
export const mutationProbe = mutation({ args: argsValidator, returns: resultValidator, handler })
`
  files['convex/helpers.ts'] = `import { z } from 'zod'
import { zCustomAction } from 'convex-helpers/server/zod4'
import { NoOp } from 'convex-helpers/server/customFunctions'
import { action } from './_generated/server'
import { makeFields } from './shared/shape'
import { exercise } from './shared/operation'
import { initializedModules, recordModuleInit } from './shared/observation'
import { forceGc } from './shared/result'
recordModuleInit('helper-init:probe')
const schema = z.object(makeFields(${width}))
const helperAction = zCustomAction(action, NoOp)
export const probe = helperAction({
  args: { nonce: z.string(), tables: z.array(z.string()), gc: z.boolean() },
  returns: z.object({ nonce: z.string(), before: z.array(z.string()), after: z.array(z.string()),
    touched: z.array(z.string()), registryChecksum: z.number(), liveFields: z.number(),
    results: z.array(z.object({ date: z.number(), secret: z.string(), nestedDate: z.number(),
      nestedSecret: z.string(), arrayNumber: z.number(), roundTrip: z.boolean(),
      invalidInputRejected: z.boolean(), invalidUnionRejected: z.boolean(), invalidOutputRejected: z.boolean(), wireValidInvalidInputRejected: z.boolean() })) }),
  handler: async (_ctx, args) => {
    if (args.tables.length !== 1 || args.tables[0] !== 'model000') throw new Error('Only the required helper schema is available')
    const before = initializedModules()
    const results = [exercise(schema, ${width}, z.parse, z.encode)]
    forceGc(args.gc)
    return { nonce: args.nonce, before, after: initializedModules(), touched: args.tables,
      registryChecksum: 0, liveFields: Object.keys(schema.shape).length, results }
  },
})
`
  files['convex/canary.ts'] = `import { query } from './_generated/server'
import { v } from 'convex/values'
export const ready = query({ args: { nonce: v.string() },
  returns: v.object({ nonce: v.string(), unused: v.number(), touched: v.number(), width: v.number() }),
  handler: (_ctx, args) => ({ nonce: args.nonce, unused: ${unused}, touched: ${touched}, width: ${width} }) })
`
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, file)), { recursive: true })
    writeFileSync(join(directory, file), source)
  }
  return { unused, touched, width, total, names, sourceHash: sha256(JSON.stringify(files)),
    sourceFiles: Object.fromEntries(Object.entries(files).map(([name, source]) => [name, sha256(source)])) }
}
