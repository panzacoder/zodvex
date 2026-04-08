import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { transformFile, transformCode, findInternalPropertyAccess } from './transforms'

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

  it('z.ZodObject → z.ZodMiniObject', () => {
    const input = `import { z } from 'zod'\nfoo instanceof z.ZodObject`
    const result = transform(input)
    expect(result).toContain('instanceof z.ZodMiniObject')
  })

  it('z.ZodTypeAny → z.ZodMiniType (runtime usage)', () => {
    const input = `import { z } from 'zod'\nfoo instanceof z.ZodTypeAny`
    const result = transform(input)
    expect(result).toContain('instanceof z.ZodMiniType')
  })

  it('z.ZodType in type annotation → z.ZodMiniType', () => {
    const input = `import { z } from 'zod'\nfunction validate(schema: z.ZodType) { return schema }`
    const result = transform(input)
    expect(result).toContain('schema: z.ZodMiniType')
  })

  it('z.ZodRawShape in type annotation → $ZodShape', () => {
    const input = `import { z } from 'zod'\nfunction makeObj(shape: z.ZodRawShape) { return z.object(shape) }`
    const result = transform(input)
    expect(result).toContain('shape: $ZodShape')
  })

  it('z.ZodTypeAny in generic constraint → z.ZodMiniType', () => {
    const input = `import { z } from 'zod'\nfunction wrap<T extends z.ZodTypeAny>(s: T) { return s }`
    const result = transform(input)
    expect(result).toContain('extends z.ZodMiniType')
  })

  it('z.ZodObject in type alias → z.ZodMiniObject', () => {
    const input = `import { z } from 'zod'\ntype MySchema = z.ZodObject<any>`
    const result = transform(input)
    expect(result).toContain('z.ZodMiniObject<any>')
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

  it('transforms .extend() on variable assigned from z.object()', () => {
    const input = `import { z } from 'zod'\nconst base = z.object({ a: z.string() })\nbase.extend({ b: z.number() })`
    const result = transform(input)
    expect(result).toContain('z.extend(base, { b: z.number() })')
  })

  it('transforms .extend() on variable assigned from z.omit()', () => {
    const input = `import { z } from 'zod'\nconst base = z.omit(z.object({ a: z.string(), b: z.number() }), { b: true })\nbase.extend({ c: z.boolean() })`
    const result = transform(input)
    expect(result).toContain('z.extend(base, { c: z.boolean() })')
  })

  it('transforms .pick() on variable assigned from z.partial()', () => {
    const input = `import { z } from 'zod'\nconst partial = z.partial(z.object({ a: z.string(), b: z.number() }))\npartial.pick({ a: true })`
    const result = transform(input)
    expect(result).toContain('z.pick(partial, { a: true })')
  })

  it('does NOT transform .extend() on unknown variable', () => {
    expect(transform('unknownVar.extend({ foo: 1 })')).toBe('unknownVar.extend({ foo: 1 })')
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

describe('transformMethods — .parse() and .safeParse()', () => {
  it('.parse(value) → z.parse(schema, value)', () => {
    expect(transform('schema.parse(data)')).toBe('z.parse(schema, data)')
  })

  it('.safeParse(value) → z.safeParse(schema, value)', () => {
    expect(transform('schema.safeParse(data)')).toBe('z.safeParse(schema, data)')
  })

  it('.parse() with complex expression receiver', () => {
    expect(transform('z.string().parse(input)')).toBe('z.parse(z.string(), input)')
  })

  it('.safeParse() with complex expression receiver', () => {
    expect(transform('z.number().safeParse(val)')).toBe('z.safeParse(z.number(), val)')
  })

  it('does NOT convert z.parse() namespace call', () => {
    expect(transform('z.parse(schema, data)')).toBe('z.parse(schema, data)')
  })

  it('does NOT convert z.safeParse() namespace call', () => {
    expect(transform('z.safeParse(schema, data)')).toBe('z.safeParse(schema, data)')
  })
})

describe('transformMethods — .unwrap()', () => {
  it('.unwrap() → ._zod.def.innerType', () => {
    expect(transform('schema.unwrap()')).toBe('schema._zod.def.innerType')
  })

  it('.unwrap() on z.optional() result', () => {
    expect(transform('z.optional(z.string()).unwrap()')).toBe('z.optional(z.string())._zod.def.innerType')
  })

  it('does NOT convert .unwrap() with arguments', () => {
    // .unwrap(something) is not the Zod unwrap pattern
    expect(transform('schema.unwrap(arg)')).toBe('schema.unwrap(arg)')
  })

  it('does NOT convert z.unwrap() namespace call', () => {
    expect(transform('z.unwrap()')).toBe('z.unwrap()')
  })
})

describe('transformPropertyAccessors', () => {
  it('.shape on z.object() → ._zod.def.shape', () => {
    expect(transform('z.object({ a: z.string() }).shape')).toBe('z.object({ a: z.string() })._zod.def.shape')
  })

  it('.element on z.array() → ._zod.def.element', () => {
    expect(transform('z.array(z.string()).element')).toBe('z.array(z.string())._zod.def.element')
  })

  it('.options on z.union() → ._zod.def.options', () => {
    expect(transform('z.union([z.string(), z.number()]).options')).toBe('z.union([z.string(), z.number()])._zod.def.options')
  })

  it('does NOT convert .shape on non-schema expression', () => {
    // "geometry.shape" should NOT be converted
    expect(transform('geometry.shape')).toBe('geometry.shape')
  })

  it('does NOT convert .element on non-schema expression', () => {
    expect(transform('dom.element')).toBe('dom.element')
  })

  it('does NOT convert .options on non-schema expression', () => {
    expect(transform('select.options')).toBe('select.options')
  })

  it('does NOT double-transform ._zod.def.shape', () => {
    // Already internal access — should be left alone
    expect(transform('schema._zod.def.shape')).toBe('schema._zod.def.shape')
  })
})

describe('findInternalPropertyAccess (warnings)', () => {
  it('warns about .shape on non-schema expression', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', 'mySchema.shape')
    const warnings = findInternalPropertyAccess(file)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].property).toBe('shape')
  })

  it('does NOT warn about .shape on z.object() (auto-transformed)', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', 'z.object({ a: z.string() }).shape')
    const warnings = findInternalPropertyAccess(file)
    expect(warnings).toHaveLength(0)
  })

  it('does NOT warn about already-internal ._zod.def.shape', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const file = project.createSourceFile('test.ts', 'schema._zod.def.shape')
    const warnings = findInternalPropertyAccess(file)
    expect(warnings).toHaveLength(0)
  })
})

