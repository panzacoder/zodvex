# Results and Table Schema Helpers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add result types for explicit error handling and `schema.*` namespace to `zodTable()` with insert/update helpers.

**Architecture:** Create `src/results.ts` with types, helpers, and Zod schemas. Modify `src/tables.ts` to add `schema` namespace with `doc`, `docArray`, `insert`, `update`. Deprecate `zDoc` and `docArray` with JSDoc + runtime warnings.

**Tech Stack:** TypeScript, Zod v4, Bun test runner

---

## Task 1: Create Result Types

**Files:**
- Create: `src/results.ts`
- Test: `__tests__/results.test.ts`

**Step 1: Write the failing test for result type helpers**

Create `__tests__/results.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  success,
  failure,
  ok,
  formSuccess,
  formFailure,
  zMutationResult,
  zVoidMutationResult,
  zFormResult
} from '../src/results'

describe('result helpers', () => {
  describe('success/failure', () => {
    it('success() creates success result with data', () => {
      const result = success({ id: '123', name: 'test' })
      expect(result).toEqual({ success: true, data: { id: '123', name: 'test' } })
    })

    it('failure() creates failure result with error', () => {
      const result = failure('Not found')
      expect(result).toEqual({ success: false, error: 'Not found' })
    })
  })

  describe('ok', () => {
    it('ok() creates void success result', () => {
      const result = ok()
      expect(result).toEqual({ success: true })
    })
  })

  describe('formSuccess/formFailure', () => {
    it('formSuccess() creates success result with data', () => {
      const result = formSuccess({ email: 'test@example.com' })
      expect(result).toEqual({ success: true, data: { email: 'test@example.com' } })
    })

    it('formFailure() creates failure result with data and errors', () => {
      const result = formFailure(
        { email: 'bad' },
        { formErrors: ['Invalid submission'], fieldErrors: { email: ['Invalid email'] } }
      )
      expect(result).toEqual({
        success: false,
        data: { email: 'bad' },
        error: { formErrors: ['Invalid submission'], fieldErrors: { email: ['Invalid email'] } }
      })
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/results.test.ts`
Expected: FAIL with "Cannot find module '../src/results'"

**Step 3: Write minimal implementation for helpers**

Create `src/results.ts`:

```typescript
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/**
 * Result type for mutations that return data on success.
 */
export type MutationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

/**
 * Result type for mutations that don't return data (void operations).
 */
export type VoidMutationResult =
  | { success: true }
  | { success: false; error: string }

/**
 * Error structure for form validation results.
 */
export type FormError = {
  formErrors: string[]
  fieldErrors: Record<string, string[]>
}

/**
 * Result type for form submissions with field-level error support.
 * Preserves submitted data on failure for form re-population.
 */
export type FormResult<TData> =
  | { success: true; data: TData }
  | { success: false; data: TData; error: FormError }

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a success result with data.
 * @example success({ id: '123' })
 */
export const success = <T>(data: T) => ({ success: true, data }) as const

/**
 * Create a failure result with an error message.
 * @example failure('Not found')
 */
export const failure = (error: string) => ({ success: false, error }) as const

/**
 * Create a void success result (no data).
 * @example ok()
 */
export const ok = () => ({ success: true }) as const

/**
 * Create a form success result with data.
 * @example formSuccess({ email: 'user@example.com' })
 */
export const formSuccess = <T>(data: T) => ({ success: true, data }) as const

/**
 * Create a form failure result with data and errors.
 * @example formFailure({ email: 'bad' }, { formErrors: [], fieldErrors: { email: ['Invalid'] } })
 */
export const formFailure = <T>(data: T, error: FormError) =>
  ({ success: false, data, error }) as const
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/results.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/results.ts __tests__/results.test.ts
git commit -m "feat(results): add result type helpers"
```

---

## Task 2: Add Zod Schemas for Result Types

**Files:**
- Modify: `src/results.ts`
- Modify: `__tests__/results.test.ts`

**Step 1: Write the failing test for Zod schemas**

Add to `__tests__/results.test.ts`:

