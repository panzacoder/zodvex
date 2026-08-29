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
export async function generate(
  convexDir?: string,
  options?: { mini?: boolean; quiet?: boolean }
): Promise<void> {
  const resolved = resolveConvexDir(convexDir)
  const zodvexDir = path.join(resolved, '_zodvex')

  // Ensure _zodvex/api.js exists before discovery. User modules (e.g., functions.ts)
  // may import zodvexRegistry from it. Without a stub, dynamic import() fails and
  // codegen can't discover those modules — a chicken-and-egg problem.
  // Stubbing overwrites the previous generation, so if anything below throws
  // (e.g. the strict import-failure error), restore the originals: a failed
  // run must not clobber a good checked-in registry (#104).
  const restoreStubbedApi = writeStubApi(zodvexDir)

  let result: Awaited<ReturnType<typeof discoverModules>>
  let schemaContent: ReturnType<typeof generateSchemaFile>
  let apiContent: ReturnType<typeof generateApiFile>
  let argsApiContent: ReturnType<typeof generateApiFile>
  let returnsApiContent: ReturnType<typeof generateApiFile>
  let clientContent: ReturnType<typeof generateClientFile>
  let serverContent: ReturnType<typeof generateServerFile>
  let tablesContent: ReturnType<typeof generateTablesFile>
  let descriptors: ReturnType<typeof generateModelDescriptors>
  try {
    result = await discoverModules(resolved)

    schemaContent = generateSchemaFile(result.models)
    apiContent = generateApiFile(
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
    argsApiContent = generateApiFile(
      result.functions,
      result.models,
      result.codecs,
      result.modelCodecs,
      result.functionCodecs,
      { mini: options?.mini, argsOnly: true }
    )
    // Minimal returns registry for run* result decode (mutations AND
    // actions under 0.8's codec-only semantics) — statically imported by
    // server.ts, kept light the same way api.args.js is.
    returnsApiContent = generateApiFile(
      result.functions,
      result.models,
      result.codecs,
      result.modelCodecs,
      result.functionCodecs,
      { mini: options?.mini, returnsOnly: true }
    )
    clientContent = generateClientFile({ mini: options?.mini })
    // server.ts now consolidates context types + the split registry (lazy
    // full for actions, static args-only for mutations) + static tableMap +
    // a pre-wired initZodvex. Replaces the prior server.js/server.d.ts pair
    // AND the separate api.lazy.{js,d.ts} + tableMap.lazy.{js,d.ts} files
    // (now stale; cleaned up below).
    serverContent = generateServerFile(result.models, { mini: options?.mini })
    tablesContent = generateTablesFile(result.models)
    // Per-table codec descriptors (_zodvex/models/) — the central tableMap at
    // O(codec fields) cost. See generateModelDescriptors.
    descriptors = generateModelDescriptors(result.models, result.codecs, {
      mini: options?.mini
    })
  } catch (err) {
    restoreStubbedApi()
    throw err
  }
  if (!options?.quiet) {
    for (const fb of descriptors.fallbacks) {
      console.warn(
        `[zodvex] Note: table '${fb.tableName}' descriptor falls back to its full model (${fb.reason}). ` +
          `That table costs its model graph in every endpoint bundle; the rest stay light.`
      )
    }
    for (const fb of descriptors.insertFallbacks) {
      console.warn(
        `[zodvex] Note: table '${fb.tableName}' has a non-serializable refinement (${fb.reason}), so its ` +
          `WRITE path (db.insert/patch/replace) imports the full model to enforce it; reads stay light. ` +
          `Built-in checks (.email/.min/.regex/…) are carried inline without this cost. ` +
          `See docs/guide/codegen.md (models/ — doc vs insert).`
      )
    }
  }

  fs.mkdirSync(zodvexDir, { recursive: true })
  writeIfChanged(path.join(zodvexDir, 'schema.js'), schemaContent.js)
  writeIfChanged(path.join(zodvexDir, 'schema.d.ts'), schemaContent.dts)
  writeIfChanged(path.join(zodvexDir, 'api.js'), apiContent.js)
  writeIfChanged(path.join(zodvexDir, 'api.d.ts'), apiContent.dts)
  writeIfChanged(path.join(zodvexDir, 'api.args.js'), argsApiContent.js)
  writeIfChanged(path.join(zodvexDir, 'api.args.d.ts'), argsApiContent.dts)
  writeIfChanged(path.join(zodvexDir, 'api.returns.js'), returnsApiContent.js)
  writeIfChanged(path.join(zodvexDir, 'api.returns.d.ts'), returnsApiContent.dts)
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
  if (!options?.quiet) {
    console.log(
      `[zodvex] Generated ${result.models.length} model(s), ${result.functions.length} function(s), ${totalCodecs} codec(s)`
    )
  }
}

/**
 * Recursively snapshot a directory into a Map of relative-path -> content.
 * A missing directory yields an empty map.
 */
function snapshotDir(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string, prefix: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs, rel)
      else out.set(rel, fs.readFileSync(abs, 'utf-8'))
    }
  }
  walk(dir, '')
  return out
}

