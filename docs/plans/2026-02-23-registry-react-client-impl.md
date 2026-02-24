# Registry, React Hooks & Vanilla Client Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the consumer layer — typed registry, React hooks, vanilla JS client, and action auto-codec — so all three consumers (React, vanilla JS, server actions) get automatic codec transforms.

**Architecture:** zodvex source provides factory functions (`createZodvexHooks`, `createZodvexClient`, `createZodvexActionCtx`) that take a registry and return pre-bound consumers. Codegen produces `_zodvex/api.ts` (registry) and `_zodvex/client.ts` (pre-bound exports). `initZodvex` accepts an optional lazy registry thunk for action codec wrapping.

**Tech Stack:** TypeScript, Zod v4, Convex (`convex/react`, `convex/browser`, `convex/server`), React (peer dep for `zodvex/react`)

**Design doc:** `docs/plans/2026-02-23-registry-react-client-design.md`

---

### Task 1: Spike — Function Path Lookup

**Goal:** Determine how to extract a string key (e.g., `"tasks:list"`) from a Convex `FunctionReference` object, on both server and client.

**Files:**
- Create: `scratch/function-ref-spike.ts`

**Step 1: Research getFunctionName**

Check if `getFunctionName` from `convex/server` is available and what it returns:

```typescript
import { getFunctionName } from 'convex/server'
import { api } from './examples/task-manager/convex/_generated/api'

// Does this work? What format is the string?
const name = getFunctionName(api.tasks.list)
console.log(name) // "tasks:list"? "tasks/list"? something else?
```

Run in the example project to check output format.

**Step 2: Research client-side availability**

Check if `getFunctionName` is importable from `convex/browser` or `convex/react`, or if FunctionReference has a public property:

```typescript
// Check FunctionReference shape
import { api } from './_generated/api'
console.log(Object.keys(api.tasks.list))
console.log(JSON.stringify(api.tasks.list))
// Look for _name, name, or any string path property
```

**Step 3: Research Convex's useQuery internals**

Check how Convex's own `useQuery` resolves the function reference. Look at `node_modules/convex/dist/` for the hook implementation — it must extract the path somewhere.

**Step 4: Decide approach and document**

Write findings in `scratch/function-ref-spike.ts` with the chosen approach. If `getFunctionName` works server-only, we may need a lightweight reimplementation for client-side, or use the same internal property that Convex's `useQuery` uses.

**Step 5: Commit**

```
git add scratch/function-ref-spike.ts
git commit -m "spike: function path lookup from FunctionReference"
```

---

### Task 2: Rename validators.ts to api.ts in Codegen

**Files:**
- Modify: `src/codegen/generate.ts` — rename exported function
- Modify: `src/cli/commands.ts` — change output filename
- Modify: `__tests__/codegen-cli.test.ts` — update assertions
- Modify: `examples/task-manager/convex/_zodvex/` — regenerate

**Step 1: Update generate.ts**

Rename `generateValidatorsFile` to `generateApiFile`. Update the JSDoc:

```typescript
/**
 * Generates the api.ts file content — function-to-schema registry.
 */
export function generateApiFile(
  functions: DiscoveredFunction[],
  models: DiscoveredModel[]
): string {
  // ... existing body unchanged
}
```

**Step 2: Update commands.ts**

Change the output filename and import:

```typescript
import { generateSchemaFile, generateApiFile } from '../codegen/generate'

// In generate():
const apiContent = generateApiFile(result.functions, result.models)
fs.writeFileSync(path.join(zodvexDir, 'api.ts'), apiContent)
```

**Step 3: Update codegen barrel export**

In `src/codegen/index.ts`, update the re-export if `generateValidatorsFile` is exported.

**Step 4: Update tests**

In `__tests__/codegen-cli.test.ts` and any other codegen tests, update references from `validators.ts` to `api.ts` and from `generateValidatorsFile` to `generateApiFile`.

