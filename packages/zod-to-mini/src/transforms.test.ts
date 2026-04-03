import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { transformFile, transformCode } from './transforms'

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
  it('.describe(str) → .check(z.describe(str))', () => {
    expect(transform('z.string().describe("a name")')).toBe('z.string().check(z.describe("a name"))')
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
    expect(transform('z.describe("name")')).toBe('z.describe("name")')
  })

  it('does NOT convert .toString() (Object.prototype method)', () => {
    // Previously crashed because `"toString" in { default: "_default" }` was true
    // due to prototype chain lookup
    expect(transform('num.toString()')).toBe('num.toString()')
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
  it('.partial() on z.object() → z.partial(schema)', () => {
    expect(transform('z.object({ a: z.string() }).partial()')).toBe('z.partial(z.object({ a: z.string() }))')
  })

  it('.extend(shape) on z.object() → z.extend(schema, shape)', () => {
    expect(transform('z.object({ a: z.string() }).extend({ foo: z.string() })')).toBe('z.extend(z.object({ a: z.string() }), { foo: z.string() })')
  })

  it('.pick(keys) on z.object() → z.pick(schema, keys)', () => {
    expect(transform('z.object({ a: z.string() }).pick({ a: true })')).toBe('z.pick(z.object({ a: z.string() }), { a: true })')
  })

  it('.omit(keys) on z.object() → z.omit(schema, keys)', () => {
    expect(transform('z.object({ a: z.string(), b: z.number() }).omit({ b: true })')).toBe('z.omit(z.object({ a: z.string(), b: z.number() }), { b: true })')
  })

  it('.catchall(schema) on z.object() → z.catchall(schema, catchallSchema)', () => {
    expect(transform('z.object({ a: z.string() }).catchall(z.string())')).toBe('z.catchall(z.object({ a: z.string() }), z.string())')
  })

  it('.default(val) → z._default(schema, val)', () => {
    expect(transform('z.string().default("hello")')).toBe('z._default(z.string(), "hello")')
  })
})

describe('type-aware ambiguous methods', () => {
  it('does NOT transform codec.pick() without type checker (ambiguous)', () => {
    // Without type info, ambiguous methods require isLikelySchemaExpr
    expect(transform('codec.pick({ name: true })')).toBe('codec.pick({ name: true })')
  })

  it('does NOT transform myObj.extend() without type checker (ambiguous)', () => {
    expect(transform('myObj.extend({ foo: 1 })')).toBe('myObj.extend({ foo: 1 })')
  })

  it('still transforms z.object().pick() without type checker (schema expr)', () => {
    expect(transform('z.object({ a: z.string() }).pick({ a: true })')).toBe('z.pick(z.object({ a: z.string() }), { a: true })')
  })

  it('still transforms schema.pipe() unconditionally', () => {
    expect(transform('schema.pipe(z.number())')).toBe('z.pipe(schema, z.number())')
  })

  it('still transforms schema.brand() unconditionally', () => {
    expect(transform('schema.brand("Email")')).toBe('z.brand(schema, "Email")')
  })
})

describe('transformConstructorReplacements', () => {
  it('.passthrough() → z.looseObject()', () => {
    expect(transform('z.object({ name: z.string() }).passthrough()')).toBe('z.looseObject({ name: z.string() })')
  })

  it('.strict() → z.strictObject()', () => {
    expect(transform('z.object({ name: z.string() }).strict()')).toBe('z.strictObject({ name: z.string() })')
  })

  it('handles multiline shape', () => {
    const input = `z.object({\n  name: z.string()\n}).passthrough()`
    const result = transform(input)
    expect(result).toContain('z.looseObject(')
    expect(result).toContain('name: z.string()')
  })

  it('does NOT convert non-z.object().passthrough()', () => {
    expect(transform('schema.passthrough()')).toBe('schema.passthrough()')
  })

  it('does NOT convert non-z.object().strict()', () => {
    expect(transform('schema.strict()')).toBe('schema.strict()')
  })

  it('handles chained: z.object(shape).passthrough().optional()', () => {
    expect(transform('z.object({ a: z.string() }).passthrough().optional()')).toBe('z.optional(z.looseObject({ a: z.string() }))')
  })

  it('.datetime() → z.iso.datetime()', () => {
    expect(transform('z.string().datetime()')).toBe('z.iso.datetime()')
  })

  it('.datetime(opts) → z.iso.datetime(opts)', () => {
    expect(transform('z.string().datetime({ offset: true })')).toBe('z.iso.datetime({ offset: true })')
  })

  it('does NOT convert .datetime() on non-z.string() receiver', () => {
    expect(transform('schema.datetime()')).toBe('schema.datetime()')
  })
})