/**
 * `zodvex generate --check`: verifies the committed `_zodvex/` output matches
 * what `generate` would produce right now, WITHOUT leaving the tree modified.
 *
 * It runs the real `generate` flow (so the check can never drift from the
 * generator), snapshots `_zodvex/` before and after, diffs, then restores the
 * prior state. Returns the sorted list of stale relative paths — empty means
 * up to date.
 *
 * The failure this catches: a model/schema edited without re-running
 * `zodvex generate`. Because the codec descriptors are generated (the live
 * models are deliberately NOT loaded at runtime), a stale descriptor would
 * silently stop decoding the changed table's codec fields. Drop
 * `zodvex generate --check` into CI / a pre-deploy step to make that loud.
 */
export async function generateCheck(
  convexDir?: string,
  options?: { mini?: boolean }
): Promise<string[]> {
  const resolved = resolveConvexDir(convexDir)
  const zodvexDir = path.join(resolved, '_zodvex')

  const before = snapshotDir(zodvexDir)
  let after: Map<string, string>
  try {
    await generate(resolved, { mini: options?.mini, quiet: true })
    after = snapshotDir(zodvexDir)
  } catch (err) {
    // generate() restores what IT stubbed, but --check must be
    // non-destructive under ANY failure — restore the full snapshot.
    restoreSnapshot(zodvexDir, before)
    throw err
  }

  const stale: string[] = []
  for (const rel of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(rel) !== after.get(rel)) stale.push(rel)
  }
  stale.sort()

  // Restore the pre-check state — `--check` must be non-destructive.
  restoreSnapshot(zodvexDir, before)

  return stale
}

/** Put a directory back to a snapshotDir() state: delete files the snapshot
 *  lacks, rewrite everything it has. */
