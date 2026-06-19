// Local correctness check (no Convex). Generates the tree, then runs the exact
// decode path the action runs — dynamically import a runtime-selected model,
// zx.doc it, decodeDoc a wire fixture, assert the codec types — for one of each
// archetype. Proves the fixtures + assertions are right before spending a deploy.
//
// Run from examples/stress-test:  bun run dynamic-import-validation/data-dependent/validate.ts

import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { zx, decodeDoc } from 'zodvex'
import { generate } from './generate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = join(__dirname, '.out')

const { tables } = generate({ models: 10, outDir: out })
const { MANIFEST } = (await import(join(out, 'manifest.ts'))) as {
  MANIFEST: Record<string, { load: () => Promise<{ __divModel: unknown }>; archetype: string }>
}
const { FIXTURES } = (await import(join(out, 'fixtures.ts'))) as {
  FIXTURES: Record<string, { wire: Record<string, unknown>; assert: (d: any) => string[] }>
}

const perArch: Record<string, string> = {}
for (const t of tables) if (!perArch[t.archetype]) perArch[t.archetype] = t.name

let pass = 0
let fail = 0
for (const [archetype, table] of Object.entries(perArch)) {
  try {
    const mod = await MANIFEST[table].load() // data-dependent dynamic import
    const docSchema = zx.doc(mod.__divModel as any)
    const decoded = decodeDoc(docSchema as any, FIXTURES[archetype].wire)
    const checks = FIXTURES[archetype].assert(decoded)
    console.log(`✓ ${archetype.padEnd(13)} (${table}) — ${checks.join(', ')}`)
    pass++
  } catch (e) {
    console.log(`✗ ${archetype.padEnd(13)} — ${(e as Error).message}`)
    fail++
  }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
