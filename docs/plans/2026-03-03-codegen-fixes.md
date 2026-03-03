# Codegen Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 3 codegen bugs (barrel dedup, double optional, duplicate exports) and improve codec variable naming.

**Architecture:** All fixes are in the codegen pipeline (`discover.ts`, `generate.ts`) and model construction (`model.ts`, `tables.ts`). TDD approach — each task writes a failing test first, then fixes the code.

**Tech Stack:** Zod v4, Bun test runner, TypeScript

---

### Task 1: Fix barrel file model deduplication in discovery (issues 1 & 3)

Fixes both "wrong import source" and "duplicate exports" — they share the same root cause: `discoverModules()` doesn't deduplicate models discovered from both direct files and barrel re-exports.

**Files:**
- Create: `packages/zodvex/__tests__/fixtures/codegen-project/models/index.ts`
- Modify: `packages/zodvex/src/codegen/discover.ts:257-263`
- Test: `packages/zodvex/__tests__/codegen-discover.test.ts`, `packages/zodvex/__tests__/codegen-e2e.test.ts`

**Step 1: Create barrel fixture**

Create a barrel file that re-exports both existing fixture models:

```typescript
// packages/zodvex/__tests__/fixtures/codegen-project/models/index.ts
export { UserModel } from './user'
export { EventModel } from './event'
```

**Step 2: Write failing tests**

In `codegen-discover.test.ts`, add inside the existing `describe('discoverModules')` block:

```typescript
it('deduplicates models re-exported from barrel files', async () => {
  const result = await discoverModules(fixtureDir)

  // Should still find exactly 2 models, not 4 (2 direct + 2 barrel)
  expect(result.models.length).toBe(2)

  // Each model should come from its direct file, not the barrel
  const userModel = result.models.find(m => m.exportName === 'UserModel')
  expect(userModel?.sourceFile).toBe('models/user.ts')

  const eventModel = result.models.find(m => m.exportName === 'EventModel')
  expect(eventModel?.sourceFile).toBe('models/event.ts')
})
```

In `codegen-e2e.test.ts`, add inside the existing `describe('codegen e2e')` block:

```typescript
it('schema.ts has no duplicate exports when barrel files exist', async () => {
  const result = await discoverModules(fixtureDir)
  const schemaContent = generateSchemaFile(result.models)

  // Count occurrences of each export
  const userExports = schemaContent.match(/export \{ UserModel \}/g)
  const eventExports = schemaContent.match(/export \{ EventModel \}/g)
  expect(userExports?.length).toBe(1)
  expect(eventExports?.length).toBe(1)

  // Should use direct module paths, not barrel
  expect(schemaContent).toContain("from '../models/user'")
  expect(schemaContent).toContain("from '../models/event'")
  expect(schemaContent).not.toContain("from '../models/index'")
})
```

**Step 3: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/codegen-discover.test.ts packages/zodvex/__tests__/codegen-e2e.test.ts`
Expected: The dedup test fails (finds 4 models instead of 2), the schema test fails (duplicate exports present).

**Step 4: Fix `discoverModules()` in discover.ts**

Replace the model push block at lines 257-263:

```typescript
// Before:
if (meta.type === 'model') {
  models.push({
    exportName,
    tableName: meta.tableName,
    sourceFile: file,
    schemas: meta.schemas
  })
}