**Step 5: Run tests**

```bash
bun test
```

Expected: all tests pass (547/547).

**Step 6: Regenerate example**

```bash
bun run build && cd examples/task-manager && npx zodvex generate
```

Verify `convex/_zodvex/api.ts` exists (and `validators.ts` is gone).

**Step 7: Commit**

```
git add -A
git commit -m "refactor: rename validators.ts to api.ts in codegen output"
```

---

### Task 3: Build Config — New Entry Points

**Files:**
- Modify: `tsup.config.ts` — add react + client entries
- Modify: `package.json` — add exports, peer deps
- Create: `src/react/index.ts` — barrel export (stub)
- Create: `src/client/index.ts` — barrel export (stub)

**Step 1: Create stub entry points**

`src/react/index.ts`:
```typescript
export { createZodvexHooks } from './hooks'
export type { ZodvexHooks } from './hooks'
```

`src/client/index.ts`:
```typescript
export { createZodvexClient, ZodvexClient } from './zodvexClient'
export type { ZodvexClientOptions } from './zodvexClient'
```

These will fail until we create the implementation files in later tasks. Create empty placeholder modules for now so the build config can be validated:

`src/react/hooks.ts`:
```typescript
// Placeholder — implemented in Task 4
export function createZodvexHooks(_registry: any): any {
  throw new Error('Not implemented')
}
export type ZodvexHooks = any
```

`src/client/zodvexClient.ts`:
```typescript
// Placeholder — implemented in Task 5
export function createZodvexClient(_registry: any, _options: any): any {
  throw new Error('Not implemented')
}
export class ZodvexClient {}
export type ZodvexClientOptions = { url: string; token?: string }
```

**Step 2: Update tsup.config.ts**

Add entry points:

```typescript
entry: [
  'src/index.ts',
  'src/core/index.ts',
  'src/server/index.ts',
  'src/transform/index.ts',
  'src/cli/index.ts',
  'src/codegen/index.ts',
  'src/react/index.ts',   // NEW
  'src/client/index.ts',  // NEW
],
external: ['zod', 'convex', 'convex-helpers', 'bun', 'react'],  // add react
```

**Step 3: Update package.json exports**

Add after the `"./codegen"` entry:

```json
"./react": {
  "types": "./dist/react/index.d.ts",
  "import": "./dist/react/index.js",
  "default": "./dist/react/index.js"
},
"./client": {
  "types": "./dist/client/index.d.ts",
  "import": "./dist/client/index.js",
  "default": "./dist/client/index.js"
}
```

Add `react` as optional peer dependency:

```json
"peerDependencies": {
  "convex": "^1.28.0",
  "convex-helpers": "^0.1.104",
  "react": "^18.0.0 || ^19.0.0",
  "zod": "4.3.6"
},
"peerDependenciesMeta": {
  "react": {
    "optional": true
  }
}
```

**Step 4: Build and verify**

```bash
bun run build
```

Expected: build succeeds, `dist/react/` and `dist/client/` directories created.

**Step 5: Commit**

```
git add -A
git commit -m "chore: add zodvex/react and zodvex/client entry points"
```

---

### Task 4: createZodvexHooks (zodvex/react)

**Files:**
- Create: `src/react/hooks.ts` (replace placeholder)
- Create: `__tests__/react-hooks.test.ts`

**Depends on:** Task 1 spike results (function path extraction method).

**Step 1: Write the test**

