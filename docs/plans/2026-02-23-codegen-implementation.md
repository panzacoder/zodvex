# Codegen Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a standalone CLI (`zodvex generate` / `zodvex dev` / `zodvex init`) that generates `convex/_zodvex/schema.ts` and `convex/_zodvex/validators.ts` from `__zodvexMeta` metadata attached to builders and models.

**Architecture:** Builders and models attach `__zodvexMeta` as a non-enumerable property at definition time. The CLI imports convex/ modules via Bun runtime, collects metadata, then generates two files: model re-exports and a function-to-schema registry. A `zodToSource` serializer converts ad-hoc Zod schemas to source code; model schemas are referenced directly via imports.

**Tech Stack:** Bun (runtime + file watching), zod v4, TypeScript, tsup (build)

**Key code paths for `__zodvexMeta` attachment:**
- `src/custom.ts` `customFnBuilder()` — used by `initZodvex` and `zCustomQuery/Mutation/Action` (two return paths: with-args ~line 228, no-args ~line 279). Also covers `zCustomQueryBuilder`/`zCustomMutationBuilder`/`zCustomActionBuilder` since they delegate to `customFnBuilder`.
- `src/builders.ts` `zQueryBuilder/zMutationBuilder/zActionBuilder` — standalone direct builders, call through `src/wrappers.ts`
- `src/model.ts` `defineZodModel()` — the `createModel` inner function ~line 201

**Intentionally excluded from `__zodvexMeta`:**
- `zInternalQuery/Mutation/Action` (`src/wrappers.ts`) — internal functions are not exported in the client `api` object, so they are invisible to client-side codegen consumers. They call `zQuery`/`zMutation`/`zAction` directly with no intermediate attachment point.
- `zQuery/Mutation/Action` (`src/wrappers.ts`) — low-level wrappers. Metadata is attached at the builder layer above them, not inside them.

---

### Task 1: `__zodvexMeta` type and helpers

**Files:**
- Create: `src/meta.ts`
- Test: `__tests__/meta.test.ts`

**Step 1: Write the failing test**

Test `attachMeta` (non-enumerable property), `readMeta` (returns metadata or undefined for objects without it / non-objects).

Test cases:
- Attaches function metadata as non-enumerable property
- Attaches model metadata
- `readMeta` returns undefined for objects without metadata
- `readMeta` returns undefined for non-objects (null, number)

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/meta.test.ts`

**Step 3: Write minimal implementation**

Types:
- `ZodvexFunctionMeta = { type: 'function', zodArgs?: z.ZodTypeAny, zodReturns?: z.ZodTypeAny }`
- `ZodvexModelMeta = { type: 'model', tableName: string, schemas: { doc, insert, update, docArray } }`
- `ZodvexMeta = ZodvexFunctionMeta | ZodvexModelMeta`

Functions:
- `attachMeta(target, meta)` — `Object.defineProperty` with `enumerable: false, writable: false, configurable: false`
- `readMeta(target)` — null/type guard, reads `__zodvexMeta` property

**Step 4:** Run test, verify pass
**Step 5:** Commit: `feat: add __zodvexMeta type definitions and helpers`

---

### Task 2: Attach `__zodvexMeta` in customFnBuilder

Covers the `initZodvex` path, all `zCustomQuery/Mutation/Action` usage, and all `zCustomQueryBuilder/MutationBuilder/ActionBuilder` usage (they delegate to `customFnBuilder`).

**Files:**
- Modify: `src/custom.ts` — add `import { attachMeta } from './meta'`, modify both return paths in `customFnBuilder`
- Test: `__tests__/meta-builders.test.ts`

**Step 1: Write the failing test**

Using `zCustomQuery(mockQuery, ...)` with a mock `(fn) => fn` builder:
- `attachMeta` with args + returns: verify `readMeta(fn)` has type 'function', zodArgs is ZodObject, zodReturns present
- With args only (no returns): zodReturns is undefined
- Handler-only (no args, no returns): both undefined

**Step 2:** Run test, verify fail (readMeta returns undefined)

**Step 3: Modify `customFnBuilder`**

Both return paths (`return builder({...})`) become:
```ts
const result = builder({...})
attachMeta(result, { type: 'function', zodArgs: argsSchema, zodReturns: returns })
return result
```

With-args path: `zodArgs: argsSchema` (the ZodObject from the args parsing)
No-args path: `zodArgs: undefined, zodReturns: returns`

**Step 4:** Run test, verify pass
**Step 5:** Run full suite: `bun test`
**Step 6:** Commit: `feat: attach __zodvexMeta in customFnBuilder`

---

### Task 3: Attach `__zodvexMeta` in direct builders

Covers `zQueryBuilder`, `zMutationBuilder`, `zActionBuilder`.

**Files:**
- Modify: `src/builders.ts` — add `import { attachMeta } from './meta'`, modify all three builder closures
- Test: `__tests__/meta-builders.test.ts` (append)

**Step 1: Write the failing test**

Append to existing test file. Using `zQueryBuilder(mockBuilder)`:
- zQueryBuilder with args + returns
- zMutationBuilder with args only
- zActionBuilder with args + returns
- Args as `z.object()` (not raw shape)

**Step 2:** Run test, verify fail

**Step 3: Modify builders**

Each builder closure currently ends with `return zQuery(builder, ...) as any`. Change to:
```ts
const result = zQuery(builder, config.args ?? ({} as any), config.handler, { returns: config.returns })
const zodArgs = config.args
  ? config.args instanceof z.ZodObject ? config.args
    : config.args instanceof z.ZodType ? undefined
    : z.object(config.args as Record<string, z.ZodTypeAny>)
  : undefined
