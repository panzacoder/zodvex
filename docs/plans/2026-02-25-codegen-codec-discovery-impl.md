# Codegen Codec Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make codegen discover codecs embedded in model schemas so that derived schemas (`.partial()`, `.extend()`, etc.) preserve codec transforms in the generated registry.

**Architecture:** Walk model schema shapes to extract `ZodCodec` instances, add them to the `codecMap` via generated `extractCodec()` helper vars. `zodToSource`'s existing wrapper-peeling + identity lookup handles the rest. Orphaned inline codecs get actionable warnings instead of silent degradation.

**Tech Stack:** Zod v4, Bun test runner, tsup build

**Design doc:** `docs/plans/2026-02-25-codegen-codec-discovery-design.md`

---

### Task 1: Add `extractCodec` utility

**Files:**
- Create: `packages/zodvex/src/codegen/extractCodec.ts`
- Test: `packages/zodvex/__tests__/codegen-extractCodec.test.ts`
- Modify: `packages/zodvex/src/codegen/index.ts` (add export)

**Step 1: Write the failing tests**

```ts
// packages/zodvex/__tests__/codegen-extractCodec.test.ts
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'
import { extractCodec } from '../src/codegen/extractCodec'

const testCodec = zx.codec(
  z.object({ value: z.string(), tag: z.string() }),
  z.object({ value: z.string(), tag: z.string(), display: z.string() }),
  {
    decode: (w: any) => ({ ...w, display: `[${w.tag}] ${w.value}` }),
    encode: (r: any) => ({ value: r.value, tag: r.tag }),
  }
)

describe('extractCodec', () => {
  it('returns codec directly if no wrappers', () => {
    expect(extractCodec(testCodec)).toBe(testCodec)
  })

  it('unwraps .optional() to find codec', () => {
    expect(extractCodec(testCodec.optional())).toBe(testCodec)
  })

  it('unwraps .nullable() to find codec', () => {
    expect(extractCodec(testCodec.nullable())).toBe(testCodec)
  })

  it('unwraps .optional().nullable() to find codec', () => {
    expect(extractCodec(testCodec.optional().nullable())).toBe(testCodec)
  })

  it('unwraps double .optional() (from .partial()) to find codec', () => {
    expect(extractCodec(testCodec.optional().optional())).toBe(testCodec)
  })

  it('returns undefined for non-codec schemas', () => {
    expect(extractCodec(z.string())).toBeUndefined()
    expect(extractCodec(z.string().optional())).toBeUndefined()
  })

  it('skips zx.date() codecs', () => {
    expect(extractCodec(zx.date())).toBeUndefined()
    expect(extractCodec(zx.date().optional())).toBeUndefined()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/codegen-extractCodec.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```ts
// packages/zodvex/src/codegen/extractCodec.ts
import { z } from 'zod'

/**
 * Unwraps ZodOptional/ZodNullable layers to find the inner ZodCodec.
 * Returns the codec instance, or undefined if none found.
 * Skips zx.date() (ZodCodec with in=ZodNumber, out=ZodCustom).
 *
 * Used by generated _zodvex/api.ts to extract codec references from model shapes.
 */
export function extractCodec(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
  let current = schema
  for (let i = 0; i < 10; i++) {
    if (current instanceof z.ZodCodec) {
      const def = (current as any)._zod?.def as any
      const isZxDate = def?.in instanceof z.ZodNumber && def?.out instanceof z.ZodCustom
      if (isZxDate) return undefined
      return current
    }
    const def = (current as any)._zod?.def as any
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = def.innerType
      continue
    }
    break
  }
  return undefined
}
```

**Step 4: Add export to codegen index**

Add to `packages/zodvex/src/codegen/index.ts`:
```ts
export { extractCodec } from './extractCodec'
```

**Step 5: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/codegen-extractCodec.test.ts`
Expected: PASS — all 7 tests

**Step 6: Commit**