```typescript
describe('result Zod schemas', () => {
  describe('zMutationResult', () => {
    it('validates success result', () => {
      const schema = zMutationResult(z.object({ id: z.string() }))
      const result = schema.parse({ success: true, data: { id: '123' } })
      expect(result).toEqual({ success: true, data: { id: '123' } })
    })

    it('validates failure result', () => {
      const schema = zMutationResult(z.object({ id: z.string() }))
      const result = schema.parse({ success: false, error: 'Not found' })
      expect(result).toEqual({ success: false, error: 'Not found' })
    })

    it('rejects invalid success result', () => {
      const schema = zMutationResult(z.object({ id: z.string() }))
      expect(() => schema.parse({ success: true, data: { id: 123 } })).toThrow()
    })

    it('rejects invalid failure result', () => {
      const schema = zMutationResult(z.object({ id: z.string() }))
      expect(() => schema.parse({ success: false, error: 123 })).toThrow()
    })
  })

  describe('zVoidMutationResult', () => {
    it('validates void success result', () => {
      const result = zVoidMutationResult.parse({ success: true })
      expect(result).toEqual({ success: true })
    })

    it('validates void failure result', () => {
      const result = zVoidMutationResult.parse({ success: false, error: 'Failed' })
      expect(result).toEqual({ success: false, error: 'Failed' })
    })
  })

  describe('zFormResult', () => {
    it('validates form success result', () => {
      const schema = zFormResult(z.object({ email: z.string() }))
      const result = schema.parse({ success: true, data: { email: 'test@example.com' } })
      expect(result).toEqual({ success: true, data: { email: 'test@example.com' } })
    })

    it('validates form failure result with errors', () => {
      const schema = zFormResult(z.object({ email: z.string() }))
      const result = schema.parse({
        success: false,
        data: { email: 'bad' },
        error: { formErrors: ['Invalid'], fieldErrors: { email: ['Bad email'] } }
      })
      expect(result).toEqual({
        success: false,
        data: { email: 'bad' },
        error: { formErrors: ['Invalid'], fieldErrors: { email: ['Bad email'] } }
      })
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/results.test.ts`
Expected: FAIL with zMutationResult/zVoidMutationResult/zFormResult errors

**Step 3: Add Zod schemas to results.ts**

Add to `src/results.ts` after helper functions:

```typescript
// ============================================================================
// Zod Schemas for `returns` validation
// ============================================================================

/**
 * Zod schema for MutationResult<T>.
 * Use in `returns` option to validate mutation responses.
 * @example zMutationResult(z.object({ id: zid('users') }))
 */
export const zMutationResult = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), data: dataSchema }),
    z.object({ success: z.literal(false), error: z.string() })
  ])

/**
 * Zod schema for VoidMutationResult.
 * Use in `returns` option for void mutations.
 * @example returns: zVoidMutationResult
 */
export const zVoidMutationResult = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true) }),
  z.object({ success: z.literal(false), error: z.string() })
])

/**
 * Zod schema for FormError.
 */
export const zFormError = z.object({
  formErrors: z.array(z.string()),
  fieldErrors: z.record(z.string(), z.array(z.string()))
})

/**
 * Zod schema for FormResult<T>.
 * Use in `returns` option for form submissions.
 * @example zFormResult(z.object({ email: z.string() }))
 */
export const zFormResult = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), data: dataSchema }),
    z.object({ success: z.literal(false), data: dataSchema, error: zFormError })
  ])
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/results.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/results.ts __tests__/results.test.ts
git commit -m "feat(results): add Zod schemas for result type validation"
```

---

## Task 3: Export Results from Main Index

**Files:**
- Modify: `src/index.ts`

**Step 1: Write the failing test for exports**

Add to `__tests__/results.test.ts` at the top:

```typescript
import {
  success,
  failure,
  ok,
  formSuccess,
  formFailure,
  zMutationResult,
  zVoidMutationResult,
  zFormResult,
  type MutationResult,
  type VoidMutationResult,
  type FormResult,
  type FormError
} from '../src'
```

