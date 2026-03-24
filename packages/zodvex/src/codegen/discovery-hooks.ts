import fs from 'node:fs'
import path from 'node:path'

/**
 * JavaScript source for the ESM loader hooks that intercept `_generated/api`
 * and `_generated/server` imports during discovery. Runs in Node's loader
 * thread (must be plain JS, not TypeScript).
 */
const HOOKS_SOURCE = `
export function resolve(specifier, context, nextResolve) {
  if (/_generated\\/(api|server)(\\.[mc]?[jt]sx?)?$/.test(specifier)) {
    return {
      shortCircuit: true,
      url: 'zodvex-stub://generated'
    };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url === 'zodvex-stub://generated') {
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
        'const p = new Proxy({}, handler);',
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
 * Registers ESM loader hooks via `Module.register()` that intercept imports
 * of `_generated/api` and `_generated/server`, replacing them with a
 * deeply-nested Proxy stub. Safe to call multiple times.
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

/** Source code for the Proxy stub module (TypeScript-compatible). */
const PROXY_STUB = `
const handler: ProxyHandler<any> = {
  get(_, prop) {
    if (typeof prop === 'symbol') return undefined;
    if (prop === '__esModule') return true;
    return new Proxy(function(){}, handler);
  },
  apply() { return new Proxy({}, handler); },
  construct() { return new Proxy({}, handler); },
};
const p = new Proxy({}, handler);
export default p;
export const api = p;
export const internal = p;
export const components = p;
export const httpRouter = p;
`

/** Plain JS version of the stub for writing to .ts files that will be imported raw. */
const PROXY_STUB_JS = `// zodvex discovery stub — replaced after discovery completes
const handler = {
  get(_, prop) {
    if (typeof prop === 'symbol') return undefined;
    if (prop === '__esModule') return true;
    return new Proxy(function(){}, handler);
  },
  apply() { return new Proxy({}, handler); },
  construct() { return new Proxy({}, handler); },
};
const p = new Proxy({}, handler);
export default p;
export const api = p;
export const internal = p;
export const components = p;
export const httpRouter = p;
`

type StubCleanup = () => void

/**
 * Writes Proxy stub files to `_generated/api.ts` and `_generated/server.ts`
 * in the target convex directory. This is a fallback for environments where
 * `Module.register()` is unavailable (Bun, vitest's vite-node, etc.).
 *
 * Returns a cleanup function that restores the original file contents.
 */
export function writeGeneratedStubs(convexDir: string): StubCleanup {
  const generatedDir = path.join(convexDir, '_generated')
  const targets = ['api.ts', 'server.ts']
  const originals = new Map<string, string | null>()

  for (const file of targets) {
    const filePath = path.join(generatedDir, file)
    try {
      originals.set(filePath, fs.readFileSync(filePath, 'utf8'))
    } catch {
      originals.set(filePath, null)
    }
    fs.mkdirSync(generatedDir, { recursive: true })
    fs.writeFileSync(filePath, PROXY_STUB_JS)
  }

  return () => {
    for (const [filePath, original] of originals) {
      if (original !== null) {
        fs.writeFileSync(filePath, original)
      } else {
        try {
          fs.unlinkSync(filePath)
        } catch {
          // File may not exist — that's fine
        }
      }
    }
  }
}