```bash
git add packages/zodvex/src/codegen/extractCodec.ts packages/zodvex/__tests__/codegen-extractCodec.test.ts packages/zodvex/src/codegen/index.ts
git commit -m "feat(codegen): add extractCodec utility for unwrapping model field codecs"
```

---

### Task 2: Add `walkModelCodecs` to discover.ts

**Files:**
- Modify: `packages/zodvex/src/codegen/discover.ts`
- Test: `packages/zodvex/__tests__/codegen-discover.test.ts`

This task adds a function that walks model schema shapes to find embedded `ZodCodec` instances. It also adds a new type `ModelEmbeddedCodec` to the `DiscoveryResult`.

**Step 1: Write the failing tests**

Add to `packages/zodvex/__tests__/codegen-discover.test.ts`:

```ts
// Add import at top:
import { zx } from '../src/zx'

describe('model-embedded codec discovery', () => {
  it('discovers codecs embedded in model schema shapes', async () => {
    const result = await discoverModules(fixtureDir)
    // The fixture codegen-project doesn't have model-embedded codecs yet,
    // so we test the walkModelCodecs function directly
    expect(result.modelCodecs).toBeDefined()
  })
})
```

But we also need to test `walkModelCodecs` directly with synthetic data. Add a new describe block:

```ts
import { walkModelCodecs, type ModelEmbeddedCodec } from '../src/codegen/discover'

describe('walkModelCodecs', () => {
  const testCodec = zx.codec(
    z.object({ value: z.string(), tag: z.string() }),
    z.object({ value: z.string(), tag: z.string(), display: z.string() }),
    {
      decode: (w: any) => ({ ...w, display: `[${w.tag}] ${w.value}` }),
      encode: (r: any) => ({ value: r.value, tag: r.tag }),
    }
  )

  it('finds codec in optional field', () => {
    const schemas = {
      doc: z.object({ _id: z.string(), email: testCodec.optional() }),
      insert: z.object({ email: testCodec.optional() }),
      update: z.object({ email: testCodec.optional() }),
      docArray: z.array(z.object({ _id: z.string(), email: testCodec.optional() })),
      paginatedDoc: z.object({ page: z.array(z.object({})), isDone: z.boolean(), continueCursor: z.string().nullable().optional() }),
    }
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[0].codec).toBe(testCodec)
    expect(result[0].modelExportName).toBe('TestModel')
    expect(result[0].fieldName).toBe('email')
    expect(result[0].schemaKey).toBe('doc')
  })

  it('deduplicates same codec across schema keys', () => {
    const schemas = {
      doc: z.object({ _id: z.string(), email: testCodec.optional() }),
      insert: z.object({ email: testCodec.optional() }),
      update: z.object({ email: testCodec.optional() }),
      docArray: z.array(z.object({ _id: z.string(), email: testCodec.optional() })),
      paginatedDoc: z.object({ page: z.array(z.object({})), isDone: z.boolean(), continueCursor: z.string().nullable().optional() }),
    }
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    // Same codec instance appears in doc, insert, update — should only appear once
    const emailCodecs = result.filter(c => c.codec === testCodec)
    expect(emailCodecs.length).toBe(1)
  })

  it('finds multiple different codecs', () => {
    const otherCodec = zx.codec(z.number(), z.string(), {
      decode: (n: number) => String(n),
      encode: (s: string) => Number(s),
    })
    const schemas = {
      doc: z.object({ _id: z.string(), email: testCodec.optional(), phone: otherCodec.nullable() }),
      insert: z.object({ email: testCodec.optional(), phone: otherCodec.nullable() }),
      update: z.object({ email: testCodec.optional(), phone: otherCodec.optional() }),
      docArray: z.array(z.object({})),
      paginatedDoc: z.object({ page: z.array(z.object({})), isDone: z.boolean(), continueCursor: z.string().nullable().optional() }),
    }
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(2)
  })

  it('skips zx.date() codecs', () => {
    const schemas = {
      doc: z.object({ _id: z.string(), createdAt: zx.date() }),
      insert: z.object({ createdAt: zx.date() }),
      update: z.object({}),
      docArray: z.array(z.object({})),
      paginatedDoc: z.object({ page: z.array(z.object({})), isDone: z.boolean(), continueCursor: z.string().nullable().optional() }),
    }
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(0)
  })

  it('skips non-codec fields', () => {
    const schemas = {
      doc: z.object({ _id: z.string(), name: z.string(), active: z.boolean().optional() }),
      insert: z.object({ name: z.string() }),
      update: z.object({ name: z.string().optional() }),
      docArray: z.array(z.object({})),
      paginatedDoc: z.object({ page: z.array(z.object({})), isDone: z.boolean(), continueCursor: z.string().nullable().optional() }),
    }
    const result = walkModelCodecs('TestModel', 'models/test.ts', schemas)
    expect(result.length).toBe(0)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/codegen-discover.test.ts`