Change the existing imports at the top from `'../src/results'` to `'../src'`.

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/results.test.ts`
Expected: FAIL with export errors

**Step 3: Add export to index.ts**

Modify `src/index.ts` to add:

```typescript
export * from './results'
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/results.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts __tests__/results.test.ts
git commit -m "feat(results): export result types from main index"
```

---

## Task 4: Add schema.doc and schema.docArray to zodTable (Object Shapes)

**Files:**
- Modify: `src/tables.ts`
- Create: `__tests__/tables-schema.test.ts`

**Step 1: Write the failing test**

Create `__tests__/tables-schema.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zodTable } from '../src/tables'

describe('zodTable schema namespace', () => {
  describe('object shapes', () => {
    it('provides schema.doc with system fields', () => {
      const Users = zodTable('users', {
        name: z.string(),
        email: z.string().email()
      })

      expect(Users.schema).toBeDefined()
      expect(Users.schema.doc).toBeInstanceOf(z.ZodObject)

      // Should have system fields
      const shape = Users.schema.doc.shape
      expect(shape._id).toBeDefined()
      expect(shape._creationTime).toBeDefined()
      expect(shape.name).toBeDefined()
      expect(shape.email).toBeDefined()
    })

    it('provides schema.docArray', () => {
      const Users = zodTable('users', {
        name: z.string()
      })

      expect(Users.schema.docArray).toBeInstanceOf(z.ZodArray)

      // Element should be doc schema
      const element = Users.schema.docArray.element
      expect(element).toBe(Users.schema.doc)
    })

    it('schema.doc equals deprecated zDoc', () => {
      const Users = zodTable('users', { name: z.string() })
      expect(Users.schema.doc).toBe(Users.zDoc)
    })

    it('schema.docArray equals deprecated docArray', () => {
      const Users = zodTable('users', { name: z.string() })
      expect(Users.schema.docArray).toBe(Users.docArray)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: FAIL with "Users.schema is undefined"

**Step 3: Add schema namespace to zodTable**

Modify `src/tables.ts`. In the object shape branch of `zodTable()`, change the return from:

```typescript
return Object.assign(table, {
  shape,
  zDoc,
  docArray
})
```

To:

```typescript
// Create schema namespace
const schema = {
  doc: zDoc,
  docArray
}

return Object.assign(table, {
  shape,
  zDoc,      // deprecated
  docArray,  // deprecated
  schema
})
```

Also update the return type for the object shape overload. Change:

```typescript
export function zodTable<TableName extends string, Shape extends Record<string, z.ZodTypeAny>>(
  name: TableName,
  shape: Shape
): ReturnType<typeof Table<ConvexValidatorFromZodFieldsAuto<Shape>, TableName>> & {
  shape: Shape
  zDoc: z.ZodObject<...>
  docArray: z.ZodArray<...>
}
```

To:

```typescript
export function zodTable<TableName extends string, Shape extends Record<string, z.ZodTypeAny>>(
  name: TableName,
  shape: Shape
): ReturnType<typeof Table<ConvexValidatorFromZodFieldsAuto<Shape>, TableName>> & {
  shape: Shape
  /** @deprecated Use `schema.doc` instead */
  zDoc: z.ZodObject<
    Shape & {
      _id: ReturnType<typeof zid<TableName>>
      _creationTime: z.ZodNumber
    }
  >
  /** @deprecated Use `schema.docArray` instead */
  docArray: z.ZodArray<
    z.ZodObject<
      Shape & {
        _id: ReturnType<typeof zid<TableName>>
        _creationTime: z.ZodNumber
      }
    >
  >
  schema: {
    doc: z.ZodObject<
      Shape & {
        _id: ReturnType<typeof zid<TableName>>
        _creationTime: z.ZodNumber
      }
    >
    docArray: z.ZodArray<
      z.ZodObject<
        Shape & {
          _id: ReturnType<typeof zid<TableName>>
          _creationTime: z.ZodNumber
        }
      >
    >
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tables.ts __tests__/tables-schema.test.ts
git commit -m "feat(tables): add schema.doc and schema.docArray to zodTable"
```

---

## Task 5: Add schema.insert to zodTable

**Files:**
- Modify: `src/tables.ts`
- Modify: `__tests__/tables-schema.test.ts`

**Step 1: Write the failing test**

Add to `__tests__/tables-schema.test.ts`:

```typescript
describe('schema.insert', () => {
  it('provides insert schema with user fields only (no system fields)', () => {
    const Users = zodTable('users', {
      name: z.string(),
      email: z.string().email(),
      age: z.number().optional()
    })

    expect(Users.schema.insert).toBeInstanceOf(z.ZodObject)

    const shape = Users.schema.insert.shape
    expect(shape.name).toBeDefined()
    expect(shape.email).toBeDefined()
    expect(shape.age).toBeDefined()

    // Should NOT have system fields
    expect(shape._id).toBeUndefined()
    expect(shape._creationTime).toBeUndefined()
  })

  it('insert schema validates correctly', () => {
    const Users = zodTable('users', {
      name: z.string(),
      email: z.string().email()
    })

    const valid = Users.schema.insert.parse({ name: 'John', email: 'john@example.com' })
    expect(valid).toEqual({ name: 'John', email: 'john@example.com' })

    expect(() => Users.schema.insert.parse({ name: 'John' })).toThrow() // missing email
  })

  it('insert schema can be extended with .omit()', () => {
    const Users = zodTable('users', {
      name: z.string(),
      userId: z.string(),
      createdAt: z.number()
    })

    const CreateInput = Users.schema.insert.omit({ userId: true, createdAt: true })

    const valid = CreateInput.parse({ name: 'John' })
    expect(valid).toEqual({ name: 'John' })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: FAIL with "Users.schema.insert is undefined"

**Step 3: Add insert schema**

In `src/tables.ts`, in the object shape branch, update the schema creation:

```typescript
// Create insert schema (user fields only, no system fields)
const insertSchema = z.object(shape)

// Create schema namespace
const schema = {
  doc: zDoc,
  docArray,
  insert: insertSchema
}
```

Update the return type to include `insert`:

```typescript
schema: {
  doc: z.ZodObject<...>
  docArray: z.ZodArray<...>
  insert: z.ZodObject<Shape>
}
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tables.ts __tests__/tables-schema.test.ts
git commit -m "feat(tables): add schema.insert to zodTable"
```

---

## Task 6: Add schema.update to zodTable

**Files:**
- Modify: `src/tables.ts`
- Modify: `__tests__/tables-schema.test.ts`

**Step 1: Write the failing test**

Add to `__tests__/tables-schema.test.ts`:

```typescript
describe('schema.update', () => {
  it('provides update schema with all fields partial', () => {
    const Users = zodTable('users', {
      name: z.string(),
      email: z.string().email(),
      age: z.number()
    })

    expect(Users.schema.update).toBeInstanceOf(z.ZodObject)

    // All fields should be optional
    const result = Users.schema.update.parse({})
    expect(result).toEqual({})

    const partial = Users.schema.update.parse({ name: 'John' })
    expect(partial).toEqual({ name: 'John' })
  })

  it('update schema validates field types correctly', () => {
    const Users = zodTable('users', {
      name: z.string(),
      age: z.number()
    })

    // Valid partial update
    const valid = Users.schema.update.parse({ age: 30 })
    expect(valid).toEqual({ age: 30 })

    // Invalid type should fail
    expect(() => Users.schema.update.parse({ age: 'thirty' })).toThrow()
  })

  it('update schema does not include system fields', () => {
    const Users = zodTable('users', { name: z.string() })

    const shape = Users.schema.update.shape
    expect(shape.name).toBeDefined()
    expect(shape._id).toBeUndefined()
    expect(shape._creationTime).toBeUndefined()
  })

  it('handles already-optional fields correctly', () => {
    const Users = zodTable('users', {
      name: z.string(),
      nickname: z.string().optional()
    })

    // Both should be optional in update schema
    const result = Users.schema.update.parse({})
    expect(result).toEqual({})

    const withNickname = Users.schema.update.parse({ nickname: 'Johnny' })
    expect(withNickname).toEqual({ nickname: 'Johnny' })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: FAIL with "Users.schema.update is undefined"

**Step 3: Add update schema**

In `src/tables.ts`, in the object shape branch, update the schema creation:

```typescript
// Create insert schema (user fields only, no system fields)
const insertSchema = z.object(shape)

// Create update schema (all fields partial)
const updateSchema = insertSchema.partial()

// Create schema namespace
const schema = {
  doc: zDoc,
  docArray,
  insert: insertSchema,
  update: updateSchema
}
```

Update the return type. Add a helper type at the top of the file:

```typescript
/**
 * Makes all properties of a Zod object shape optional.
 */
type PartialShape<Shape extends Record<string, z.ZodTypeAny>> = {
  [K in keyof Shape]: z.ZodOptional<Shape[K]>
}
```

Then update the schema type:

```typescript
schema: {
  doc: z.ZodObject<...>
  docArray: z.ZodArray<...>
  insert: z.ZodObject<Shape>
  update: z.ZodObject<PartialShape<Shape>>
}
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tables.ts __tests__/tables-schema.test.ts
git commit -m "feat(tables): add schema.update to zodTable"
```

---

## Task 7: Add Deprecation Runtime Warnings

**Files:**
- Modify: `src/tables.ts`
- Modify: `__tests__/tables-schema.test.ts`

**Step 1: Write the failing test**

Add to `__tests__/tables-schema.test.ts`:

```typescript
import { beforeEach, afterEach, spyOn } from 'bun:test'

describe('deprecation warnings', () => {
  let consoleWarnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  it('warns when accessing zDoc', () => {
    const Users = zodTable('users', { name: z.string() })

    // First access should warn
    const _doc = Users.zDoc
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('zDoc')
    )
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('schema.doc')
    )
  })

  it('warns when accessing docArray', () => {
    const Users = zodTable('users', { name: z.string() })

    const _arr = Users.docArray
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('docArray')
    )
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('schema.docArray')
    )
  })

  it('only warns once per property per table', () => {
    const Users = zodTable('users', { name: z.string() })

    Users.zDoc
    Users.zDoc
    Users.zDoc

    // Should only have warned once for zDoc
    const zDocWarnings = consoleWarnSpy.mock.calls.filter(
      (call: any[]) => call[0]?.includes('zDoc')
    )
    expect(zDocWarnings.length).toBe(1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: FAIL (no warnings emitted yet)

**Step 3: Add deprecation warnings with getters**

In `src/tables.ts`, replace the direct property assignment with getters. Change:

```typescript
return Object.assign(table, {
  shape,
  zDoc,
  docArray,
  schema
})
```

To:

```typescript
const warned = { zDoc: false, docArray: false }

const result = Object.assign(table, {
  shape,
  schema
})

Object.defineProperty(result, 'zDoc', {
  get() {
    if (!warned.zDoc) {
      console.warn('zodvex: `zDoc` is deprecated, use `schema.doc` instead')
      warned.zDoc = true
    }
    return schema.doc
  },
  enumerable: true
})

Object.defineProperty(result, 'docArray', {
  get() {
    if (!warned.docArray) {
      console.warn('zodvex: `docArray` is deprecated, use `schema.docArray` instead')
      warned.docArray = true
    }
    return schema.docArray
  },
  enumerable: true
})

return result
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tables.ts __tests__/tables-schema.test.ts
git commit -m "feat(tables): add deprecation warnings for zDoc and docArray"
```

---

## Task 8: Add schema Namespace to Union Tables

**Files:**
- Modify: `src/tables.ts`
- Modify: `__tests__/tables-schema.test.ts`

**Step 1: Write the failing test**

Add to `__tests__/tables-schema.test.ts`:

```typescript
describe('union schemas', () => {
  it('provides schema.doc for unions', () => {
    const Shapes = zodTable('shapes', z.union([
      z.object({ kind: z.literal('circle'), r: z.number() }),
      z.object({ kind: z.literal('rect'), w: z.number() })
    ]))

    expect(Shapes.schema).toBeDefined()
    expect(Shapes.schema.doc).toBeInstanceOf(z.ZodUnion)

    // Each variant should have system fields
    const options = Shapes.schema.doc.options
    expect(options[0].shape._id).toBeDefined()
    expect(options[0].shape._creationTime).toBeDefined()
  })

  it('provides schema.docArray for unions', () => {
    const Shapes = zodTable('shapes', z.union([
      z.object({ kind: z.literal('circle'), r: z.number() }),
      z.object({ kind: z.literal('rect'), w: z.number() })
    ]))

    expect(Shapes.schema.docArray).toBeInstanceOf(z.ZodArray)
  })

  it('provides schema.insert for unions (original schema)', () => {
    const shapeSchema = z.union([
      z.object({ kind: z.literal('circle'), r: z.number() }),
      z.object({ kind: z.literal('rect'), w: z.number() })
    ])
    const Shapes = zodTable('shapes', shapeSchema)

    // Insert should be the original schema (no system fields)
    expect(Shapes.schema.insert).toBe(shapeSchema)
  })

  it('provides schema.update for unions (each variant partial)', () => {
    const Shapes = zodTable('shapes', z.union([
      z.object({ kind: z.literal('circle'), r: z.number() }),
      z.object({ kind: z.literal('rect'), w: z.number() })
    ]))

    expect(Shapes.schema.update).toBeInstanceOf(z.ZodUnion)

    // Each variant should be partial
    const result = Shapes.schema.update.parse({ kind: 'circle' })
    expect(result).toEqual({ kind: 'circle' }) // r is now optional
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: FAIL with "Shapes.schema is undefined"

**Step 3: Add schema namespace to union branch**

In `src/tables.ts`, in the union/schema branch, add:

```typescript
// Create document schema with system fields
const docSchema = addSystemFields(name, schema)

// Create docArray helper
const docArray = z.array(docSchema)

// Create update schema (each variant partial)
let updateSchema: z.ZodTypeAny
if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
  const partialOptions = (schema as z.ZodUnion<any>).options.map((variant: z.ZodTypeAny) => {
    if (variant instanceof z.ZodObject) {
      return variant.partial()
    }
    return variant
  })
  updateSchema = z.union(partialOptions as any)
} else if (schema instanceof z.ZodObject) {
  updateSchema = schema.partial()
} else {
  updateSchema = schema
}

// Create schema namespace
const schemaNamespace = {
  doc: docSchema,
  docArray,
  insert: schema,
  update: updateSchema
}

return {
  table,
  tableName: name,
  validator: convexValidator,
  schema: schemaNamespace,
  // Deprecated
  docArray,
  withSystemFields: () => addSystemFields(name, schema)
}
```

Also update the union overload return type:

```typescript
export function zodTable<TableName extends string, Schema extends z.ZodTypeAny>(
  name: TableName,
  schema: Schema
): {
  table: ReturnType<typeof defineTable>
  tableName: TableName
  validator: ReturnType<typeof zodToConvex<Schema>>
  /** @deprecated Use `schema.insert` instead */
  schema: Schema
  /** @deprecated Use `schema.docArray` instead */
  docArray: z.ZodArray<AddSystemFieldsResult<TableName, Schema>>
  withSystemFields: () => AddSystemFieldsResult<TableName, Schema>
  schema: {
    doc: AddSystemFieldsResult<TableName, Schema>
    docArray: z.ZodArray<AddSystemFieldsResult<TableName, Schema>>
    insert: Schema
    update: z.ZodTypeAny // Partial variant of Schema
  }
}
```

Note: There's a naming conflict with `schema` property. Rename the original `schema` to `originalSchema` or remove it:

```typescript
return {
  table,
  tableName: name,
  validator: convexValidator,
  schema: schemaNamespace,
  docArray, // deprecated, alias to schema.docArray
  withSystemFields: () => addSystemFields(name, schema)
}
```

**Step 4: Run test to verify it passes**

Run: `bun test __tests__/tables-schema.test.ts`
Expected: PASS

**Step 5: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/tables.ts __tests__/tables-schema.test.ts
git commit -m "feat(tables): add schema namespace to union tables"
```

---

## Task 9: Verify Existing Tests Still Pass

**Files:**
- None (verification only)

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests PASS

**Step 2: Run type check**

Run: `bun run type-check`
Expected: No errors

**Step 3: Run lint**

Run: `bun run lint`
Expected: No errors (or fix any that appear)

**Step 4: Commit any fixes**

If fixes were needed:
```bash
git add -A
git commit -m "fix: address lint/type issues from schema namespace changes"
```

---

## Task 10: Update Documentation Example

**Files:**
- Modify: `docs/plans/2026-01-19-results-and-table-helpers-design.md`

**Step 1: Add comprehensive usage examples to design doc**

Add a new section to the design doc with the documentation example pattern we discussed:

```markdown
## Usage Examples

### Result Types

```typescript
import { zm } from './util'
import { zVoidMutationResult, ok, failure, zMutationResult, success } from 'zodvex'
import type { VoidMutationResult, MutationResult } from 'zodvex'

// Void mutation (delete, update without return)
export const deleteItem = zm({
  args: { id: zid('items') },
  returns: zVoidMutationResult,
  handler: async (ctx, { id }): Promise<VoidMutationResult> => {
    const item = await ctx.db.get(id)
    if (!item) return failure('Item not found')

    await ctx.db.delete(id)
    return ok()
  }
})

// Mutation with data return
export const createItem = zm({
  args: { name: z.string() },
  returns: zMutationResult(zid('items')),
  handler: async (ctx, { name }): Promise<MutationResult<Id<'items'>>> => {
    const id = await ctx.db.insert('items', { name })
    return success(id)
  }
})
```

### Table Schema Helpers

```typescript
import { zodTable, zid } from 'zodvex'
import { z } from 'zod'

const dancerShape = {
  name: z.string(),
  userId: zid('users'),
  createdAt: z.number(),
  bio: z.string().optional(),
}

export const Dancers = zodTable('dancers', dancerShape)

// App-specific input schema: omit fields populated by handler
export const DancerCreateInput = Dancers.schema.insert.omit({
  userId: true,
  createdAt: true
})

// Usage
export const create = authMutation({
  args: DancerCreateInput.shape,
  returns: zid('dancers'),
  handler: async (ctx, args) => {
    return ctx.db.insert('dancers', {
      ...args,
      userId: ctx.user._id,
      createdAt: Date.now(),
    })
  }
})

export const update = authMutation({
  args: { id: zid('dancers'), ...Dancers.schema.update.shape },
  returns: zVoidMutationResult,
  handler: async (ctx, { id, ...updates }) => {
    await ctx.db.patch(id, updates)
    return ok()
  }
})
```
```

**Step 2: Commit**

```bash
git add docs/plans/2026-01-19-results-and-table-helpers-design.md
git commit -m "docs: add usage examples to design document"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create result type helpers | `src/results.ts`, `__tests__/results.test.ts` |
| 2 | Add Zod schemas for results | `src/results.ts`, `__tests__/results.test.ts` |
| 3 | Export results from main index | `src/index.ts` |
| 4 | Add schema.doc/docArray | `src/tables.ts`, `__tests__/tables-schema.test.ts` |
| 5 | Add schema.insert | `src/tables.ts`, `__tests__/tables-schema.test.ts` |
| 6 | Add schema.update | `src/tables.ts`, `__tests__/tables-schema.test.ts` |
| 7 | Add deprecation warnings | `src/tables.ts`, `__tests__/tables-schema.test.ts` |
| 8 | Add schema to union tables | `src/tables.ts`, `__tests__/tables-schema.test.ts` |
| 9 | Verify all tests pass | - |
| 10 | Update documentation | `docs/plans/*.md` |
