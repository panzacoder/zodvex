# Migrate codegen discovery from dynamic import to static analysis

## Status: Deferred, not being pursued; preserved for the analysis (PR #51 closed 2026-09-28, see #153)

The RFC below was written for [#51](https://github.com/panzacoder/zodvex/pull/51). It is kept
because the cost analysis and the extraction inventory are still accurate. The direction
that replaced it is **reference-by-import for client-visible schemas**
(`docs/issues/2026-06-08-validator-handler-decoupling.md`, tracked with the rest of the
schema-driven UI work in [#153](https://github.com/panzacoder/zodvex/issues/153)). That
direction preserves schema fidelity and avoids inferring codec identity for decoupled
functions. It does not reduce discovery execution: `discoverModules()` still dynamically
imports every eligible file and reads function metadata from live exports, executing handler
modules and their dependencies even when schemas live in separate client-safe modules.
Reducing that execution surface would require a separate discovery change.

## Context

`discoverModules()` uses dynamic `import()` to load every file in the convex directory and read attached zodvex metadata. This requires executing all module-scope code, which fails when files import Convex runtime-only APIs (components, crons, etc.).

## The cost of dynamic import

The original decision was that dynamic import is simpler than AST parsing. But making it work has required accumulating significant workaround infrastructure:

- **Deep Proxy stubs** for `_generated/api.ts` — absorbs `components.*` access and constructor calls during discovery
- **ESM resolve/load hooks** — intercepts `_generated/api` imports at the module loader level
- **`writeGeneratedStubs()` + cleanup** — writes stub files to disk, wrapped in try/finally
- **Ignore lists** — `crons.ts`, `convex.config.ts`, test files excluded because they can't be imported outside the Convex runtime

Each workaround was a response to a real bug discovered in production (hotpot beta.51→53 cycle). The Proxy approach is inherently fragile — it breaks under type coercion (`Number(proxy)`), iteration (`[...proxy]`), and JSON serialization. Any new component constructor that does more than store a reference will break discovery.

(The RFC originally also listed the lazy `import('./rules')` in db.ts as a discovery workaround. That was replaced by a synchronous installer in 0.7.1, [#59](https://github.com/panzacoder/zodvex/pull/59), and is no longer part of the cost.)

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

## Runtime constraint: codec identity is resolved from live objects

Since this RFC was written, codegen's codec resolution moved to **provenance brands**
(`docs/decisions/2026-06-08-codec-provenance-brands.md`): a codec instance found in a
function's `args`/`returns` is matched to an importable export by the brand the factory
attached at creation, with a structural fingerprint as the fallback. Both are read from the
live object. A static design has to either reproduce that matching from source (tracing
`sensitive(inner)`-style factory calls back to an exported twin) or make it unnecessary by
requiring every client-visible codec to be an importable export — which is the
reference-by-import direction, and the reason static analysis is no longer the plan.

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
- **Codec identity** — see the runtime constraint above; brand/fingerprint matching has no source-level equivalent without a full factory-call trace.
- **Barrel files and re-exports** — `export { TaskModel } from './task'` needs import resolution to find the canonical source file.
- **Parser choice** — Need a TypeScript-aware AST parser (e.g., `@swc/core`, `ts-morph`, or TypeScript compiler API). Must handle JSX, decorators, and modern TS syntax.

## Options

### Full static analysis (the RFC's recommendation)

The dynamic import approach has proven fragile in practice, and the infrastructure to support it now exceeds the complexity of AST-based extraction.

Suggested approach:
1. Start with function discovery — parse exports, match builder calls, extract `args`/`returns` source text
2. Add model discovery — find `defineZodModel`/`zodTable` calls
3. Add codec discovery — find exported `zx.codec()` and `extractCodec()` paths
4. Handle custom builders by tracing `initZodvex()` destructuring
5. Remove dynamic import infrastructure once static analysis covers all cases

A fallback to dynamic import for edge cases (dynamic schemas, complex runtime construction) could be kept initially and removed once coverage is proven.

### Hybrid: static to find candidates, dynamic import only those

The pre-RFC note proposed a smaller step that the RFC's rewrite dropped:

- Use static analysis only to identify which files have zodvex exports (cheap, no execution)
- Dynamically import only those files, with targeted stubs for known problem modules
- Fall back to full dynamic import for files that static analysis can't resolve

This keeps live-object codec resolution intact (so the runtime constraint above is a
non-issue) while narrowing the files directly imported by discovery. Their transitive
dependencies still execute. Reference-by-import addresses schema fidelity and codec
identity separately; it does not provide this candidate filtering.

## Related
- `docs/plans/2026-02-25-codegen-runtime-vs-ast.md` — earlier analysis of runtime vs AST approaches. Pruned from `main`; readable with `git show cd567cf:docs/plans/2026-02-25-codegen-runtime-vs-ast.md`.
- `docs/issues/2026-06-08-validator-handler-decoupling.md` — the reference-by-import direction that superseded this RFC
- `docs/decisions/2026-06-08-codec-provenance-brands.md` — how codec identity is resolved today
- `packages/zodvex/src/public/codegen/discover.ts` — current dynamic discovery implementation
- `packages/zodvex/src/public/codegen/discovery-hooks.ts` — Proxy stub mechanism
- `packages/zodvex/src/public/codegen/generate.ts` — registry generation using `zodToSource()`
