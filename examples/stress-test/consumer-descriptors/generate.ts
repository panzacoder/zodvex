import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generateModelDescriptors } from './historical-emitter'
import { probeModel, backgroundModel } from './models.mjs'
import { secretCodec } from './codecs.mjs'

export const here = dirname(fileURLToPath(import.meta.url))
export function generateFixture(output: string, count: number, width = 32) {
  mkdirSync(join(output, 'models'), { recursive: true })
  mkdirSync(join(output, '_zodvex/models'), { recursive: true })
  for (const name of ['counters.mjs', 'codecs.mjs', 'models.mjs', 'db-fixture.mjs']) {
    copyFileSync(join(here, name), join(output, name))
  }
  const modelEntries = [probeModel(), ...Array.from({ length: count }, (_, i) => backgroundModel(i, width))]
  const discovery = modelEntries.map((model, i) => ({
    tableName: model.name, exportName: 'Model', sourceFile: `models/${model.name}.ts`, schemas: model.schema,
  }))
  for (const [i, model] of modelEntries.entries()) {
    writeFileSync(join(output, `models/${model.name}.ts`),
      `import { ${i === 0 ? 'probeModel' : 'backgroundModel'} } from '../models.mjs';\n` +
      `export const Model = ${i === 0 ? 'probeModel()' : `backgroundModel(${i - 1}, ${width})`};\n`)
  }
  const descriptors = generateModelDescriptors(discovery, [{ exportName: 'secretCodec', sourceFile: 'codecs.mjs', schema: secretCodec }])
  for (const file of descriptors.files) {
    // Instrument module evaluation; preserve the emitter's schemas/import topology.
    writeFileSync(join(output, `_zodvex/models/${file.name}.js`),
      `import { initialized } from '../../counters.mjs';\ninitialized.descriptors.push(${JSON.stringify(file.name)});\n` + file.js)
  }
  writeFileSync(join(output, '_zodvex/models/index.js'), descriptors.indexJs)
  writeFileSync(join(output, 'eager.ts'),
    `import { defineZodSchema } from 'zodvex/server';\n` +
    modelEntries.map((model, i) => `import { Model as M${i} } from './models/${model.name}.ts';`).join('\n') +
    `\nconst schema = defineZodSchema({${modelEntries.map((m, i) => `${JSON.stringify(m.name)}:M${i}`).join(',')}});\nexport const tableMap = schema.__zodTableMap;\nexport default schema;\n`)
  writeFileSync(join(output, 'descriptor.ts'), `export { zodvexTableMap as tableMap } from './_zodvex/models/index.js';\n`)
  writeFileSync(join(output, 'diagnostic-full.ts'), `export { default } from './eager.ts';\n`)
  writeFileSync(join(output, 'diagnostic-descriptor.ts'), `// Diagnostic adapter only: not a Convex SchemaDefinition.\nimport {tableMap} from './descriptor.ts';\nexport default {__zodTableMap:tableMap};\n`)
  const manifest = { count, width, probeModels: 1, touchedModels: 1, backgroundCodecSites: 4,
    descriptorFiles: descriptors.files.length, fallbacks: descriptors.fallbacks, insertFallbacks: descriptors.insertFallbacks }
  writeFileSync(join(output, 'fixture.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = resolve(process.argv[2]), count = Number(process.argv[3] ?? 16)
  if (!Number.isInteger(count) || count < 0 || count > 64) throw new Error('Count must be 0..64')
  console.log(generateFixture(output, count))
}
