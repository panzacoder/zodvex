import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { transformFile } from './transforms'

function transform(code: string): string {
  const project = new Project({ useInMemoryFileSystem: true })
  const file = project.createSourceFile('test.ts', code)
  transformFile(file)
  return file.getFullText().trim()
}

describe('transformWrappers', () => {
  it('.optional() → z.optional()', () => {
    expect(transform('z.string().optional()')).toBe('z.optional(z.string())')
  })

  it('.nullable() → z.nullable()', () => {
    expect(transform('z.number().nullable()')).toBe('z.nullable(z.number())')
  })

  it('chains: .nullable().optional()', () => {
    expect(transform('z.string().nullable().optional()')).toBe('z.optional(z.nullable(z.string()))')
  })

  it('nested in object', () => {
    const input = `z.object({ name: z.string().optional() })`
    const expected = `z.object({ name: z.optional(z.string()) })`
    expect(transform(input)).toBe(expected)
  })

  it('does not touch z.optional() functional form', () => {
    expect(transform('z.optional(z.string())')).toBe('z.optional(z.string())')
  })

  it('does not touch .optional(defaultValue) with args', () => {
    // .optional() with args is a different API
    expect(transform('schema.optional("default")')).toBe('schema.optional("default")')
  })
})

describe('transformChecks', () => {
  it('.email() → .check(z.email())', () => {
    expect(transform('z.string().email()')).toBe('z.string().check(z.email())')
  })

  it('.email(msg) preserves message', () => {
    expect(transform('z.string().email("bad")')).toBe('z.string().check(z.email("bad"))')
  })

  it('.uuid() → .check(z.uuid())', () => {
    expect(transform('z.string().uuid()')).toBe('z.string().check(z.uuid())')
  })

  it('.int() → .check(z.int())', () => {
    expect(transform('z.number().int()')).toBe('z.number().check(z.int())')
  })

  it('.positive() → .check(z.positive())', () => {
    expect(transform('z.number().positive()')).toBe('z.number().check(z.positive())')
  })

  it('.min(n) on string → .check(z.minLength(n))', () => {
    expect(transform('z.string().min(1)')).toBe('z.string().check(z.minLength(1))')
  })

  it('.max(n) on string → .check(z.maxLength(n))', () => {
    expect(transform('z.string().max(10)')).toBe('z.string().check(z.maxLength(10))')
  })

  it('.min(n) on number → .check(z.gte(n))', () => {
    expect(transform('z.number().min(0)')).toBe('z.number().check(z.gte(0))')
  })

  it('.max(n) on number → .check(z.lte(n))', () => {
    expect(transform('z.number().max(100)')).toBe('z.number().check(z.lte(100))')
  })

  it('does NOT convert .startsWith() on non-schema expressions', () => {
    // String.prototype.startsWith — should not be converted
    expect(transform('name.startsWith("foo")')).toBe('name.startsWith("foo")')
  })

  it('does NOT convert .includes() on non-schema expressions', () => {
    expect(transform('arr.includes(item)')).toBe('arr.includes(item)')
  })

  it('does NOT convert z.email() (namespace call)', () => {
    expect(transform('z.email()')).toBe('z.email()')
  })

  it('does NOT convert z.string() constructor', () => {
    expect(transform('z.string()')).toBe('z.string()')
  })

  it('does NOT convert zx.date() constructor', () => {
    expect(transform('zx.date()')).toBe('zx.date()')
  })
})

describe('transformMethods', () => {
  it('.describe(str) → z.describe(schema, str)', () => {
    expect(transform('z.string().describe("a name")')).toBe('z.describe(z.string(), "a name")')
  })

  it('.pipe(other) → z.pipe(schema, other)', () => {
    expect(transform('z.string().pipe(z.number())')).toBe('z.pipe(z.string(), z.number())')
  })

  it('.transform(fn) → z.pipe(schema, z.transform(fn))', () => {
    expect(transform('z.string().transform(v => parseInt(v))')).toBe('z.pipe(z.string(), z.transform(v => parseInt(v)))')
  })

  it('.refine(fn, opts) → .check(z.refine(fn, opts))', () => {
    const input = `z.string().refine(v => v.length > 0, { message: "Required" })`
    const expected = `z.string().check(z.refine(v => v.length > 0, { message: "Required" }))`
    expect(transform(input)).toBe(expected)
  })

  it('does NOT convert z.transform() namespace call', () => {
    expect(transform('z.transform(v => v)')).toBe('z.transform(v => v)')
  })

  it('does NOT convert z.describe() namespace call', () => {
    expect(transform('z.describe(schema, "name")')).toBe('z.describe(schema, "name")')
  })
})