```typescript
import { describe, it, expect, mock } from 'bun:test'
import { createZodvexHooks } from '../src/react/hooks'
import { z } from 'zod'
import { zx } from '../src/core/index'

// Mock convex/react
mock.module('convex/react', () => ({
  useQuery: mock((_ref: any, _args: any) => {
    // Return wire-format data
    return { name: 'Alice', createdAt: 1708700000000, _id: 'users:abc', _creationTime: 123 }
  }),
  useMutation: mock((_ref: any) => {
    return mock(async (_args: any) => 'tasks:xyz')
  }),
}))

const registry = {
  'users:get': {
    args: z.object({ id: z.string() }),
    returns: z.object({ name: z.string(), createdAt: zx.date(), _id: z.string(), _creationTime: z.number() }),
  },
} as const

describe('createZodvexHooks', () => {
  const { useZodQuery } = createZodvexHooks(registry)

  it('should decode query results through returns schema', () => {
    const fakeRef = { _name: 'users:get' } as any
    const result = useZodQuery(fakeRef, { id: 'abc' })
    expect(result).toBeDefined()
    expect(result!.createdAt).toBeInstanceOf(Date)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test __tests__/react-hooks.test.ts
```

Expected: FAIL (placeholder throws).

**Step 3: Implement createZodvexHooks**

Replace the placeholder in `src/react/hooks.ts`:

```typescript
import { useQuery, useMutation } from 'convex/react'
import type { FunctionReference, OptionalRestArgsOrSkip } from 'convex/server'
import { z } from 'zod'

type AnyRegistry = Record<string, { args: z.ZodTypeAny; returns: z.ZodTypeAny | undefined }>

// Function path extraction — approach determined by Task 1 spike
function getFnPath(ref: FunctionReference<any, any, any, any>): string {
  // TODO: Replace with spike result
  return (ref as any)._name ?? (ref as any).__name
}

export type ZodvexHooks = {
  useZodQuery: typeof useZodQuery
  useZodMutation: typeof useZodMutation
}

export function createZodvexHooks<R extends AnyRegistry>(registry: R): ZodvexHooks {
  function useZodQuery(ref: FunctionReference<'query', any, any, any>, ...args: any[]) {
    const wireResult = useQuery(ref, ...args as OptionalRestArgsOrSkip<any>)
    if (wireResult === undefined) return undefined
    const path = getFnPath(ref)
    const entry = registry[path]
    if (!entry?.returns) return wireResult
    return entry.returns.parse(wireResult)
  }

  function useZodMutation(ref: FunctionReference<'mutation', any, any, any>) {
    const rawMutate = useMutation(ref)
    const path = getFnPath(ref)
    const entry = registry[path]

    return async (args: any) => {
      const wireArgs = entry?.args ? z.encode(entry.args, args) : args
      const wireResult = await rawMutate(wireArgs)
      if (!entry?.returns) return wireResult
      return entry.returns.parse(wireResult)
    }
  }

  return { useZodQuery, useZodMutation } as any
}
```

Note: exact types will depend on Task 1 spike. The implementation above uses `_name` as placeholder — update with spike findings.

**Step 4: Run test to verify it passes**

```bash
bun test __tests__/react-hooks.test.ts
```

Expected: PASS.

**Step 5: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

**Step 6: Commit**

```
git add -A
git commit -m "feat(react): createZodvexHooks with auto-decode"
```

---

### Task 5: ZodvexClient (zodvex/client)

**Files:**
- Create: `src/client/zodvexClient.ts` (replace placeholder)
- Create: `__tests__/zodvex-client.test.ts`

**Depends on:** Task 1 spike results.

**Step 1: Write the test**

```typescript
import { describe, it, expect, mock } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/core/index'
import { createZodvexClient } from '../src/client/zodvexClient'

// Mock convex/browser
mock.module('convex/browser', () => ({
  ConvexClient: class MockConvexClient {
    constructor(_url: string) {}
    query(_ref: any, args: any) {
      return Promise.resolve({ name: 'Alice', createdAt: 1708700000000, _id: 'users:abc', _creationTime: 123 })
    }
    mutation(_ref: any, args: any) {
      return Promise.resolve('tasks:xyz')
    }
    onUpdate(_ref: any, _args: any, callback: any) {
      callback({ name: 'Alice', createdAt: 1708700000000, _id: 'users:abc', _creationTime: 123 })
      return () => {}
    }
    setAuth(_token: string) {}
    close() { return Promise.resolve() }
  }
}))

const registry = {
  'users:get': {
    args: z.object({ id: z.string() }),
    returns: z.object({ name: z.string(), createdAt: zx.date(), _id: z.string(), _creationTime: z.number() }),
  },
} as const

describe('ZodvexClient', () => {
  it('should decode query results', async () => {
    const client = createZodvexClient(registry, { url: 'https://test.convex.cloud' })
    const fakeRef = { _name: 'users:get' } as any
    const result = await client.query(fakeRef, { id: 'abc' })
    expect(result.createdAt).toBeInstanceOf(Date)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test __tests__/zodvex-client.test.ts
```

