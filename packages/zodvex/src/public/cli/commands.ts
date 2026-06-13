import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverModules } from '../codegen/discover'
import {
  generateApiFile,
  generateClientFile,
  generateModelDescriptors,
  generateSchemaFile,
  generateServerFile,
  generateTablesFile
} from '../codegen/generate'

/**
 * One-shot codegen. Discovers modules, generates files.
 */
export async function generate(convexDir?: string, options?: { mini?: boolean }): Promise<void> {
  const resolved = resolveConvexDir(convexDir)
  const zodvexDir = path.join(resolved, '_zodvex')

  // Ensure _zodvex/api.js exists before discovery. User modules (e.g., functions.ts)
  // may import zodvexRegistry from it. Without a stub, dynamic import() fails and
  // codegen can't discover those modules — a chicken-and-egg problem.
  writeStubApi(zodvexDir)

  const result = await discoverModules(resolved)

  const schemaContent = generateSchemaFile(result.models)
  const apiContent = generateApiFile(
    result.functions,
    result.models,
    result.codecs,
    result.modelCodecs,
    result.functionCodecs,
    { mini: options?.mini }
  )
  // Args-only registry for the mutation scheduler path: mutations run in
  // the Q/M V8 sandbox (no dynamic import), but only consult `args`
  // schemas — this file carries no `returns`, so it stays light enough to
  // import statically into every endpoint bundle.
  const argsApiContent = generateApiFile(
    result.functions,
    result.models,
    result.codecs,
    result.modelCodecs,
    result.functionCodecs,
    { mini: options?.mini, argsOnly: true }
  )
  const clientContent = generateClientFile({ mini: options?.mini })
  // server.ts now consolidates context types + the split registry (lazy
  // full for actions, static args-only for mutations) + static tableMap +
  // a pre-wired initZodvex. Replaces the prior server.js/server.d.ts pair
  // AND the separate api.lazy.{js,d.ts} + tableMap.lazy.{js,d.ts} files
  // (now stale; cleaned up below).
  const serverContent = generateServerFile(result.models, { mini: options?.mini })
  const tablesContent = generateTablesFile(result.models)
  // Per-table codec descriptors (_zodvex/models/) — the central tableMap at
  // O(codec fields) cost. See generateModelDescriptors.
  const descriptors = generateModelDescriptors(result.models, result.codecs, {
    mini: options?.mini
  })
  for (const fb of descriptors.fallbacks) {
    console.warn(
      `[zodvex] Note: table '${fb.tableName}' descriptor falls back to its full model (${fb.reason}). ` +
        `That table costs its model graph in every endpoint bundle; the rest stay light.`
    )
  }

  fs.mkdirSync(zodvexDir, { recursive: true })
  writeIfChanged(path.join(zodvexDir, 'schema.js'), schemaContent.js)
  writeIfChanged(path.join(zodvexDir, 'schema.d.ts'), schemaContent.dts)
  writeIfChanged(path.join(zodvexDir, 'api.js'), apiContent.js)
  writeIfChanged(path.join(zodvexDir, 'api.d.ts'), apiContent.dts)
  writeIfChanged(path.join(zodvexDir, 'api.args.js'), argsApiContent.js)
  writeIfChanged(path.join(zodvexDir, 'api.args.d.ts'), argsApiContent.dts)
  // tables.ts and server.ts are emitted as TypeScript so per-table /
  // per-schema types flow through — see the corresponding generators
  // for rationale.
  writeIfChanged(path.join(zodvexDir, 'tables.ts'), tablesContent.js)
  writeIfChanged(path.join(zodvexDir, 'server.ts'), serverContent.js)

  // _zodvex/models/: write current descriptors, then remove orphans from
  // renamed/deleted tables so the index never imports a missing file.
  const modelsDir = path.join(zodvexDir, 'models')
  fs.mkdirSync(modelsDir, { recursive: true })
  const expected = new Set(['index.js', 'index.d.ts'])
  for (const f of descriptors.files) {
    writeIfChanged(path.join(modelsDir, `${f.name}.js`), f.js)
    writeIfChanged(path.join(modelsDir, `${f.name}.d.ts`), f.dts)
    expected.add(`${f.name}.js`)
    expected.add(`${f.name}.d.ts`)
  }
  writeIfChanged(path.join(modelsDir, 'index.js'), descriptors.indexJs)
  writeIfChanged(path.join(modelsDir, 'index.d.ts'), descriptors.indexDts)
  for (const entry of fs.readdirSync(modelsDir)) {
    if (!expected.has(entry)) {
      try {
        fs.unlinkSync(path.join(modelsDir, entry))
      } catch {
        // best-effort cleanup
      }
    }
  }
  writeIfChanged(path.join(zodvexDir, 'client.js'), clientContent.js)
  writeIfChanged(path.join(zodvexDir, 'client.d.ts'), clientContent.dts)

  // Marker file: Convex's bundler skips any subdirectory of convex/ that
  // contains a `convex.config.ts` (it treats those as nested component
  // definitions). We don't actually register _zodvex/ as a component —
  // the file's presence alone makes Convex's entrypoint walker skip
  // the directory.
  writeIfChanged(path.join(zodvexDir, 'convex.config.ts'), CONVEX_SKIP_MARKER)

  // Remove legacy artifacts from prior zodvex versions. server.ts now
  // subsumes server.js + server.d.ts + api.lazy.* + tableMap.lazy.*;
  // tables.ts subsumes the older tables.js + tables.d.ts pair.
  for (const stale of [
    'api.lazy.js',
    'api.lazy.d.ts',
    'tableMap.lazy.js',
    'tableMap.lazy.d.ts',
    'server.js',
    'server.d.ts',
    'tables.js',
    'tables.d.ts'
  ]) {
    const p = path.join(zodvexDir, stale)
    try {
      fs.unlinkSync(p)
    } catch {
      /* not present */
    }
  }

  const totalCodecs =
    result.codecs.length + result.modelCodecs.length + result.functionCodecs.length
  console.log(
    `[zodvex] Generated ${result.models.length} model(s), ${result.functions.length} function(s), ${totalCodecs} codec(s)`
  )
}