// After:
if (meta.type === 'model') {
  const isBarrel = /(?:^|[\\/])index\.(ts|js)$/.test(file)
  const existing = models.findIndex(m => m.tableName === meta.tableName)
  if (existing >= 0) {
    // Replace barrel source with direct module source
    const existingIsBarrel = /(?:^|[\\/])index\.(ts|js)$/.test(models[existing].sourceFile)
    if (existingIsBarrel && !isBarrel) {
      models[existing] = {
        exportName,
        tableName: meta.tableName,
        sourceFile: file,
        schemas: meta.schemas
      }
    }
    // If existing is direct and new is barrel, skip
  } else {
    models.push({
      exportName,
      tableName: meta.tableName,
      sourceFile: file,
      schemas: meta.schemas
    })
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/codegen-discover.test.ts packages/zodvex/__tests__/codegen-e2e.test.ts`
Expected: All tests pass.

**Step 6: Run full test suite**

Run: `bun test`
Expected: All existing tests still pass. The e2e test at line 21 (`result.models.length === 2`) should still work since dedup produces the same count.

**Step 7: Commit**

```
fix(codegen): deduplicate models from barrel re-exports

Models re-exported from barrel files (index.ts) were appearing twice
in discovery results, causing duplicate schema.ts exports and
non-deterministic import paths in api.ts. Now deduplicates by
tableName, preferring the direct module file.
```

---

### Task 2: Fix double `.optional()` on update schemas

**Files:**
- Modify: `packages/zodvex/src/model.ts:225,311,325`
- Modify: `packages/zodvex/src/tables.ts:544,606,622`
- Test: `packages/zodvex/__tests__/defineZodModel.test.ts`

**Step 1: Write failing test**

In `defineZodModel.test.ts`, add inside the existing `describe('defineZodModel')` block, after the `schema.update requires _id` test:

```typescript
it('schema.update does not double-wrap already-optional fields', () => {
  const model = defineZodModel('users', {
    name: z.string(),
    email: z.string().optional(),  // already optional
    age: z.number()
  })

  // Get the update schema's shape
  const updateShape = (model.schema.update as z.ZodObject<any>).shape

  // email was already optional — should be ZodOptional, not ZodOptional<ZodOptional>
  const emailField = updateShape.email
  expect(emailField).toBeInstanceOf(z.ZodOptional)

  // The inner type should be ZodString, not another ZodOptional
  const inner = (emailField as any)._zod.def.innerType
  expect(inner).toBeInstanceOf(z.ZodString)
  expect(inner).not.toBeInstanceOf(z.ZodOptional)
})
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/zodvex/__tests__/defineZodModel.test.ts -t "double-wrap"`
Expected: FAIL — inner type is `ZodOptional` (double-wrapped).

**Step 3: Fix model.ts — add helper and apply at all 3 sites**

At the top of the `defineZodModel` implementation function (around line 204), add a local helper:

```typescript
/** Wrap in .optional() only if not already optional. */
function ensureOptional(schema: z.ZodTypeAny): z.ZodOptional<any> {
  return schema instanceof z.ZodOptional ? (schema as z.ZodOptional<any>) : schema.optional()
}
```

Then replace 3 sites:

Line 225:
```typescript
// Before:
partialShape[key] = (value as z.ZodTypeAny).optional()
// After:
partialShape[key] = ensureOptional(value as z.ZodTypeAny)
```

Line 311:
```typescript
// Before:
partialShape[key] = (value as z.ZodTypeAny).optional()
// After:
partialShape[key] = ensureOptional(value as z.ZodTypeAny)
```

Line 325:
```typescript
// Before:
partialShape[key] = (value as z.ZodTypeAny).optional()
// After:
partialShape[key] = ensureOptional(value as z.ZodTypeAny)
```

**Step 4: Fix tables.ts — same pattern at 3 sites**

Add the same `ensureOptional` helper at the top of the `zodTable` function scope (or duplicate inline — it's one line). Apply at:

Line 544:
```typescript
partialShape[key] = ensureOptional(value as z.ZodTypeAny)
```

Line 606:
```typescript
partialShape[key] = ensureOptional(value as z.ZodTypeAny)
```

Line 622:
```typescript
partialShape[key] = ensureOptional(value as z.ZodTypeAny)
```

**Step 5: Run test to verify it passes**

Run: `bun test packages/zodvex/__tests__/defineZodModel.test.ts`
Expected: All tests pass including the new one.

**Step 6: Run full test suite**

Run: `bun test`
Expected: All tests pass.

**Step 7: Commit**

```
fix(model): prevent double .optional() wrapping on update schemas

Fields already marked .optional() in the model definition were getting
wrapped again when building the update schema, producing
`.optional().optional()`. Now checks instanceof ZodOptional before
wrapping.
```

---

### Task 3: Descriptive model-embedded codec variable names

**Files:**
- Modify: `packages/zodvex/src/codegen/generate.ts:125-141`
- Test: `packages/zodvex/__tests__/codegen-generate.test.ts`

**Step 1: Write failing test**

In `codegen-generate.test.ts`, add inside the existing `describe('model-embedded codec resolution')` block:

```typescript
it('uses descriptive variable names derived from model and field path', () => {
  const partialArgs = (codecModel.schemas.doc as z.ZodObject<any>).partial()
  const funcs: DiscoveredFunction[] = [
    {
      functionPath: 'users:update',
      exportName: 'update',
      sourceFile: 'users.ts',
      zodArgs: partialArgs,
      zodReturns: undefined
    }
  ]
  const output = generateApiFile(funcs, [codecModel], [], modelCodecs)

  // Should use descriptive name, not _mc0
  expect(output).toContain('_userEmail')
  expect(output).not.toMatch(/_mc\d/)
})

it('derives names from nested access paths', () => {
  const nestedCodec = zx.codec(
    z.object({ value: z.string() }),
    z.object({ value: z.string(), display: z.string() }),
    {
      decode: (w: any) => ({ ...w, display: w.value }),
      encode: (r: any) => ({ value: r.value })
    }
  )
  const nestedModel: DiscoveredModel = {
    exportName: 'ActivityModel',
    tableName: 'activities',
    sourceFile: 'models/activity.ts',
    schemas: {
      doc: z.object({
        _id: z.string(),
        payload: z.union([
          z.object({ type: z.literal('a'), email: nestedCodec }),
          z.object({ type: z.literal('b') })
        ])
      }),
      insert: z.object({}),
      update: z.object({}),
      docArray: z.array(z.object({})),
      paginatedDoc: z.object({ page: z.array(z.object({})), isDone: z.boolean(), continueCursor: z.string().nullable().optional() })
    }
  }
  const nestedModelCodecs: ModelEmbeddedCodec[] = [
    {
      codec: nestedCodec,
      modelExportName: 'ActivityModel',
      modelSourceFile: 'models/activity.ts',
      schemaKey: 'doc',
      accessPath: '.shape.payload._zod.def.options[0].shape.email'
    }
  ]
  const funcs: DiscoveredFunction[] = [
    {
      functionPath: 'activities:update',
      exportName: 'update',
      sourceFile: 'activities.ts',
      zodArgs: z.object({ email: nestedCodec }),
      zodReturns: undefined
    }
  ]
  const output = generateApiFile(funcs, [nestedModel], [], nestedModelCodecs)

  // Should derive from model name + field path segments
  expect(output).toContain('_activityPayloadEmail')
  expect(output).not.toMatch(/_mc\d/)
})

it('handles models without Model suffix', () => {
  const codec = zx.codec(z.string(), z.string(), {
    decode: (w: string) => w.toUpperCase(),
    encode: (r: string) => r.toLowerCase()
  })
  const model: DiscoveredModel = {
    exportName: 'patients',
    tableName: 'patients',
    sourceFile: 'models/patients.ts',
    schemas: {
      doc: z.object({ _id: z.string(), firstName: codec }),
      insert: z.object({ firstName: codec }),
      update: z.object({ firstName: codec.optional() }),
      docArray: z.array(z.object({ _id: z.string(), firstName: codec })),
      paginatedDoc: z.object({ page: z.array(z.object({})), isDone: z.boolean(), continueCursor: z.string().nullable().optional() })
    }
  }
  const mCodecs: ModelEmbeddedCodec[] = [
    {
      codec,
      modelExportName: 'patients',
      modelSourceFile: 'models/patients.ts',
      schemaKey: 'doc',
      accessPath: '.shape.firstName'
    }
  ]
  const funcs: DiscoveredFunction[] = [
    {
      functionPath: 'patients:update',
      exportName: 'update',
      sourceFile: 'patients.ts',
      zodArgs: z.object({ firstName: codec.optional() }),
      zodReturns: undefined
    }
  ]
  const output = generateApiFile(funcs, [model], [], mCodecs)

  expect(output).toContain('_patientsFirstName')
  expect(output).not.toMatch(/_mc\d/)
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/codegen-generate.test.ts -t "descriptive variable"`
Expected: FAIL — output contains `_mc0` instead of descriptive names.

**Step 3: Implement `deriveCodecVarName` and use it in `generateApiFile`**

In `generate.ts`, add the helper function (before `generateApiFile`):

```typescript
/**
 * Derives a descriptive variable name for a model-embedded codec from
 * the model export name and the access path.
 *
 * Examples:
 *   ('UserModel', '.shape.email')                                    → '_userEmail'
 *   ('ActivityModel', '.shape.payload._zod.def.options[0].shape.email') → '_activityPayloadEmail'
 *   ('patients', '.shape.firstName')                                  → '_patientsFirstName'
 */
function deriveCodecVarName(modelExportName: string, accessPath: string): string {
  const base = modelExportName.replace(/Model$/, '')
  const prefix = base[0].toLowerCase() + base.slice(1)

  const fields = [...accessPath.matchAll(/\.shape\.(\w+)/g)].map(m => m[1])
  if (fields.length === 0) return `_${prefix}Codec`

  const fieldPart = fields
    .map((f, i) => (i === 0 ? f : f[0].toUpperCase() + f.slice(1)))
    .join('')

  return `_${prefix}${fieldPart[0].toUpperCase() + fieldPart.slice(1)}`
}
```

Then replace the naming logic in `generateApiFile` at lines 128-141. Change:

```typescript
// Before:
let mcIndex = 0
for (const mc of modelCodecs) {
  if (codecMap.has(mc.codec)) continue

  const varName = `_mc${mcIndex++}`
```

To:

```typescript
// After:
for (const mc of modelCodecs) {
  if (codecMap.has(mc.codec)) continue

  const varName = deriveCodecVarName(mc.modelExportName, mc.accessPath)
```

Remove the `let mcIndex = 0` line entirely.

**Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/codegen-generate.test.ts`
Expected: All tests pass including the new naming tests.

**Step 5: Update e2e test expectations**

The e2e test at `codegen-e2e.test.ts:179` checks `expect(apiContent).toContain('extractCodec')` which should still work. But verify manually that the generated fixture output now uses descriptive names.

**Step 6: Update existing tests that assert `_mc` patterns**

The existing test at `codegen-generate.test.ts:321-340` ("resolves model-embedded codec in .partial() args") doesn't assert the variable name directly — it checks for `extractCodec(UserModel.schema.doc.shape.email)` which is the expression, not the var name. Should still pass.

**Step 7: Run full test suite**

Run: `bun test`
Expected: All tests pass.

**Step 8: Commit**

```
feat(codegen): derive descriptive names for model-embedded codec vars

Generated codec variables now use names derived from the model export
name and field access path instead of opaque sequential names.
E.g., _mc0 → _userEmail, _mc1 → _activityPayloadEmail.
```

---

### Task 4: Regenerate example output and final verification

**Files:**
- Modify: `examples/task-manager/convex/_zodvex/api.ts` (regenerated)

**Step 1: Run full test suite one final time**

Run: `bun test`
Expected: All tests pass.

**Step 2: Regenerate example project**

Run: `cd examples/task-manager && bun run zodvex generate`

Verify the output at `examples/task-manager/convex/_zodvex/api.ts`:
- No `_mc0`/`_mc1`/`_mc2` — replaced with descriptive names
- No `.optional().optional()` double-wrapping
- No duplicate exports in schema.ts
- No barrel imports in schema.ts or api.ts

**Step 3: Run lint**

Run: `bun run lint`
Expected: No new lint issues.

**Step 4: Commit**

```
chore: regenerate example project with codegen fixes
```