attachMeta(result, { type: 'function', zodArgs, zodReturns: config.returns })
return result as any
```

Same pattern for zMutationBuilder and zActionBuilder.

> **Note:** When `config.args` is a raw shape (not a ZodObject), the `z.object()` call creates a new instance distinct from the one `zQuery` creates internally. This means identity matching in Task 8 will NOT match raw-shape args against model schemas. This is acceptable — identity matching primarily targets `returns` (model schemas like `UserModel.schema.doc`), and ad-hoc args are serialized via `zodToSource` anyway.

**Step 4:** Run test, verify pass
**Step 5:** Run full suite: `bun test`
**Step 6:** Commit: `feat: attach __zodvexMeta in direct builders`

---

### Task 4: Attach `__zodvexMeta` in defineZodModel

**Files:**
- Modify: `src/model.ts` — add `import { attachMeta } from './meta'`, modify `createModel`
- Test: `__tests__/defineZodModel.test.ts` (append)

**Step 1: Write the failing test**

- Model has metadata with type 'model', correct tableName, all 4 schemas
- Metadata preserved through `.index()` chaining

**Step 2:** Run test, verify fail

**Step 3:** Add `attachMeta` call **inside** the `createModel` inner function, on the model object before returning it. This is critical — `createModel` is called recursively by `.index()`, `.searchIndex()`, and `.vectorIndex()`, so placing `attachMeta` inside `createModel` ensures every chained result carries metadata. Placing it outside (e.g., only on the `return createModel({}, {}, {})` at line 229) would lose metadata after the first `.index()` call.

```ts
function createModel(indexes, searchIndexes, vectorIndexes) {
  const model = { name, fields, schema, indexes, ... }
  attachMeta(model, { type: 'model', tableName: name, schemas: schema })
  return model
}
```

**Step 4:** Run test, verify pass
**Step 5:** Run full suite: `bun test`
**Step 6:** Commit: `feat: attach __zodvexMeta in defineZodModel`

---

### Task 5: Export meta.ts from core

**Files:**
- Modify: `src/core/index.ts` — add `export * from '../meta'`
- Modify: `__tests__/exports.test.ts` — add test for `attachMeta` and `readMeta` in core exports

**Step 1:** Write failing export test
**Step 2:** Add export
**Step 3:** Verify pass
**Step 4:** Commit: `feat: export meta utilities from zodvex/core`

---

### Task 6: `zodToSource` serializer

Converts runtime Zod schema objects back to source code strings for the generated `validators.ts`. Most complex piece — needs thorough testing.

**Files:**
- Create: `src/codegen/zodToSource.ts`
- Test: `__tests__/zodToSource.test.ts`

**Step 1: Write the failing tests**

Primitives: `z.string()`, `z.number()`, `z.boolean()`, `z.null()`, `z.undefined()`, `z.any()`
Objects: `z.object({ a: z.string(), b: z.number() })`
Arrays: `z.array(z.string())`
Modifiers: `.optional()`, `.nullable()`
zodvex extensions: `zx.id('users')` (detect via description `convexId:users`), `zx.date()` (detect via description or codec marker — check `src/zx.ts` at impl time)
Enums: `z.enum(['a', 'b'])`
Literals: `z.literal('hello')`, `z.literal(42)`, `z.literal(true)`
Unions: `z.union([z.string(), z.number()])`
Tuples: `z.tuple([z.string(), z.number()])`
Records: `z.record(z.string(), z.number())`
Nested: objects containing objects and arrays
Unsupported: `z.custom()` falls back to `z.any() /* unsupported: custom */`

> **Implementer note:** Verify Zod v4 internal accessors at implementation time. Check `node_modules/zod/lib/types.d.ts` and `src/zx.ts` for how to identify `zx.date()` schemas.

**Step 2:** Run test, verify fail
**Step 3:** Implement `zodToSource(schema: z.ZodTypeAny): string` with instanceof checks, peeling off wrappers (optional/nullable first), then matching primitives, objects, arrays, unions, etc.
**Step 4:** Run test, verify pass
**Step 5:** Commit: `feat: zodToSource serializer for codegen`

---

### Task 7: Discovery engine — collect metadata from modules

**Files:**
- Create: `src/codegen/discover.ts`
- Create: `__tests__/fixtures/codegen-project/models/user.ts` (model fixture)
- Create: `__tests__/fixtures/codegen-project/users.ts` (function fixture using `attachMeta` directly)
- Test: `__tests__/codegen-discover.test.ts`

**Step 1: Write fixture files and failing test**

Fixtures: minimal convex-like directory with a model file and a function file that have `__zodvexMeta` attached.

Test cases:
- Discovers models (correct exportName, tableName)
- Discovers functions (correct functionPath in `module:exportName` format)
- Skips `_generated/` and `_zodvex/` directories
- Records source file path for import generation

**Step 2:** Run test, verify fail

**Step 3: Implement**

Types: `DiscoveredModel`, `DiscoveredFunction`, `DiscoveryResult`

`discoverModules(convexDir)`:
1. Glob `**/*.{ts,js}` excluding `_generated/`, `_zodvex/`, `node_modules/`, `.d.ts`
2. `await import(absPath)` each file (try/catch, warn and skip on failure)
3. Iterate exports, call `readMeta(value)`
4. Build module name from file path (e.g., `users.ts` -> `users`)
5. Function path = `moduleName:exportName`

**Step 4:** Run test, verify pass
**Step 5:** Commit: `feat: module discovery engine for codegen`

---

### Task 8: Code generation engine — write files

**Files:**
- Create: `src/codegen/generate.ts`
- Test: `__tests__/codegen-generate.test.ts`

**Step 1: Write the failing test**

`generateSchemaFile(models)`:
- Generates `export { UserModel } from '../models/user'` re-exports
- Includes AUTO-GENERATED header

`generateValidatorsFile(functions, models)`:
- Generates registry with function path keys
- Uses `zodToSource` for ad-hoc schemas
- Uses model references (identity match) when function's returns schema === model's schema object
- Tracks and generates correct imports (zod, zx, models)

**Step 2:** Run test, verify fail

**Step 3: Implement**

`generateSchemaFile(models)`: Simple — header + export lines.

`generateValidatorsFile(functions, models)`:
1. Build identity map: `Map<zodSchemaObject, { importPath, exportName, schemaKey }>` from models' `.schema.doc/insert/update/docArray`
2. For each function: check if `zodArgs`/`zodReturns` identity-matches a model schema → emit `UserModel.schema.doc`; else → `zodToSource(schema)`
3. Track needed imports (zod, zx, model names)
4. Emit: header + imports + `export const zodvexRegistry = { ... } as const`

**Step 4:** Run test, verify pass
**Step 5:** Commit: `feat: code generation engine (schema + validators)`

---

### Task 9: CLI commands — `zodvex generate` and `zodvex dev`

**Files:**
- Create: `src/cli/index.ts` (entry point with shebang)
- Create: `src/cli/commands.ts` (generate + dev logic)
- Test: `__tests__/codegen-cli.test.ts`
- Modify: `package.json` — add `"bin": { "zodvex": "./dist/cli/index.js" }`
- Modify: `tsup.config.ts` — add `src/cli/index.ts` entry point

> **Note:** The design doc specifies `"bin": { "zodvex": "./dist/cli.js" }` (flat). This plan uses `./dist/cli/index.js` (nested directory) for cleaner separation. Update the design doc to match.

**Step 1: Write smoke test**

Test `generate()` function (imported directly, not via CLI binary):
- Given the fixture project from Task 7, `generate(fixtureDir)` creates `_zodvex/schema.ts` and `_zodvex/validators.ts` in a temp output dir
- Missing convex dir → throws descriptive error
- Cleanup: `afterEach` removes temp dir

**Step 2: Implement CLI**

`src/cli/index.ts`: Shebang + command dispatch (generate/dev/init/help).

`src/cli/commands.ts`:
- `generate(convexDir?)`: resolve convex dir, call `discoverModules`, call `generateSchemaFile`/`generateValidatorsFile`, mkdir `_zodvex/`, write files
- `dev(convexDir?)`: run `generate()` once, then `fs.watch(convexDir, { recursive: true })` filtering `_zodvex/`, `_generated/`, non-TS files. On change, re-run `generate()`.

**Step 3: Update build config**

Add to tsup entry: `'src/cli/index.ts'`
Add to package.json: `"bin": { "zodvex": "./dist/cli/index.js" }`

**Step 4:** Run test, verify pass
**Step 5:** Build: `bun run build` — verify `dist/cli/index.js` exists
**Step 6:** Commit: `feat: zodvex CLI (generate + dev commands)`

---

### Task 10: CLI — `zodvex init`

**Files:**
- Create: `src/cli/init.ts`
- Test: `__tests__/codegen-init.test.ts`

**Step 1: Write failing test**

Test pure functions (no side effects):

`rewriteDevScript`:
- `rewriteDevScript('bunx convex dev')` → `'concurrently "zodvex dev" "bunx convex dev"'`
- `rewriteDevScript('npx convex dev')` → wraps correctly
- `rewriteDevScript('tsc --noEmit')` → `null` (no convex dev found)
- `rewriteDevScript('concurrently "zodvex dev" ...')` → `null` (already wrapped)

`rewriteDeployScript`:
- `rewriteDeployScript('bunx convex deploy')` → `'zodvex generate && bunx convex deploy'`
- `rewriteDeployScript('npx convex deploy')` → wraps correctly
- `rewriteDeployScript('tsc && bunx convex deploy')` → `'tsc && zodvex generate && bunx convex deploy'` (prefix before `convex deploy`)
- `rewriteDeployScript('zodvex generate && bunx convex deploy')` → `null` (already wrapped)
- `rewriteDeployScript('npm run build')` → `null` (no convex deploy found)

`ensureConcurrently`:
- `ensureConcurrently({ devDependencies: {} })` → `'add'`
- `ensureConcurrently({ devDependencies: { concurrently: '^9.0.0' } })` → `'exists'`

`gitignoreEntry`:
- `gitignoreEntry('')` → contains `convex/_zodvex/`
- `gitignoreEntry('node_modules\n.env')` → appends `convex/_zodvex/` on new line
- `gitignoreEntry('convex/_zodvex/')` → `null` (already present)
- `gitignoreEntry('convex/_zodvex/\nnode_modules')` → `null` (already present)

**Step 2:** Run test, verify fail

**Step 3: Implement**

`rewriteDevScript(script)`: regex match `convex dev`, return wrapped or null.
`rewriteDeployScript(script)`: regex match `convex deploy`, prefix with `zodvex generate &&`, return wrapped or null.
`ensureConcurrently(pkg)`: check deps and devDeps.
`gitignoreEntry(content)`: check if `convex/_zodvex/` already present, return updated content or null.
`init()`: read package.json, call helpers for dev + deploy scripts, use `Bun.spawnSync` (not `exec`) for installing concurrently, write updated package.json, read .gitignore and update via `gitignoreEntry`.

> **Security note:** Use `Bun.spawnSync` or `execFileSync` (array args), NOT `exec` with string interpolation.

**Step 4:** Run test, verify pass
**Step 5:** Commit: `feat: zodvex init command`

---

### Task 11: Build config and codegen barrel export

**Files:**
- Create: `src/codegen/index.ts` (barrel export)
- Modify: `package.json` — add `"./codegen"` export path
- Modify: `tsup.config.ts` — add `src/codegen/index.ts` entry

**Step 1:** Create barrel export: `src/codegen/index.ts` re-exports from `discover`, `generate`, `zodToSource`
**Step 2:** Add package.json exports entry for `./codegen`
**Step 3:** Verify build: `bun run build`
**Step 4:** Run full suite: `bun test`
**Step 5:** Commit: `feat: build config for codegen and CLI entry points`

---

### Task 12: Integration test — end-to-end codegen

**Files:**
- Test: `__tests__/codegen-e2e.test.ts`

**Step 1:** Write integration test

Uses fixture project from Task 7. Full pipeline: `discoverModules` -> `generateSchemaFile` + `generateValidatorsFile` -> write to temp `_zodvex/` dir -> verify file contents:
- `schema.ts` contains UserModel re-export
- `validators.ts` contains zodvexRegistry with correct function paths
- `validators.ts` uses `UserModel.schema.doc` for model-returning functions (not serialized)
- `validators.ts` uses `z.object(...)` for ad-hoc schemas

Cleanup: `afterEach` removes `_zodvex/` temp dir.

**Step 2:** Run test, verify pass
**Step 3:** Commit: `test: end-to-end codegen integration test`

---

### Resolved Design Gaps

Issues identified during plan review, addressed in the tasks above:

1. **Deploy/build script rewriting** — Task 10 now includes `rewriteDeployScript` with tests (was missing, specified in design doc).
2. **`.gitignore` update testing** — Task 10 now includes `gitignoreEntry` pure function with tests (was untested).
3. **Internal builder exclusion** — Documented above: `zInternalQuery/Mutation/Action` intentionally excluded from `__zodvexMeta` (not client-visible).
4. **`bin` path** — Plan uses `./dist/cli/index.js` (nested); design doc says `./dist/cli.js` (flat). Design doc should be updated.
5. **Task 4 `attachMeta` placement** — Explicitly placed inside `createModel()` to survive `.index()` chaining.
6. **Task 3 raw-shape identity** — Documented that `z.object(rawShape)` creates a new instance; identity matching in Task 8 targets `returns` (model schemas), not ad-hoc args.
7. **Task 7 `.js` files** — Glob now includes `**/*.{ts,js}` per design doc.
8. **Task 9 test coverage** — Added smoke test for `generate()` function.

---

### Spikes Required After Initial Implementation

These are known gaps that need investigation but cannot be fully designed upfront. Each should be a focused spike (timeboxed exploration → decision → follow-up task).

#### Spike 1: Function Path Format Verification

**Question:** Do the registry keys (`module:exportName`) match what Convex's client-side function references actually resolve to?

The design doc's React hook sketch uses `getFunctionName(fnRef)` reading `Symbol.for("functionName")` to look up registry entries. The registry uses `module:exportName` format (e.g., `users:get`). If Convex's internal format differs (e.g., `users/get`, `users.get`), the lookup will fail silently.

**Spike:** Import a real Convex `api` object, inspect `Symbol.for("functionName")` on a function reference, confirm the exact string format. Adjust registry key format if needed.

**When:** After Task 8 (generation), before Task 12 (e2e test).

#### Spike 2: `zodToSource` Coverage for Codec Schemas

**Question:** How should `zodToSource` handle `z.pipe()`, `z.lazy()`, `z.intersection()`, and discriminated unions?

Task 6 covers the common cases (primitives, objects, arrays, unions, enums, literals, tuples, records, modifiers). But zodvex's codec pipeline uses `z.pipe()` (via `zx.codec()`), and recursive schemas use `z.lazy()`. These may appear in ad-hoc function args/returns.

**Current plan:** Unsupported types fall back to `z.any() /* unsupported: <type> */` with a console warning during generation. This is safe but lossy.

**Spike:** After implementing Task 6's core set, audit real-world zodvex usage (hotpot) to see which additional types actually appear in function args/returns. Prioritize only the types that show up in practice. `z.pipe()` is likely needed since `zx.codec()` schemas use it; `z.lazy()` and `z.intersection()` may not appear in function boundaries.

**When:** After Task 6, informed by Task 12 (e2e test with realistic fixtures).

#### Spike 3: `.d.ts` Type Generation for Registry

**Question:** Should `validators.ts` emit a companion `.d.ts` file for enhanced type inference in `useZodQuery` and friends?

The design doc's open question 4 asks this. Two options:
- **Infer from runtime object** — `zodvexRegistry` is `as const`, so TypeScript can infer types from the object literal. Simpler, but inference depth may hit limits with complex schemas.
- **Generate `.d.ts`** — explicit types for each registry entry. More robust type inference but doubles the generated output and adds complexity.

**Spike:** Implement `zodvex/react` hooks (future task) against the runtime `as const` registry. If TypeScript inference breaks or is too slow, add `.d.ts` generation.

**When:** During `zodvex/react` implementation (separate plan).

---

### Future Tasks (separate plan)

Out of scope for this plan, documented for follow-up:

- **`zodvex/react` hooks** — `useZodQuery`, `useZodMutation`, `useZodAction` wrapper hooks that auto-decode using the generated registry. Needs React peer dep, type inference from registry, separate design. The `package.json` `exports` field will need a `./react` entry.
- **Watch mode debouncing** — `fs.watch` is naive; production needs debounce (200-300ms).
- **Module import caching** — avoid re-importing unchanged modules in watch mode.
- **Error resilience** — graceful handling of import failures, circular deps, partial generation.
- **Documentation** — quick start guide, architecture docs, troubleshooting, migration guide.
- **`attachMeta` export visibility** — Consider whether `attachMeta` should remain a public export or be internal-only (`readMeta` is the primary consumer-facing API for the CLI; `attachMeta` is only called from builders).