describe('transformClassRefs', () => {
  it('z.ZodError → $ZodError', () => {
    const input = `import { z } from 'zod'\nfoo instanceof z.ZodError`
    const result = transform(input)
    expect(result).toContain('instanceof $ZodError')
    expect(result).toContain("import { $ZodError } from")
  })

  it('z.ZodObject → $ZodObject', () => {
    const input = `import { z } from 'zod'\nfoo instanceof z.ZodObject`
    const result = transform(input)
    expect(result).toContain('instanceof $ZodObject')
  })

  it('z.ZodTypeAny → $ZodType (runtime usage)', () => {
    // Type annotations are erased at compile time — the codemod only handles
    // runtime PropertyAccessExpression nodes, not type-position references.
    const input = `import { z } from 'zod'\nfoo instanceof z.ZodTypeAny`
    const result = transform(input)
    expect(result).toContain('instanceof $ZodType')
  })
})

describe('transformMethods — object methods', () => {
  it('.partial() → z.partial(schema)', () => {
    expect(transform('schema.partial()')).toBe('z.partial(schema)')
  })

  it('.extend(shape) → z.extend(schema, shape)', () => {
    expect(transform('schema.extend({ foo: z.string() })')).toBe('z.extend(schema, { foo: z.string() })')
  })

  it('.pick(keys) → z.pick(schema, keys)', () => {
    expect(transform('schema.pick({ name: true })')).toBe('z.pick(schema, { name: true })')
  })

  it('.omit(keys) → z.omit(schema, keys)', () => {
    expect(transform('schema.omit({ age: true })')).toBe('z.omit(schema, { age: true })')
  })

  it('.catchall(schema) → z.catchall(schema, catchallSchema)', () => {
    expect(transform('obj.catchall(z.string())')).toBe('z.catchall(obj, z.string())')
  })

  it('.default(val) → z._default(schema, val)', () => {
    expect(transform('z.string().default("hello")')).toBe('z._default(z.string(), "hello")')
  })
})

describe('findObjectOnlyMethods (warnings)', () => {
  it('flags .passthrough() (deprecated)', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', 'schema.passthrough()')
    const result = transformFile(file)
    expect(result.objectOnlyWarnings).toHaveLength(1)
    expect(result.objectOnlyWarnings[0].method).toBe('passthrough')
  })

  it('flags .strict() (deprecated)', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', 'schema.strict()')
    const result = transformFile(file)
    expect(result.objectOnlyWarnings).toHaveLength(1)
    expect(result.objectOnlyWarnings[0].method).toBe('strict')
  })

  it('flags .datetime() (→ z.iso.datetime())', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', 'z.string().datetime()')
    const result = transformFile(file)
    expect(result.objectOnlyWarnings).toHaveLength(1)
    expect(result.objectOnlyWarnings[0].method).toBe('datetime')
  })
})

describe('combined transforms', () => {
  it('handles chained: .email().optional()', () => {
    expect(transform('z.string().email().optional()')).toBe('z.optional(z.string().check(z.email()))')
  })

  it('handles chained: .min(1).email().optional()', () => {
    const result = transform('z.string().min(1).email().optional()')
    expect(result).toBe('z.optional(z.string().check(z.minLength(1)).check(z.email()))')
  })

  it('handles .refine().describe() chain', () => {
    const input = `z.string().refine(v => v.length > 0, { message: "Required" }).describe("name")`
    const result = transform(input)
    expect(result).toBe(`z.describe(z.string().check(z.refine(v => v.length > 0, { message: "Required" })), "name")`)
  })

  it('handles complex nested schema', () => {
    const input = `z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  age: z.number().int().positive(),
  bio: z.string().nullable(),
})`
    const result = transform(input)
    expect(result).toContain('z.string().check(z.minLength(1))')
    expect(result).toContain('z.optional(z.string().check(z.email()))')
    expect(result).toContain('z.number().check(z.int()).check(z.positive())')
    expect(result).toContain('z.nullable(z.string())')
  })
})