/**
 * Watch mode. Runs generate() once, then watches for changes.
 */
export async function dev(convexDir?: string, options?: { mini?: boolean }): Promise<void> {
  const resolved = resolveConvexDir(convexDir)

  console.log('[zodvex] Starting watch mode...')
  await generate(resolved, options)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const watcher = fs.watch(resolved, { recursive: true }, (_event, filename) => {
    if (!filename) return
    // Skip generated directories and non-TS files
    if (
      filename.startsWith('_zodvex') ||
      filename.startsWith('_generated') ||
      (!filename.endsWith('.ts') && !filename.endsWith('.js'))
    ) {
      return
    }

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      console.log('[zodvex] Regenerating...')
      // Spawn a fresh `generate` subprocess rather than regenerating in-process.
      // A long-lived watcher can't reliably re-import edited modules: Bun's
      // loader caches ESM by resolved path and ignores query-string busting, so
      // an in-process regen emits stale output. A fresh process starts with an
      // empty module cache and always sees the latest source.
      void regenerate(resolved, options)
    }, 300)
  })

  // Keep process alive
  process.on('SIGINT', () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    watcher.close()
    process.exit(0)
  })
}

/**
 * Regenerate in a fresh subprocess. The dev watcher cannot re-import edited
 * modules in-process under Bun (it caches ESM by resolved path and ignores
 * query-string cache-busting), so each change spawns a one-shot `zodvex
 * generate`, which starts with an empty module cache and always sees the
 * latest source. Runtime-agnostic by construction.
 *
 * @internal Exported for tests; not part of the public API.
 */
export function regenerate(resolved: string, options?: { mini?: boolean }): Promise<void> {
  const cliEntry = fileURLToPath(new URL('./index.js', import.meta.url))
  const args = [cliEntry, 'generate', resolved]
  if (options?.mini) args.push('--mini')
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.on('exit', code => {
      if (code !== 0) console.error(`[zodvex] Regeneration exited with code ${code}`)
      resolve()
    })
    child.on('error', err => {
      console.error('[zodvex] Failed to spawn regeneration:', err.message)
      resolve()
    })
  })
}

// NOOP marker: presence of this file makes Convex's CLI walker skip the
// _zodvex/ directory during entrypoint discovery (see `looksLikeNestedComponent`
// in convex/dist/esm/bundler/index.js). Only `fs.exists` is checked, so the
// file's content is irrelevant — a comment is sufficient.
const CONVEX_SKIP_MARKER = `// NOOP — prevents Convex from importing the zod-only code into the runtime isolate.
// See https://github.com/panzacoder/zodvex for context.
`

