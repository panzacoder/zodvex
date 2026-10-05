import fs from 'node:fs'
import path from 'node:path'
import { PROXY_STUB_API, registerDiscoveryHooks } from './discovery-hooks'
import { loadTsconfigAliases } from './tsconfigPaths'

const projectKey = Symbol.for('zodvex.discovery.project')
const processState = globalThis as typeof globalThis & { [projectKey]?: string }

function claimProject(convexDir: string): void {
  const project = fs.realpathSync(convexDir)
  if (!fs.statSync(project).isDirectory()) throw new Error(`Not a directory: ${convexDir}`)
  if (processState[projectKey] && processState[projectKey] !== project) {
    throw new Error(
      '[zodvex] Discovery already belongs to a different project; use a fresh process.'
    )
  }
  processState[projectKey] = project
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Snapshots are bytes; an unreadable original must never be treated as missing. */
function snapshot(file: string): Buffer | null {
  try {
    return fs.readFileSync(file)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null
    throw error
  }
}

/** Internal filesystem boundary: snapshots are acquired before any replacement. */
class Replacements {
  private originals: Map<string, Buffer | null>
  private touched = new Set<string>()
  private createdDirectories = new Set<string>()

  constructor(files: string[]) {
    this.originals = new Map(files.map(file => [file, snapshot(file)]))
  }

  write(file: string, content: string): void {
    const directory = path.dirname(file)
    if (!fs.existsSync(directory)) {
      this.createdDirectories.add(directory)
      fs.mkdirSync(directory)
    }
    const bytes = Buffer.from(content)
    const current = snapshot(file)
    if (current?.equals(bytes)) return
    // Record before the call: even a failed write may have truncated the file.
    this.touched.add(file)
    fs.writeFileSync(file, bytes)
  }

  restore(): unknown[] {
    const failures: unknown[] = []
    for (const file of this.touched) {
      try {
        const original = this.originals.get(file)
        if (original != null) fs.writeFileSync(file, original)
        else {
          try {
            fs.unlinkSync(file)
          } catch (error) {
            if (!hasCode(error, 'ENOENT')) throw error
          }
        }
      } catch (error) {
        failures.push(
          new Error(`Failed to restore ${file}: ${errorMessage(error)}`, { cause: error })
        )
      }
    }
    for (const directory of [...this.createdDirectories].reverse()) {
      try {
        fs.rmdirSync(directory)
      } catch (error) {
        if (
          !hasCode(error, 'ENOENT') &&
          !hasCode(error, 'ENOTEMPTY') &&
          !hasCode(error, 'EEXIST')
        ) {
          failures.push(
            new Error(`Failed to remove ${directory}: ${errorMessage(error)}`, { cause: error })
          )
        }
      }
    }
    return failures
  }
}

async function withReplacements<T>(
  files: string[],
  commit: boolean,
  work: (files: Replacements) => Promise<T>
): Promise<T> {
  const replacements = new Replacements(files)
  let result: T
  try {
    result = await work(replacements)
  } catch (error) {
    const cleanup = replacements.restore()
    if (cleanup.length)
      throw new AggregateError(
        [error, ...cleanup],
        `Codegen failed and restoration also failed:\nOriginal failure: ${errorMessage(error)}\n${cleanup.map(errorMessage).join('\n')}`,
        {
          cause: error
        }
      )
    throw error
  }
  if (!commit) {
    const cleanup = replacements.restore()
    if (cleanup.length)
      throw new AggregateError(
        cleanup,
        `Discovery restoration failed:\n${cleanup.map(errorMessage).join('\n')}`
      )
  }
  return result
}

/** Loader state is permanent; only temporary filesystem state is restored. */
export function withDiscoveryEnvironment<T>(convexDir: string, work: () => Promise<T>): Promise<T> {
  claimProject(convexDir)
  registerDiscoveryHooks(loadTsconfigAliases(convexDir))
  const api = path.join(convexDir, '_generated/api.ts')
  return withReplacements([api], false, async files => {
    files.write(api, PROXY_STUB_API)
    return work()
  })
}

const outputNames = [
  'schema.js',
  'schema.d.ts',
  'api.js',
  'api.d.ts',
  'client.js',
  'client.d.ts',
  'server.js',
  'server.d.ts'
] as const
export type GeneratedOutput = Record<(typeof outputNames)[number], string>

/** Owns bootstrap, generation, and output rollback as one operation. */
export function withGenerationEnvironment<T>(
  convexDir: string,
  build: () => Promise<{ output: GeneratedOutput; result: T }>
): Promise<T> {
  claimProject(convexDir)
  const directory = path.join(convexDir, '_zodvex')
  return withReplacements(
    outputNames.map(name => path.join(directory, name)),
    true,
    async files => {
      const header =
        '// AUTO-GENERATED by zodvex — do not edit\n// Stub created for codegen bootstrap\n\n'
      files.write(path.join(directory, 'api.js'), `${header}export const zodvexRegistry = {}\n`)
      files.write(
        path.join(directory, 'api.d.ts'),
        `${header}export declare const zodvexRegistry: Record<string, any>\n`
      )
      const { output, result } = await build()
      for (const name of outputNames) files.write(path.join(directory, name), output[name])
      return result
    }
  )
}
