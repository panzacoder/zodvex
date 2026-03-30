import fs from 'node:fs'
import path from 'node:path'

/**
 * JavaScript source for the ESM loader hook that intercepts `_generated/api`
 * imports during discovery. Runs in Node's loader thread (must be plain JS,
 * not TypeScript).
 *
 * Only `_generated/api` is stubbed — `_generated/server` re-exports generic
 * builders from `convex/server` which work natively outside the Convex runtime.
 * The api stub is needed because `_generated/api` exports a `components` object
 * that triggers component constructors at module scope (e.g. `new LocalDTA(components.localDTA)`).
 */
const HOOKS_SOURCE = `
export function resolve(specifier, context, nextResolve) {
  if (/_generated\\/api(\\.[mc]?[jt]sx?)?$/.test(specifier)) {
    return { shortCircuit: true, url: 'zodvex-stub://api' };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url === 'zodvex-stub://api') {
    return {
      shortCircuit: true,
      format: 'module',
      source: [
        'const handler = {',
        '  get(_, prop) {',
        '    if (typeof prop === "symbol") return undefined;',
        '    if (prop === "__esModule") return true;',
        '    return new Proxy(function(){}, handler);',
        '  },',
        '  apply() { return new Proxy({}, handler); },',
        '  construct() { return new Proxy({}, handler); },',
        '};',
        'const p = new Proxy(function(){}, handler);',
        'export default p;',
        'export const api = p;',
        'export const internal = p;',
        'export const components = p;',
        'export const httpRouter = p;',
      ].join('\\n')
    };
  }
  return nextLoad(url, context);
}
`

let hooksRegistered = false

/**
 * Registers an ESM loader hook via `Module.register()` that intercepts imports
 * of `_generated/api`, replacing it with a deeply-nested Proxy stub. Safe to
 * call multiple times.
 *
 * Only `_generated/api` is intercepted — `_generated/server` works natively
 * outside the Convex runtime.
 *
 * Returns true if hooks were registered, false if Module.register is
 * unavailable (e.g. Bun, older Node).
 */
export function registerDiscoveryHooks(): boolean {
  if (hooksRegistered) return true
  try {
    // Dynamic import to avoid hard dependency on node:module in non-Node runtimes
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('node:module') as typeof import('node:module')
    if (typeof register !== 'function') return false
    register(`data:text/javascript,${encodeURIComponent(HOOKS_SOURCE)}`)
    hooksRegistered = true
    return true
  } catch {
    return false
  }
}

/**
 * Proxy stub for _generated/api.ts.
 *
 * Replaces the real api module (which requires the Convex runtime for
 * `components`) with a deeply-nested Proxy that absorbs property access
 * and constructor calls. This lets module-scope code like
 * `new LocalDTA(components.localDTA)` succeed silently during discovery.
 */
const PROXY_STUB_API = `// zodvex discovery stub — replaced after discovery completes
const handler = {
  get(_, prop) {
    if (typeof prop === 'symbol') return undefined;
    if (prop === '__esModule') return true;
    return new Proxy(function(){}, handler);
  },
  apply() { return new Proxy(function(){}, handler); },
  construct() { return new Proxy(function(){}, handler); },
};
const p = new Proxy(function(){}, handler);
export default p;
export const api = p;
export const internal = p;
export const components = p;
export const httpRouter = p;
`

type StubCleanup = () => void

/**
 * Writes a Proxy stub file to `_generated/api.ts` in the target convex
 * directory. This is a fallback for environments where `Module.register()`
 * is unavailable (Bun, vitest's vite-node, etc.).
 *
 * Only `_generated/api.ts` is stubbed — `_generated/server.ts` re-exports
 * generic builders from `convex/server` which work natively.
 *
 * Returns a cleanup function that restores the original file contents.
 */
export function writeGeneratedStubs(convexDir: string): StubCleanup {
  const generatedDir = path.join(convexDir, '_generated')
  const apiPath = path.join(generatedDir, 'api.ts')

  let original: string | null
  try {
    original = fs.readFileSync(apiPath, 'utf8')
  } catch {
    original = null
  }

  fs.mkdirSync(generatedDir, { recursive: true })
  fs.writeFileSync(apiPath, PROXY_STUB_API)

  return () => {
    if (original !== null) {
      fs.writeFileSync(apiPath, original)
    } else {
      try {
        fs.unlinkSync(apiPath)
      } catch {
        // File may not exist — that's fine
      }
    }
  }
}
