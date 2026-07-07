import fs from 'node:fs'
import path from 'node:path'
import type { AliasEntry } from './tsconfigPaths'

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
function buildHooksSource(aliases: AliasEntry[]): string {
  return `
import { pathToFileURL } from 'node:url';

const EXT_CANDIDATES = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx', '/index.ts', '/index.js'];

// tsconfig path aliases compiled by loadTsconfigAliases (#99). Bun resolves
// these natively; Node's ESM loader needs them replayed here.
const ALIASES = ${JSON.stringify(aliases)};

function aliasCandidates(specifier) {
  const out = [];
  for (const a of ALIASES) {
    if (a.star) {
      if (
        specifier.length >= a.prefix.length + a.suffix.length &&
        specifier.startsWith(a.prefix) &&
        specifier.endsWith(a.suffix)
      ) {
        const captured = specifier.slice(a.prefix.length, specifier.length - a.suffix.length);
        for (const t of a.targets) out.push(t.prefix + captured + t.suffix);
      }
    } else if (specifier === a.prefix) {
      for (const t of a.targets) out.push(t.prefix);
    }
  }
  return out;
}

export async function resolve(specifier, context, nextResolve) {
  if (/_generated\\/api(\\.[mc]?[jt]sx?)?$/.test(specifier)) {
    return { shortCircuit: true, url: 'zodvex-stub://api' };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // tsconfig path aliases (e.g. '@/convex/...'). Try each mapped absolute
    // path as-is, then with the usual extension/index candidates.
    for (const base of aliasCandidates(specifier)) {
      for (const ext of ['', ...EXT_CANDIDATES]) {
        try {
          return await nextResolve(pathToFileURL(base + ext).href, context);
        } catch {}
      }
    }
    // Convex code uses extensionless relative imports (bundler resolution).
    // Bun resolves those natively; Node's ESM loader does not — retry with
    // the usual extension candidates before giving up.
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      for (const ext of EXT_CANDIDATES) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch {}
      }
    }
    throw err;
  }
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
}

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
export function registerDiscoveryHooks(aliases: AliasEntry[] = []): boolean {
  // First registration wins — the CLI runs one project per process, and
  // Module.register hooks can't be replaced anyway.
  if (hooksRegistered) return true
  try {
    // `require` doesn't exist in Node ESM, so a bare require() here silently
    // failed under `node dist/cli/index.js` and the hook never registered.
    // process.getBuiltinModule (Node 22.3+, also implemented by Bun) is the
    // runtime-agnostic synchronous way to reach node:module from ESM.
    const nodeModule =
      typeof process.getBuiltinModule === 'function'
        ? (process.getBuiltinModule('node:module') as typeof import('node:module'))
        : // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('node:module') as typeof import('node:module'))
    const { register } = nodeModule
    if (typeof register !== 'function') return false
    register(`data:text/javascript,${encodeURIComponent(buildHooksSource(aliases))}`)
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