**Step 3: Implement ZodvexClient**

Replace the placeholder in `src/client/zodvexClient.ts`:

```typescript
import { ConvexClient } from 'convex/browser'
import type { FunctionReference } from 'convex/server'
import { z } from 'zod'

type AnyRegistry = Record<string, { args: z.ZodTypeAny; returns: z.ZodTypeAny | undefined }>

export type ZodvexClientOptions = {
  url: string
  token?: string | null
}

// Function path extraction — approach determined by Task 1 spike
function getFnPath(ref: FunctionReference<any, any, any, any>): string {
  return (ref as any)._name ?? (ref as any).__name
}

export class ZodvexClient<R extends AnyRegistry = AnyRegistry> {
  private inner: ConvexClient
  private registry: R

  constructor(registry: R, options: ZodvexClientOptions) {
    this.registry = registry
    this.inner = new ConvexClient(options.url)
    if (options.token) this.inner.setAuth(options.token)
  }

  async query(ref: FunctionReference<'query', any, any, any>, args?: any): Promise<any> {
    const path = getFnPath(ref)
    const entry = this.registry[path]
    const wireArgs = entry?.args && args ? z.encode(entry.args, args) : args
    const wireResult = await this.inner.query(ref, wireArgs)
    if (!entry?.returns) return wireResult
    return entry.returns.parse(wireResult)
  }

  async mutate(ref: FunctionReference<'mutation', any, any, any>, args?: any): Promise<any> {
    const path = getFnPath(ref)
    const entry = this.registry[path]
    const wireArgs = entry?.args && args ? z.encode(entry.args, args) : args
    const wireResult = await this.inner.mutation(ref, wireArgs)
    if (!entry?.returns) return wireResult
    return entry.returns.parse(wireResult)
  }

  subscribe(
    ref: FunctionReference<'query', any, any, any>,
    args: any,
    callback: (result: any) => void
  ): () => void {
    const path = getFnPath(ref)
    const entry = this.registry[path]
    const wireArgs = entry?.args && args ? z.encode(entry.args, args) : args

    return this.inner.onUpdate(ref, wireArgs, (wireResult: any) => {
      const decoded = entry?.returns ? entry.returns.parse(wireResult) : wireResult
      callback(decoded)
    })
  }

  setAuth(token: string | null) {
    this.inner.setAuth(token as string)
  }

  async close() {
    await this.inner.close()
  }
}

export function createZodvexClient<R extends AnyRegistry>(
  registry: R,
  options: ZodvexClientOptions
): ZodvexClient<R> {
  return new ZodvexClient(registry, options)
}
```

**Step 4: Run test to verify it passes**

```bash
bun test __tests__/zodvex-client.test.ts
```

**Step 5: Run full suite**

```bash
bun test
```

**Step 6: Commit**

```
git add -A
git commit -m "feat(client): ZodvexClient with auto-codec"
```

---

### Task 6: createZodvexActionCtx (zodvex/server)

**Files:**
- Create: `src/actionCtx.ts`
- Modify: `src/server/index.ts` — export new module
- Create: `__tests__/action-ctx.test.ts`

**Depends on:** Task 1 spike results.

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/core/index'
import { createZodvexActionCtx } from '../src/actionCtx'