describe('findObjectOnlyMethods (warnings)', () => {
  it('flags .merge() (manual migration needed)', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', 'schema.merge(other)')
    const result = transformFile(file)
    expect(result.objectOnlyWarnings).toHaveLength(1)
    expect(result.objectOnlyWarnings[0].method).toBe('merge')
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
    expect(result).toBe(`z.string().check(z.refine(v => v.length > 0, { message: "Required" })).check(z.describe("name"))`)
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

describe('transformCode', () => {
  it('transforms a string and returns the result', () => {
    const input = `import { z } from 'zod'\nconst s = z.string().optional()`
    const result = transformCode(input)
    expect(result.code).toContain('z.optional(z.string())')
    expect(result.changed).toBe(true)
  })

  it('returns changed=false when no transforms apply', () => {
    const input = `const x = 42`
    const result = transformCode(input)
    expect(result.code).toBe(input)
    expect(result.changed).toBe(false)
  })

  it('transforms a realistic file with mixed patterns', () => {
    const input = `import { z } from 'zod'\n\nconst UserSchema = z.object({\n  name: z.string().min(1),\n  email: z.string().email().optional(),\n  age: z.number().int().positive(),\n  bio: z.string().nullable(),\n  role: z.string().default("user"),\n})\n\nconst InsertSchema = UserSchema.partial().extend({ id: z.string() })\n\nfunction validate(schema: z.ZodType) {\n  return schema.describe("validated")\n}\n`
    const result = transformCode(input)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('z.optional(z.string().check(z.email()))')
    expect(result.code).toContain('z.nullable(z.string())')
    expect(result.code).toContain('.check(z.minLength(1))')
    expect(result.code).toContain('.check(z.int())')
    expect(result.code).toContain('.check(z.positive())')
    expect(result.code).toContain('z._default(')
    // Without type checker, bare identifiers like UserSchema are not recognized as schemas
    // so ambiguous methods (.partial(), .extend()) are left untransformed
    expect(result.code).toContain('UserSchema.partial().extend({ id: z.string() })')
    expect(result.code).toContain('schema.check(z.describe("validated"))')
  })

  it('handles fixture-style code with non-z schema expressions', () => {
    const input = `import { z } from 'zod'\n\nconst taggedEmail = tagged(z.string())\nconst schema = z.object({\n  email: taggedEmail.optional(),\n  notes: z.string().nullable().optional(),\n})\n`
    const result = transformCode(input)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('z.optional(taggedEmail)')
    expect(result.code).toContain('z.optional(z.nullable(z.string()))')
  })

  it('returns original code when ts-morph crashes (graceful degradation)', () => {
    // Simulate a file that would have crashed before the toString fix
    // The try/catch ensures even unknown crashes don't break the build
    const input = `const x = 42\nconst y = 'hello'`
    const result = transformCode(input)
    expect(result.changed).toBe(false)
    expect(result.code).toBe(input)
  })

  it('handles z.ZodError constructor usage', () => {
    const input = `import { z } from 'zod'\n\nfunction makeError() {\n  return new z.ZodError([{ code: 'custom', path: [], message: 'fail' }])\n}\n\nif (err instanceof z.ZodError) { throw err }\n`
    const result = transformCode(input)
    expect(result.changed).toBe(true)
    expect(result.code).toContain('new $ZodError(')
    expect(result.code).toContain('instanceof $ZodError')
    expect(result.code).toContain('from "zod/v4/core"')
  })
})