function restoreSnapshot(zodvexDir: string, snapshot: Map<string, string>): void {
  for (const rel of snapshotDir(zodvexDir).keys()) {
    if (!snapshot.has(rel)) {
      try {
        fs.unlinkSync(path.join(zodvexDir, rel))
      } catch {
        /* best-effort */
      }
    }
  }
  for (const [rel, content] of snapshot) {
    const abs = path.join(zodvexDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
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
 * is overwritten each generate (heavy registry) — a restore closure is
 * returned that puts the pre-existing files back (or removes the stubs if
 * there were none), called when generation fails so a failed run doesn't
 * leave the gutted stub in place of a good registry (#104). `tables.ts` and
 * `server.ts` are STAMPED ONLY IF MISSING — overwriting a real schema
 * mid-generate would cause the convex dev watcher to observe "all tables
 * removed" — so they never need restoring.
 */
function writeStubApi(zodvexDir: string): () => void {
  // EVERY file this function unconditionally overwrites MUST be in this
  // list, or a failed generate leaves its empty stub behind — valid JS
  // that deploys fine and silently disables codec decoding (the #104
  // class, worse: models/index.js is the entire runtime tableMap).
  const stubs: Array<{ name: string; content: string }> = [
    {
      name: 'api.js',
      content:
        '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport const zodvexRegistry = {}\n'
    },
    {
      name: 'api.d.ts',
      content:
        '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport declare const zodvexRegistry: Record<string, any>\n'
    },
    // models/index.js is statically imported by the real server.ts (the
    // descriptor tableMap), so it must resolve during re-discovery too.
    {
      name: path.join('models', 'index.js'),
      content:
        "// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport const zodvexTableMap = {}\nexport const zodvexTableMapFingerprint = ''\n"
    },
    {
      name: path.join('models', 'index.d.ts'),
      content:
        '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport declare const zodvexTableMap: Record<string, any>\nexport declare const zodvexTableMapFingerprint: string\n'
    },
    // api.args.js is statically imported by the real server.ts (mutation
    // scheduler registry), so it must resolve during re-discovery too.
    {
      name: 'api.args.js',
      content:
        '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport const zodvexArgsRegistry = {}\n'
    },
    {
      name: 'api.args.d.ts',
      content:
        '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport declare const zodvexArgsRegistry: Record<string, any>\n'
    },
    // api.returns.js is statically imported by the real server.ts (run*
    // result decode), so it must resolve during re-discovery too.
    {
      name: 'api.returns.js',
      content:
        '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport const zodvexReturnsRegistry = {}\n'
    },
    {
      name: 'api.returns.d.ts',
      content:
        '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport declare const zodvexReturnsRegistry: Record<string, any>\n'
    }
  ]

  const stubTargets = stubs.map(({ name }) => {
    const filePath = path.join(zodvexDir, name)
    let original: string | null
    try {
      original = fs.readFileSync(filePath, 'utf-8')
    } catch {
      original = null
    }
    return { filePath, original }
  })

  fs.mkdirSync(zodvexDir, { recursive: true })
  fs.mkdirSync(path.join(zodvexDir, 'models'), { recursive: true })
  for (const { name, content } of stubs) {
    fs.writeFileSync(path.join(zodvexDir, name), content)
  }

  writeIfMissing(
    path.join(zodvexDir, 'tables.ts'),
    "// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\nexport default {} as Record<string, import('convex/server').TableDefinition>\nexport type DecodedDocs = Record<string, any>\n"
  )

  // server.ts stub matches the shape codegen will later emit:
  // `initZodvex(server, options?)`. It MUST delegate to the real library
  // initZodvex (not return the raw convex builders): discovery reads
  // function meta that only zodvex's wrappers attach, and on a checkout
  // where _zodvex/ is gitignored this stub IS what functions.ts imports on
  // run one — a passthrough here made the first generate discover zero
  // functions and ship empty registries. The empty tableMap keeps the stub
  // inert; the real wrapper (lazy registry/tableMap) lands at the end of
  // generate().
  writeIfMissing(
    path.join(zodvexDir, 'server.ts'),
    `// AUTO-GENERATED by zodvex — do not edit
// Stub created for codegen bootstrap. Real content is emitted at the end
// of \`zodvex generate\`.
import { initZodvex as _libInitZodvex } from 'zodvex/server'
export function initZodvex(server: any, options?: any): any {
  return _libInitZodvex({ __zodTableMap: {} } as any, server, { wrapDb: false, ...options })
}
export type QueryCtx = any
export type MutationCtx = any
export type ActionCtx = any
`
  )

  // Marker file written on bootstrap as well, since Convex's walker reads
  // it before any of zodvex's regular `writeIfChanged` calls would land.
  writeIfMissing(path.join(zodvexDir, 'convex.config.ts'), CONVEX_SKIP_MARKER)

  return () => {
    for (const { filePath, original } of stubTargets) {
      try {
        if (original !== null) {
          fs.writeFileSync(filePath, original)
        } else {
          fs.unlinkSync(filePath)
        }
      } catch {
        // Best-effort restore — the thrown generation error is the headline.
      }
    }
  }
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