const registry = {
  'users:get': {
    args: z.object({ id: z.string() }),
    returns: z.object({ name: z.string(), createdAt: zx.date(), _id: z.string(), _creationTime: z.number() }),
  },
} as const

describe('createZodvexActionCtx', () => {
  it('should decode runQuery results', async () => {
    const mockCtx = {
      runQuery: async (_ref: any, _args: any) => ({
        name: 'Alice', createdAt: 1708700000000, _id: 'users:abc', _creationTime: 123
      }),
      runMutation: async (_ref: any, _args: any) => 'ok',
      runAction: async (_ref: any, _args: any) => 'ok',
    }

    const wrapped = createZodvexActionCtx(registry, mockCtx as any)
    const fakeRef = { _name: 'users:get' } as any

    const result = await wrapped.runQuery(fakeRef, { id: 'abc' })
    expect(result.createdAt).toBeInstanceOf(Date)
  })

  it('should encode runQuery args', async () => {
    let capturedArgs: any
    const mockCtx = {
      runQuery: async (_ref: any, args: any) => {
        capturedArgs = args
        return { name: 'Alice', createdAt: 1708700000000, _id: 'users:abc', _creationTime: 123 }
      },
      runMutation: async () => 'ok',
      runAction: async () => 'ok',
    }

    const wrapped = createZodvexActionCtx(registry, mockCtx as any)
    const fakeRef = { _name: 'users:get' } as any
    await wrapped.runQuery(fakeRef, { id: 'abc' })

    // String args pass through unchanged (no codec on string)
    expect(capturedArgs).toEqual({ id: 'abc' })
  })

  it('should pass through when function not in registry', async () => {
    const mockCtx = {
      runQuery: async (_ref: any, _args: any) => ({ raw: true }),
      runMutation: async () => 'ok',
      runAction: async () => 'ok',
    }

    const wrapped = createZodvexActionCtx(registry, mockCtx as any)
    const unknownRef = { _name: 'unknown:fn' } as any

    const result = await wrapped.runQuery(unknownRef, {})
    expect(result).toEqual({ raw: true }) // No decode — pass through
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test __tests__/action-ctx.test.ts
```

**Step 3: Implement createZodvexActionCtx**

`src/actionCtx.ts`:

```typescript
import type { GenericActionCtx, GenericDataModel, FunctionReference } from 'convex/server'
import { z } from 'zod'
import { stripUndefined } from './utils'

type AnyRegistry = Record<string, { args: z.ZodTypeAny; returns: z.ZodTypeAny | undefined }>

// Function path extraction — approach determined by Task 1 spike
function getFnPath(ref: FunctionReference<any, any, any, any>): string {
  return (ref as any)._name ?? (ref as any).__name
}

/**
 * Wraps an action context's runQuery/runMutation with automatic
 * codec transforms via the zodvex registry.
 *
 * - Args are encoded (runtime → wire) before calling the inner function
 * - Results are decoded (wire → runtime) before returning to the handler
 * - Functions not in the registry pass through unchanged
 *
 * @internal Used by initZodvex when registry option is provided.
 */
export function createZodvexActionCtx<DM extends GenericDataModel>(
  registry: AnyRegistry,
  ctx: GenericActionCtx<DM>
): GenericActionCtx<DM> {
  return {
    ...ctx,
    runQuery: async (ref: any, args: any) => {
      const path = getFnPath(ref)
      const entry = registry[path]
      const wireArgs = entry?.args && args
        ? stripUndefined(z.encode(entry.args, args))
        : args
      const wireResult = await ctx.runQuery(ref, wireArgs)
      if (!entry?.returns) return wireResult
      return entry.returns.parse(wireResult)
    },
    runMutation: async (ref: any, args: any) => {
      const path = getFnPath(ref)
      const entry = registry[path]
      const wireArgs = entry?.args && args
        ? stripUndefined(z.encode(entry.args, args))
        : args
      const wireResult = await ctx.runMutation(ref, wireArgs)
      if (!entry?.returns) return wireResult
      return entry.returns.parse(wireResult)
    },
  } as GenericActionCtx<DM>
}
```

**Step 4: Export from server**

Add to `src/server/index.ts`:
```typescript
export { createZodvexActionCtx } from '../actionCtx'
```

**Step 5: Run tests**

```bash
bun test __tests__/action-ctx.test.ts && bun test
```

**Step 6: Commit**

```
git add -A
git commit -m "feat(server): createZodvexActionCtx for action auto-codec"
```

---

### Task 7: Integrate Registry into initZodvex

**Files:**
- Modify: `src/init.ts` — add registry option, wire up za/zia
- Modify: `__tests__/init.test.ts` — add registry tests

**Step 1: Write the test**

Add to the existing init test file:

```typescript
describe('initZodvex with registry', () => {
  it('should accept a lazy registry thunk', () => {
    const registry = { 'test:fn': { args: z.object({}), returns: z.string() } }
    const result = initZodvex(schema, server, { registry: () => registry })
    expect(result.za).toBeDefined()
  })
})
```

**Step 2: Update initZodvex**

Add `registry` to the options type. In the implementation, when `registry` is provided, create action codec customization using `createZodvexActionCtx`:

- Add `registry?: () => AnyRegistry` to the options parameter
- When registry is provided, create an action customization that wraps `ctx.runQuery`/`ctx.runMutation`
- Pass this customization to `za`/`zia` instead of `noOp`

The lazy thunk is called inside the customization's `input` function (at runtime, not construction time).

**Step 3: Update overload signatures**

Add `registry` to both overloads' options type.

**Step 4: Run tests**

```bash
bun test __tests__/init.test.ts && bun test
```

**Step 5: Commit**

```
git add -A
git commit -m "feat: initZodvex registry option for action auto-codec"
```

---

### Task 8: Codegen — Generate _zodvex/client.ts

**Files:**
- Modify: `src/codegen/generate.ts` — add `generateClientFile`
- Modify: `src/cli/commands.ts` — write client.ts
- Modify: `__tests__/codegen-cli.test.ts` — test client output

**Step 1: Write the test**

Add test for `generateClientFile`:

```typescript
it('should generate client file with pre-bound hooks and client factory', () => {
  const content = generateClientFile()
  expect(content).toContain("import { createZodvexHooks } from 'zodvex/react'")
  expect(content).toContain("import { createZodvexClient } from 'zodvex/client'")
  expect(content).toContain("import { zodvexRegistry } from './api'")
  expect(content).toContain('useZodQuery')
  expect(content).toContain('useZodMutation')
  expect(content).toContain('createClient')
})
```

**Step 2: Implement generateClientFile**

Add to `src/codegen/generate.ts`:

```typescript
/**
 * Generates the client.ts file content — pre-bound hooks and client factory.
 */
export function generateClientFile(): string {
  return `${HEADER}
import { createZodvexHooks } from 'zodvex/react'
import { createZodvexClient, type ZodvexClientOptions } from 'zodvex/client'
import { zodvexRegistry } from './api'

export const { useZodQuery, useZodMutation } = createZodvexHooks(zodvexRegistry)

export const createClient = (options: ZodvexClientOptions) =>
  createZodvexClient(zodvexRegistry, options)
`
}
```

**Step 3: Wire into CLI commands**

In `src/cli/commands.ts`, add client.ts output:

```typescript
import { generateSchemaFile, generateApiFile, generateClientFile } from '../codegen/generate'

// In generate():
const clientContent = generateClientFile()
fs.writeFileSync(path.join(zodvexDir, 'client.ts'), clientContent)
```

**Step 4: Run tests**

```bash
bun test
```

**Step 5: Commit**

```
git add -A
git commit -m "feat(codegen): generate _zodvex/client.ts with pre-bound hooks"
```

---

### Task 9: Codegen — Stub Generation in zodvex init

**Files:**
- Modify: `src/cli/init.ts` — generate api.ts stub

**Step 1: Read current init implementation**

Check `src/cli/init.ts` to understand the existing init flow.

**Step 2: Add stub generation**

After the existing init steps, create `_zodvex/api.ts` stub:

```typescript
// In the init flow:
const zodvexDir = path.join(convexDir, '_zodvex')
fs.mkdirSync(zodvexDir, { recursive: true })

const stubContent = `// Auto-generated stub. Run \`zodvex generate\` to populate.
export const zodvexRegistry = {} as const
`
fs.writeFileSync(path.join(zodvexDir, 'api.ts'), stubContent)
```

Also add `_zodvex/` to `.gitignore` if not already present (generated files shouldn't be committed).

**Step 3: Test manually**

```bash
bun run build && cd /tmp && mkdir test-init && cd test-init && mkdir convex && zodvex init
```

Verify `convex/_zodvex/api.ts` contains the stub.

**Step 4: Commit**

```
git add -A
git commit -m "feat(cli): zodvex init generates api.ts stub"
```

---

### Task 10: Update Example App

**Files:**
- Modify: `examples/task-manager/convex/functions.ts` — add registry thunk
- Regenerate: `examples/task-manager/convex/_zodvex/` — run codegen

**Step 1: Regenerate codegen output**

```bash
bun run build
cd examples/task-manager
npx zodvex generate
```

Verify three files exist in `convex/_zodvex/`: `schema.ts`, `api.ts`, `client.ts`.

**Step 2: Update functions.ts with registry**

```typescript
import { initZodvex } from 'zodvex/server'
import { query, mutation, action, internalQuery, internalMutation, internalAction } from './_generated/server'
import { zodvexRegistry } from './_zodvex/api'
import schema from './schema'

export const { zq, zm, za, ziq, zim, zia } = initZodvex(schema, {
  query, mutation, action,
  internalQuery, internalMutation, internalAction,
}, {
  registry: () => zodvexRegistry,
})
```

**Step 3: Type-check**

```bash
cd examples/task-manager && npx tsc --noEmit
```

Expected: 0 errors.

**Step 4: Commit**

```
git add -A
git commit -m "feat(example): integrate registry + generated client"
```

---

### Task 11: Integration Test

**Files:**
- Create or modify: `__tests__/codegen-e2e.test.ts` or `examples/task-manager/test/smoke.ts`

**Step 1: Verify end-to-end codegen output**

Add assertions that `zodvex generate` produces all three files with correct content:
- `_zodvex/schema.ts` — model re-exports
- `_zodvex/api.ts` — registry with correct function paths
- `_zodvex/client.ts` — imports from zodvex/react and zodvex/client, re-exports hooks

**Step 2: Verify example type-checks**

```bash
bun run build && cd examples/task-manager && npx tsc --noEmit
```

**Step 3: Run full test suite**

```bash
cd /path/to/zodvex && bun test
```

Expected: all tests pass.

**Step 4: Commit**

```
git add -A
git commit -m "test: integration tests for registry + client codegen"
```

---

## Task Dependency Graph

```
Task 1 (spike) ──┐
                  ├── Task 4 (react hooks)
Task 2 (rename) ──┤── Task 5 (vanilla client)
                  ├── Task 6 (action ctx)
Task 3 (config) ──┘        │
                            ├── Task 7 (initZodvex registry)
                            │
Task 8 (codegen client) ────┤
Task 9 (init stub) ────────┤
                            ├── Task 10 (example app)
                            └── Task 11 (integration test)
```

Tasks 1-3 can be done in parallel. Tasks 4-6 depend on Task 1 and can be done in parallel. Tasks 7-9 can follow once their dependencies are met. Tasks 10-11 are final integration.