Expected: FAIL — `walkModelCodecs` and `ModelEmbeddedCodec` not exported

**Step 3: Write minimal implementation**

Add to `packages/zodvex/src/codegen/discover.ts`:

```ts
// New type — add after DiscoveredCodec
export type ModelEmbeddedCodec = {
  codec: z.ZodTypeAny
  modelExportName: string
  modelSourceFile: string
  schemaKey: string
  fieldName: string
}

// New function — add before discoverModules
/**
 * Walks a model's schema shapes to find embedded ZodCodec instances.
 * Unwraps through ZodOptional/ZodNullable to find codecs in field definitions.
 * Deduplicates by codec object identity.
 * Skips zx.date() (handled natively by zodToSource).
 */
export function walkModelCodecs(
  modelExportName: string,
  sourceFile: string,
  schemas: Record<string, z.ZodTypeAny>
): ModelEmbeddedCodec[] {
  const found: ModelEmbeddedCodec[] = []
  const seen = new Set<z.ZodTypeAny>()

  // Walk the doc shape first (primary source of truth), then other schema keys
  for (const schemaKey of ['doc', 'insert', 'update'] as const) {
    const schema = schemas[schemaKey]
    if (!schema || !(schema instanceof z.ZodObject)) continue

    const shape = (schema._zod?.def as any)?.shape as Record<string, z.ZodTypeAny> | undefined
    if (!shape) continue

    for (const [fieldName, fieldSchema] of Object.entries(shape)) {
      // Unwrap optional/nullable to find codec
      let current: z.ZodTypeAny = fieldSchema
      for (let i = 0; i < 10; i++) {
        if (current instanceof z.ZodCodec) {
          const def = (current as any)._zod?.def as any
          const isZxDate = def?.in instanceof z.ZodNumber && def?.out instanceof z.ZodCustom
          if (!isZxDate && !seen.has(current)) {
            seen.add(current)
            found.push({
              codec: current,
              modelExportName,
              modelSourceFile: sourceFile,
              schemaKey,
              fieldName,
            })
          }
          break
        }
        if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
          current = (current._zod?.def as any).innerType
          continue
        }
        break
      }
    }
  }

  return found
}
```

Update `DiscoveryResult` type:

```ts
export type DiscoveryResult = {
  models: DiscoveredModel[]
  functions: DiscoveredFunction[]
  codecs: DiscoveredCodec[]
  modelCodecs: ModelEmbeddedCodec[]
}
```

Add model codec walking at the end of `discoverModules`, before the return:

```ts
  // Walk model schemas to find embedded codecs
  const modelCodecs: ModelEmbeddedCodec[] = []
  for (const model of models) {
    const found = walkModelCodecs(model.exportName, model.sourceFile, model.schemas as unknown as Record<string, z.ZodTypeAny>)
    modelCodecs.push(...found)
  }

  return { models, functions, codecs, modelCodecs }
```

**Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/codegen-discover.test.ts`
Expected: PASS — all tests including new ones

**Step 5: Run all codegen tests to check nothing broke**

Run: `bun test packages/zodvex/__tests__/codegen-*.test.ts`
Expected: PASS — existing tests still pass (may need minor fixes for new `modelCodecs` field)

**Step 6: Commit**

```bash
git add packages/zodvex/src/codegen/discover.ts packages/zodvex/__tests__/codegen-discover.test.ts
git commit -m "feat(codegen): walk model schemas to discover embedded codecs"
```

---

### Task 3: Populate codecMap with model-embedded codecs in generate.ts

**Files:**
- Modify: `packages/zodvex/src/codegen/generate.ts`
- Modify: `packages/zodvex/src/codegen/zodToSource.ts` (extend `CodecRef` type)
- Test: `packages/zodvex/__tests__/codegen-generate.test.ts`

**Step 1: Write the failing tests**

Add to `packages/zodvex/__tests__/codegen-generate.test.ts`:

```ts
import type { ModelEmbeddedCodec } from '../src/codegen/discover'

describe('model-embedded codec resolution', () => {
  const testCodec = zx.codec(
    z.object({ value: z.string(), tag: z.string() }),
    z.object({ value: z.string(), tag: z.string(), display: z.string() }),
    {
      decode: (w: any) => ({ ...w, display: `[${w.tag}] ${w.value}` }),
      encode: (r: any) => ({ value: r.value, tag: r.tag }),
    }
  )

  const codecModel: DiscoveredModel = {
    exportName: 'UserModel',
    tableName: 'users',
    sourceFile: 'models/user.ts',
    schemas: {
      doc: z.object({ _id: z.string(), name: z.string(), email: testCodec.optional() }),
      insert: z.object({ name: z.string(), email: testCodec.optional() }),
      update: z.object({ name: z.string().optional(), email: testCodec.optional() }),
      docArray: z.array(z.object({ _id: z.string(), name: z.string(), email: testCodec.optional() })),
      paginatedDoc: z.object({
        page: z.array(z.object({ _id: z.string(), name: z.string(), email: testCodec.optional() })),
        isDone: z.boolean(),
        continueCursor: z.string().nullable().optional()
      })
    }
  }

  const modelCodecs: ModelEmbeddedCodec[] = [
    {
      codec: testCodec,
      modelExportName: 'UserModel',
      modelSourceFile: 'models/user.ts',
      schemaKey: 'doc',
      fieldName: 'email',
    }
  ]

  it('resolves model-embedded codec in .partial() args', () => {
    const partialArgs = (codecModel.schemas.doc as z.ZodObject<any>).partial()
    const funcs: DiscoveredFunction[] = [
      {
        functionPath: 'users:update',
        exportName: 'update',
        sourceFile: 'users.ts',
        zodArgs: partialArgs,
        zodReturns: undefined,
      }
    ]
    const output = generateApiFile(funcs, [codecModel], [], modelCodecs)

    // Should NOT contain "transforms lost"
    expect(output).not.toContain('transforms lost')
    // Should contain extractCodec import and helper var
    expect(output).toContain("import { extractCodec } from 'zodvex/codegen'")
    expect(output).toContain("import { UserModel } from '../models/user'")
    expect(output).toContain('extractCodec(UserModel.schema.doc.shape.email)')
  })

  it('model-embedded codec in .extend() args preserves transforms', () => {
    const extendedArgs = (codecModel.schemas.doc as z.ZodObject<any>).extend({ extra: z.string() })
    const funcs: DiscoveredFunction[] = [
      {
        functionPath: 'users:update',
        exportName: 'update',
        sourceFile: 'users.ts',
        zodArgs: extendedArgs,
        zodReturns: undefined,
      }
    ]
    const output = generateApiFile(funcs, [codecModel], [], modelCodecs)
    expect(output).not.toContain('transforms lost')
  })

  it('still uses exported codec when both model-embedded and exported exist', () => {
    const funcs: DiscoveredFunction[] = [
      {
        functionPath: 'tasks:create',
        exportName: 'create',
        sourceFile: 'tasks.ts',
        zodArgs: z.object({ estimate: testCodec }),
        zodReturns: undefined,
      }
    ]
    // Pass same codec as both exported and model-embedded
    const exportedCodecs = [{ exportName: 'zTagged', sourceFile: 'codecs.ts', schema: testCodec }]
    const output = generateApiFile(funcs, [codecModel], exportedCodecs, modelCodecs)

    // Exported codec takes precedence (simpler reference)
    expect(output).toContain('zTagged')
    expect(output).toContain("import { zTagged } from '../codecs'")
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test packages/zodvex/__tests__/codegen-generate.test.ts`
Expected: FAIL — `generateApiFile` doesn't accept `modelCodecs` param yet

**Step 3: Update `generateApiFile` signature and codec map building**

Modify `packages/zodvex/src/codegen/generate.ts`:

1. Update `generateApiFile` signature to accept `modelCodecs`:

```ts
import type { ModelEmbeddedCodec } from './discover'

export function generateApiFile(
  functions: DiscoveredFunction[],
  models: DiscoveredModel[],
  codecs?: CodecForGeneration[],
  modelCodecs?: ModelEmbeddedCodec[]
): string {
```

2. After building the exported codec map (line 103), add model-embedded codecs:

```ts
  // Build model-embedded codec references
  // These use extractCodec() helpers to get the codec from model shapes at import time
  const modelCodecVars: { varName: string; expr: string; modelExportName: string }[] = []
  if (modelCodecs) {
    let varIndex = 0
    for (const mc of modelCodecs) {
      // Skip if already in codecMap (exported codec takes precedence)
      if (codecMap.has(mc.codec)) continue

      const varName = `_mc${varIndex++}`
      const expr = `extractCodec(${mc.modelExportName}.schema.${mc.schemaKey}.shape.${mc.fieldName})`
      modelCodecVars.push({ varName, expr, modelExportName: mc.modelExportName })

      const importPath = `../${mc.modelSourceFile.replace(/\.ts$/, '')}`
      codecMap.set(mc.codec, {
        exportName: varName,
        sourceFile: '__model_codec__' // sentinel — handled specially in import generation
      })
    }
  }
```

3. Track whether we need the extractCodec import:

```ts
  let needsExtractCodec = modelCodecVars.length > 0
```

4. In the import generation section, add `extractCodec` and ensure model imports are added for model codec vars:

```ts
  // extractCodec import (for model-embedded codecs)
  if (needsExtractCodec) {
    imports.push("import { extractCodec } from 'zodvex/codegen'")
  }

  // Model imports needed by model codec vars (may overlap with identity-matched imports)
  for (const mcv of modelCodecVars) {
    neededModelImports.add(mcv.modelExportName)
  }
```

5. After the import section, generate the helper vars:

```ts
  const modelCodecSection = modelCodecVars.length > 0
    ? `\n${modelCodecVars.map(v => `const ${v.varName} = ${v.expr}`).join('\n')}\n`
    : ''
```

6. Update the return to include the helper section:

```ts
  return `${HEADER}\n${importSection}${modelCodecSection}export const zodvexRegistry = {\n${entries},\n} as const\n`
```

7. Filter out `__model_codec__` sentinel from codec imports:

In the codec imports loop, add a skip:
```ts
  for (const [importPath, exportNames] of zodToSourceCtx.neededCodecImports) {
    if (importPath === '__model_codec__') continue  // handled separately via modelCodecVars
    const names = Array.from(exportNames).sort().join(', ')
    imports.push(`import { ${names} } from '${importPath}'`)
  }
```

**Step 4: Run tests to verify they pass**

Run: `bun test packages/zodvex/__tests__/codegen-generate.test.ts`
Expected: PASS — all tests including new model-embedded codec tests

**Step 5: Run all codegen tests**

Run: `bun test packages/zodvex/__tests__/codegen-*.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/zodvex/src/codegen/generate.ts packages/zodvex/__tests__/codegen-generate.test.ts
git commit -m "feat(codegen): populate codecMap with model-embedded codecs via extractCodec"
```

---

### Task 4: Wire model codecs through CLI and add warnings

**Files:**
- Modify: `packages/zodvex/src/cli/commands.ts`
- Modify: `packages/zodvex/src/codegen/zodToSource.ts`
- Test: `packages/zodvex/__tests__/codegen-e2e.test.ts`

**Step 1: Update zodToSource context to track undiscoverable codecs**

Add to `ZodToSourceContext` in `packages/zodvex/src/codegen/zodToSource.ts`:

```ts
export type UndiscoverableCodec = {
  functionPath?: string
  fieldPath: string
}

export type ZodToSourceContext = {
  codecMap: Map<z.ZodTypeAny, CodecRef>
  neededCodecImports: Map<string, Set<string>>
  /** Codecs found during serialization that aren't in the codecMap */
  undiscoverableCodecs: UndiscoverableCodec[]
}
```

Update the "transforms lost" fallback (line 66-68) to record the location:

```ts
    // Unknown codec — fall back to wire schema with warning
    const wireSource = zodToSource(def.in, ctx)
    ctx?.undiscoverableCodecs?.push({ fieldPath: 'unknown' })
    return `${wireSource} /* codec: transforms lost */`
```

**Step 2: Update commands.ts to pass modelCodecs and print warnings**

Modify `packages/zodvex/src/cli/commands.ts`:

```ts
  const apiContent = generateApiFile(result.functions, result.models, result.codecs, result.modelCodecs)
```

Update the log line to include total codec count:

```ts
  const totalCodecs = result.codecs.length + result.modelCodecs.length
  console.log(
    `[zodvex] Generated ${result.models.length} model(s), ${result.functions.length} function(s), ${totalCodecs} codec(s)`
  )
```

**Step 3: Write E2E test for the fixture project**

Add a test to `packages/zodvex/__tests__/codegen-e2e.test.ts` that verifies the fixture's existing `zDuration` codec still works (regression). The fixture doesn't currently have model-embedded codecs, so this is a regression guard.

Run: `bun test packages/zodvex/__tests__/codegen-e2e.test.ts`
Expected: PASS — no regressions

**Step 4: Run all tests**

Run: `bun test packages/zodvex/__tests__/codegen-*.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/zodvex/src/cli/commands.ts packages/zodvex/src/codegen/zodToSource.ts
git commit -m "feat(codegen): wire model-embedded codecs through CLI, track undiscoverable codecs"
```

---

### Task 5: Add model-embedded codec to test fixture and E2E test

**Files:**
- Modify: `packages/zodvex/__tests__/fixtures/codegen-project/models/user.ts`
- Create: `packages/zodvex/__tests__/fixtures/codegen-project/tagged.ts`
- Modify: `packages/zodvex/__tests__/fixtures/codegen-project/users.ts`
- Modify: `packages/zodvex/__tests__/codegen-e2e.test.ts`

**Step 1: Add tagged factory codec to fixture**

Create `packages/zodvex/__tests__/fixtures/codegen-project/tagged.ts`:

```ts
import { z } from 'zod'
import { zx } from '../../../../src/zx'

export function tagged<T extends z.ZodTypeAny>(inner: T) {
  return zx.codec(
    z.object({ value: inner, tag: z.string() }),
    z.object({ value: inner, tag: z.string(), display: z.string() }),
    {
      decode: (w: any) => ({ ...w, display: `[${w.tag}] ${w.value}` }),
      encode: (r: any) => ({ value: r.value, tag: r.tag }),
    }
  )
}
```

**Step 2: Add tagged codec to fixture model**

Modify `packages/zodvex/__tests__/fixtures/codegen-project/models/user.ts` to add a tagged field:

Add import: `import { tagged } from '../tagged'`

Update the doc schema to include: `email: tagged(z.string()).optional()`

Update insert/update schemas accordingly.

**Step 3: Add .partial() function to fixture**

Modify `packages/zodvex/__tests__/fixtures/codegen-project/users.ts` to add a function whose args use `.partial()` on the user doc schema.

**Step 4: Write E2E test assertions**

Add to `packages/zodvex/__tests__/codegen-e2e.test.ts`:

```ts
  it('model-embedded codecs in .partial() args produce extractCodec references', async () => {
    const result = await discoverModules(fixtureDir)
    const apiContent = generateApiFile(result.functions, result.models, result.codecs, result.modelCodecs)

    // Should NOT contain "transforms lost" for model-derived codecs
    // (may still contain it for orphaned inline codecs — that's expected)
    expect(apiContent).toContain('extractCodec')
    expect(apiContent).toContain("import { extractCodec } from 'zodvex/codegen'")
  })

  it('orphaned inline codecs produce transforms lost warning', async () => {
    const result = await discoverModules(fixtureDir)
    const apiContent = generateApiFile(result.functions, result.models, result.codecs, result.modelCodecs)

    // If the fixture has an inline factory codec in function args (not model-backed),
    // it should still degrade with the warning
    // This depends on whether we add such a case to the fixture
  })
```

**Step 5: Run all tests**

Run: `bun test packages/zodvex/__tests__/codegen-*.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/zodvex/__tests__/fixtures/codegen-project/ packages/zodvex/__tests__/codegen-e2e.test.ts
git commit -m "test(codegen): add model-embedded codec to fixture, E2E test for .partial() resolution"
```

---

### Task 6: Build, verify example project, clean up

**Files:**
- None created — verification only

**Step 1: Build the library**

Run: `bun run build`
Expected: PASS — tsup builds successfully

**Step 2: Run codegen on example project**

Run: `cd examples/task-manager && bunx zodvex generate convex`
Expected: Output shows increased codec count, `_zodvex/api.ts` no longer has `transforms lost` for the `.partial()` case

**Step 3: Verify generated api.ts**

Read `examples/task-manager/convex/_zodvex/api.ts`:
- `users:update` args should use `_mc0` (or similar) instead of wire schema for the email field
- `users:getByEmail` args should still show `transforms lost` (orphaned inline codec — expected)
- Import for `extractCodec` should be present

**Step 4: Run full test suite**

Run: `bun test`
Expected: PASS — all tests pass

**Step 5: Commit any final adjustments**

```bash
git commit -m "chore: verify codegen codec discovery end-to-end"
```

---

### Summary of changes

| File | Change |
|------|--------|
| `src/codegen/extractCodec.ts` | **New** — runtime utility to unwrap model fields to find codecs |
| `src/codegen/discover.ts` | Add `walkModelCodecs()`, `ModelEmbeddedCodec` type, walk models after discovery |
| `src/codegen/generate.ts` | Accept `modelCodecs`, build extractCodec helper vars, add to codecMap |
| `src/codegen/zodToSource.ts` | Add `UndiscoverableCodec` tracking to context |
| `src/codegen/index.ts` | Export `extractCodec` |
| `src/cli/commands.ts` | Pass `modelCodecs` to `generateApiFile`, update codec count |
| `__tests__/codegen-extractCodec.test.ts` | **New** — tests for extractCodec utility |
| `__tests__/codegen-discover.test.ts` | Tests for walkModelCodecs |
| `__tests__/codegen-generate.test.ts` | Tests for model-embedded codec resolution in registry |
| `__tests__/codegen-e2e.test.ts` | E2E test with fixture model-embedded codec |
| `__tests__/fixtures/codegen-project/tagged.ts` | **New** — factory codec for fixture |
| `__tests__/fixtures/codegen-project/models/user.ts` | Add tagged field |
| `__tests__/fixtures/codegen-project/users.ts` | Add .partial() function |