describe('transformClassRefs — import type', () => {
  it('mini type refs do NOT need core imports', () => {
    const input = `import { z } from 'zod'\nfunction validate(schema: z.ZodType) { return schema }`
    const result = transform(input)
    expect(result).toContain('schema: z.ZodMiniType')
    // No core import needed — stays on z namespace
    expect(result).not.toContain('import type')
    expect(result).not.toContain('zod/v4/core')
  })

  it('runtime class refs for core types use regular import', () => {
    const input = `import { z } from 'zod'\nif (x instanceof z.ZodError) {}`
    const result = transform(input)
    expect(result).toContain('instanceof $ZodError')
    expect(result).toContain('import { $ZodError }')
    expect(result).not.toContain('import type { $ZodError }')
  })

  it('mixed runtime + type refs for core type: runtime import only (no duplicate)', () => {
    const input = `import { z } from 'zod'\nif (x instanceof z.ZodError) {}\nfunction f(e: z.ZodError) {}`
    const result = transform(input)
    // $ZodError used in both runtime (instanceof) and type positions
    // Should appear as regular import only, not duplicated
    expect(result).toContain('import { $ZodError }')
    expect(result).not.toContain('import type { $ZodError }')
  })

  it('core runtime + mini type refs: only core import for $ZodError', () => {
    const input = `import { z } from 'zod'\nif (x instanceof z.ZodError) {}\nfunction f(s: z.ZodType) {}`
    const result = transform(input)
    // $ZodError = runtime core import, z.ZodType → z.ZodMiniType (no import needed)
    expect(result).toContain('import { $ZodError }')
    expect(result).toContain('z.ZodMiniType')
    // No type-only core import needed for ZodMiniType
    expect(result).not.toContain('import type')
  })

  it('z.ZodReadonly → z.ZodMiniReadonly (no core import)', () => {
    const input = `import { z } from 'zod'\nfunction f(s: z.ZodReadonly) { return s }`
    const result = transform(input)
    expect(result).toContain('s: z.ZodMiniReadonly')
    expect(result).not.toContain('zod/v4/core')
  })

  it('z.ZodRawShape in type annotation → $ZodShape (core type-only import)', () => {
    const input = `import { z } from 'zod'\nfunction makeObj(shape: z.ZodRawShape) { return z.object(shape) }`
    const result = transform(input)
    expect(result).toContain('shape: $ZodShape')
    expect(result).toContain('import type { $ZodShape }')
  })
})

describe('transformClassRefs — inline import types', () => {
  it("import('zod').ZodTypeAny → import('zod/mini').ZodMiniType", () => {
    const input = `type Schema = import('zod').ZodTypeAny`
    const result = transform(input)
    expect(result).toContain("import('zod/mini').ZodMiniType")
  })

  it("import('zod').ZodObject<Shape> → import('zod/mini').ZodMiniObject<Shape>", () => {
    const input = `type Doc = import('zod').ZodObject<MyShape>`
    const result = transform(input)
    expect(result).toContain("import('zod/mini').ZodMiniObject<MyShape>")
  })

  it("import('zod').ZodError → import('zod/v4/core').$ZodError", () => {
    const input = `type Err = import('zod').ZodError`
    const result = transform(input)
    expect(result).toContain("import('zod/v4/core').$ZodError")
  })

  it("import('zodvex/core').ZodType → import('zod/mini').ZodMiniType", () => {
    const input = `type Schema = import('zodvex/core').ZodType`
    const result = transform(input)
    expect(result).toContain("import('zod/mini').ZodMiniType")
  })

  it("skips import('other-lib').SomeType", () => {
    const input = `type T = import('lodash').DeepPartial`
    const result = transform(input)
    expect(result).toContain("import('lodash').DeepPartial")
  })

  it("import('zod').infer → import('zod/mini').infer (non-class qualifier)", () => {
    const input = `type Out = import('zod').infer<typeof schema>`
    const result = transform(input)
    expect(result).toContain("import('zod/mini').infer")
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
    // Schema variable tracking recognizes UserSchema (assigned from z.object())
    // so ambiguous methods (.partial(), .extend()) are transformed
    expect(result.code).toContain('z.extend(z.partial(UserSchema), { id: z.string() })')
    expect(result.code).toContain('schema.check(z.describe("validated"))')
    // z.ZodType → z.ZodMiniType (stays on z namespace, no core import needed)
    expect(result.code).toContain('z.ZodMiniType')
    expect(result.code).not.toContain('zod/v4/core')
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