/**
 * Writes minimal stubs before discovery so user modules that import from
 * `./_zodvex/...` resolve on first-ever run (chicken-and-egg). `api.{js,d.ts}`
 * is overwritten each generate (heavy registry); `tables.ts` and `server.ts`
 * are STAMPED ONLY IF MISSING — overwriting a real schema mid-generate would
 * cause the convex dev watcher to observe "all tables removed".
 */
function writeStubApi(zodvexDir: string): void {
  fs.mkdirSync(zodvexDir, { recursive: true })

  fs.writeFileSync(
    path.join(zodvexDir, 'api.js'),
    '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport const zodvexRegistry = {}\n'
  )
  fs.writeFileSync(
    path.join(zodvexDir, 'api.d.ts'),
    '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport declare const zodvexRegistry: Record<string, any>\n'
  )

  // models/index.js is statically imported by the real server.ts (the
  // descriptor tableMap), so it must resolve during re-discovery too.
  fs.mkdirSync(path.join(zodvexDir, 'models'), { recursive: true })
  fs.writeFileSync(
    path.join(zodvexDir, 'models', 'index.js'),
    "// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport const zodvexTableMap = {}\nexport const zodvexTableMapFingerprint = ''\n"
  )
  fs.writeFileSync(
    path.join(zodvexDir, 'models', 'index.d.ts'),
    '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport declare const zodvexTableMap: Record<string, any>\nexport declare const zodvexTableMapFingerprint: string\n'
  )

  // api.args.js is statically imported by the real server.ts (mutation
  // scheduler registry), so it must resolve during re-discovery too.
  fs.writeFileSync(
    path.join(zodvexDir, 'api.args.js'),
    '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport const zodvexArgsRegistry = {}\n'
  )
  fs.writeFileSync(
    path.join(zodvexDir, 'api.args.d.ts'),
    '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport declare const zodvexArgsRegistry: Record<string, any>\n'
  )

  writeIfMissing(
    path.join(zodvexDir, 'tables.ts'),
    "// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport default {} as Record<string, import('convex/server').TableDefinition>\nexport type DecodedDocs = Record<string, any>\n"
  )

  // server.ts stub matches the shape codegen will later emit:
  // `initZodvex(server, options?)` with the same args destructured. Returns
  // the raw convex builders as a passthrough so discovery's dynamic imports
  // resolve. Discovery scans function-meta via zodvex's wrapper anyway, so
  // this stub merely keeps imports working; the real wrapper (with lazy
  // registry/tableMap) lands at the end of generate().
  writeIfMissing(
    path.join(zodvexDir, 'server.ts'),
    `// AUTO-GENERATED by zodvex — do not edit
// Stub created for codegen bootstrap. Real content is emitted at the end
// of \`zodvex generate\`.
export function initZodvex(server: any, _options?: any): any {
  return {
    zq: server.query,
    zm: server.mutation,
    za: server.action,
    ziq: server.internalQuery,
    zim: server.internalMutation,
    zia: server.internalAction,
  }
}
export type QueryCtx = any
export type MutationCtx = any
export type ActionCtx = any
`
  )

  // Marker file written on bootstrap as well, since Convex's walker reads
  // it before any of zodvex's regular `writeIfChanged` calls would land.
  writeIfMissing(path.join(zodvexDir, 'convex.config.ts'), CONVEX_SKIP_MARKER)
}

function writeIfMissing(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) return
  fs.writeFileSync(filePath, content)
}

/** Only write if content differs from what's on disk — prevents file watcher loops. */
function writeIfChanged(filePath: string, content: string): void {
  try {
    const existing = fs.readFileSync(filePath, 'utf-8')
    if (existing === content) return
  } catch {
    // File doesn't exist yet — write it
  }
  fs.writeFileSync(filePath, content)
}

function resolveConvexDir(dir?: string): string {
  if (dir) {
    const resolved = path.resolve(dir)
    if (!fs.existsSync(resolved)) {
      throw new Error(`Convex directory not found: ${resolved}`)
    }
    return resolved
  }

  // Default: look for ./convex/ in cwd
  const defaultDir = path.resolve('convex')
  if (!fs.existsSync(defaultDir)) {
    throw new Error('No convex/ directory found. Specify the path: zodvex generate <path>')
  }
  return defaultDir
}
