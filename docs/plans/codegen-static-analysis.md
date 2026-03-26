# Migrate codegen discovery from dynamic import to static analysis

## Status: RFC — Ready for Review

## Context

`discoverModules()` uses dynamic `import()` to load every file in the convex directory and read attached zodvex metadata. This requires executing all module-scope code, which fails when files import Convex runtime-only APIs (components, crons, etc.).

## The cost of dynamic import

The original decision was that dynamic import is simpler than AST parsing. But making it work has required accumulating significant workaround infrastructure:

- **Deep Proxy stubs** for `_generated/api.ts` — absorbs `components.*` access and constructor calls during discovery
- **ESM resolve/load hooks** — intercepts `_generated/api` imports at the module loader level
- **`writeGeneratedStubs()` + cleanup** — writes stub files to disk, wrapped in try/finally
- **Ignore lists** — `crons.ts`, `convex.config.ts`, test files excluded because they can't be imported outside the Convex runtime
- **Lazy `import('./rules')`** — dynamic import in db.ts to survive esbuild tree-shaking of circular dependencies

Each workaround was a response to a real bug discovered in production (hotpot beta.51→53 cycle). The Proxy approach is inherently fragile — it breaks under type coercion (`Number(proxy)`), iteration (`[...proxy]`), and JSON serialization. Any new component constructor that does more than store a reference will break discovery.

## Key insight: the output is source code, not live objects

The generated `_zodvex/api.js` contains **source expressions**, not serialized runtime objects:

```js
import { TaskModel } from '../models/task.js'
import { zDuration } from '../codecs.js'

export const zodvexRegistry = {
  'tasks:create': {
    args: z.object({ title: z.string(), status: z.enum(["todo", "in_progress", "done"]) }),
    returns: zx.id("tasks"),
  },
  'comments:list': {
    args: z.object({ taskId: zx.id("tasks") }),
    returns: CommentModel.schema.docArray,
  },
}
```

Live Zod objects are created when the consumer **imports** `api.js` — not when codegen generates it. This means codegen doesn't need live objects at all. It needs to:

1. Identify which exports are zodvex-wrapped functions
2. Extract the `args`/`returns` schema expressions as source text
3. Identify model definitions and their source files
4. Generate import statements and registry entries

All of this can be done by reading source code, not executing it.

## What static analysis needs to extract

### Functions
For each file, find exports that call zodvex builders and extract their schema arguments:

```ts
// Source
export const create = zm({
  args: { title: z.string(), ownerId: zx.id('users') },
  handler: async (ctx, args) => { ... },
  returns: zx.id('tasks'),
})

// Extract → registry entry
'tasks:create': {
  args: z.object({ title: z.string(), ownerId: zx.id("users") }),
  returns: zx.id("tasks"),
}
```

The AST walker needs to recognize zodvex builder calls: `zq`, `zm`, `za`, `ziq`, `zim`, `zia`, plus custom builders created via `zCustomQuery`/`zCustomMutation`/`zCustomAction`. Custom builders are the hardest case — they're user-defined, so the walker needs to trace from `initZodvex()` destructuring to the call sites.

### Models
Find `defineZodModel()` or `zodTable()` calls and extract the table name + source file:

```ts
export const TaskModel = defineZodModel('tasks', taskSchema)
// Extract → import + model reference for registry entries that use TaskModel.schema.*
```

### Codecs
Find exported `zx.codec()` instances and `extractCodec()` paths:

```ts
export const zDuration = zx.codec(z.number(), { ... })
// Extract → import for registry entries that reference zDuration
```

### Schema references
When `args` or `returns` reference a variable rather than inline schema, trace the import:

```ts
import { TaskModel } from './models/task'
export const get = zq({
  args: { id: zx.id('tasks') },
  returns: TaskModel.schema.doc.nullable(),
})
// Extract → generate import for TaskModel, emit returns as source text
```

## What can be eliminated

With static analysis, the following infrastructure becomes unnecessary:

- `discovery-hooks.ts` — Proxy stubs, ESM hooks, `writeGeneratedStubs()`
- Ignore lists in `discoverModules()` — static analysis doesn't execute code, so crons/config/test files are harmlessly skipped (no zodvex exports found)
- The `attachMeta()` / `readMeta()` runtime metadata system — codegen no longer needs to read metadata from live objects

The `attachMeta`/`readMeta` pattern would still be used at **runtime** (for internal plumbing), but codegen wouldn't depend on it.

## Challenges

- **Custom builder tracing** — `initZodvex()` returns builders, which consumers destructure and may alias. The AST walker needs to follow: `const { zq, zm } = initZodvex(...)` → `export const foo = zq({ ... })`. Consumer-defined builders (e.g., `hotpotPublicMutation`) add another layer of indirection.
- **Dynamic schema construction** — Schemas built with runtime logic (`z.object(someCondition ? a : b)`) can't be statically extracted. These should be rare and could fall back to a manual annotation.
- **Barrel files and re-exports** — `export { TaskModel } from './task'` needs import resolution to find the canonical source file.
- **Parser choice** — Need a TypeScript-aware AST parser (e.g., `@swc/core`, `ts-morph`, or TypeScript compiler API). Must handle JSX, decorators, and modern TS syntax.

## Recommendation

**Full static analysis** is the right direction. The dynamic import approach has proven fragile in practice, and the infrastructure to support it now exceeds the complexity of AST-based extraction.

Suggested approach:
1. Start with function discovery — parse exports, match builder calls, extract `args`/`returns` source text
2. Add model discovery — find `defineZodModel`/`zodTable` calls
3. Add codec discovery — find exported `zx.codec()` and `extractCodec()` paths
4. Handle custom builders by tracing `initZodvex()` destructuring
5. Remove dynamic import infrastructure once static analysis covers all cases

A fallback to dynamic import for edge cases (dynamic schemas, complex runtime construction) could be kept initially and removed once coverage is proven.

## Related
- `src/codegen/discover.ts` — current dynamic discovery implementation
- `src/codegen/discovery-hooks.ts` — Proxy stub mechanism (to be removed)
- `src/codegen/generate.ts` — registry generation using `zodToSource()`
