// Spawns a fresh node subprocess per bundle and collects a single
// heap measurement. Each call is independent so distributions reflect
// per-endpoint cost — the new Convex backend behavior.

import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CHILD = join(__dirname, 'measureChild.mjs')

export interface MeasureResult {
  bundle: string
  ok: boolean
  heapBeforeBytes: number
  heapAfterBytes: number
  heapDeltaBytes: number
  heapDeltaMB: number
  rssAfterMB: number
  modulesLoaded: number
  modulesFailed: number
  elapsedMs: number
  exitCode: number
  oom: boolean
  error: string | null
}

export interface MeasureOptions {
  bundle: string
  /** Hard cap heap in MB. Omit to let node default (no cap). */
  maxOldSpaceMB?: number
  /** Timeout in ms. Default 60s. */
  timeoutMs?: number
}

const OOM_PATTERNS = [
  /JavaScript heap out of memory/i,
  /Allocation failed/i,
  /Reached heap limit/i,
]

export function measureBundle(opts: MeasureOptions): Promise<MeasureResult> {
  const { bundle, maxOldSpaceMB, timeoutMs = 60_000 } = opts

  const nodeArgs = ['--expose-gc']
  if (maxOldSpaceMB) nodeArgs.push(`--max-old-space-size=${maxOldSpaceMB}`)
  nodeArgs.push(CHILD, bundle)

  return new Promise((resolve) => {
    const child = spawn(process.execPath, nodeArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.on('data', (b) => { stdout += b.toString() })
    child.stderr.on('data', (b) => { stderr += b.toString() })

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      let parsed: any = null
      try {
        const lastLine = stdout.trim().split('\n').pop() ?? ''
        if (lastLine) parsed = JSON.parse(lastLine)
      } catch { /* ignore */ }

      const oom = OOM_PATTERNS.some(re => re.test(stderr))
      const ok = code === 0 && parsed && parsed.modulesFailed === 0

      resolve({
        bundle,
        ok,
        heapBeforeBytes: parsed?.heapBeforeBytes ?? 0,
        heapAfterBytes: parsed?.heapAfterBytes ?? 0,
        heapDeltaBytes: parsed?.heapDeltaBytes ?? 0,
        heapDeltaMB: parsed ? +(parsed.heapDeltaBytes / 1024 / 1024).toFixed(2) : 0,
        rssAfterMB: parsed ? +(parsed.rssAfterBytes / 1024 / 1024).toFixed(2) : 0,
        modulesLoaded: parsed?.modulesLoaded ?? 0,
        modulesFailed: parsed?.modulesFailed ?? 1,
        elapsedMs: parsed?.elapsedMs ?? 0,
        exitCode: code ?? -1,
        oom,
        error: killed
          ? `timeout after ${timeoutMs}ms`
          : (parsed?.importError ?? (stderr.trim() || (signal ? `signal: ${signal}` : null))),
      })
    })
  })
}

// CLI: bun run measureBundle.ts --bundle=path [--cap=64]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const bundle = args.find(a => a.startsWith('--bundle='))?.split('=')[1]
  if (!bundle) throw new Error('--bundle required')
  const cap = args.find(a => a.startsWith('--cap='))?.split('=')[1]
  const result = await measureBundle({
    bundle,
    maxOldSpaceMB: cap ? Number(cap) : undefined,
  })
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}
