// Loads one Convex-style ESM bundle and reports heap before/after.
// Runs in a fresh node subprocess (one per bundle) so measurements
// are isolated and don't bleed into each other.
//
// stdout is one JSON line. stderr is for human-readable errors.
//
// usage: node --expose-gc [--max-old-space-size=N] measureChild.mjs <bundle.js>

import v8 from 'v8'
import { pathToFileURL } from 'url'

function gc() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
    globalThis.gc()
  }
}

function heap() {
  return v8.getHeapStatistics().used_heap_size
}

const bundlePath = process.argv[2]
if (!bundlePath) {
  console.error('missing bundle path')
  process.exit(2)
}

const startedAt = Date.now()

let modulesLoaded = 0
let modulesFailed = 0
let importError = null

gc()
const heapBefore = heap()
const rssBefore = process.memoryUsage().rss

try {
  await import(pathToFileURL(bundlePath).href)
  modulesLoaded = 1
} catch (err) {
  modulesFailed = 1
  importError = (err && (err.stack || err.message)) || String(err)
}

gc()
const heapAfter = heap()
const rssAfter = process.memoryUsage().rss
const elapsedMs = Date.now() - startedAt

process.stdout.write(JSON.stringify({
  bundle: bundlePath,
  heapBeforeBytes: heapBefore,
  heapAfterBytes: heapAfter,
  heapDeltaBytes: heapAfter - heapBefore,
  rssBeforeBytes: rssBefore,
  rssAfterBytes: rssAfter,
  modulesLoaded,
  modulesFailed,
  importError,
  elapsedMs,
}) + '\n')

process.exit(modulesFailed > 0 ? 1 : 0)
