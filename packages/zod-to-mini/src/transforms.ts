/**
 * AST transforms for converting Zod v4 full syntax to zod/mini functional forms.
 *
 * Each transform handles one category of method-to-function conversion.
 * Transforms are applied repeatedly until no more changes are made (fixed-point).
 */
import { Project, type SourceFile, SyntaxKind, type CallExpression, type PropertyAccessExpression, type TypeChecker } from 'ts-morph'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the full text of a call expression's object (everything before the `.method()`).
 * For `z.string().optional()`, returns `z.string()`.
 */
function getCallObject(call: CallExpression): string | null {
  const expr = call.getExpression()
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return null
  const propAccess = expr as PropertyAccessExpression
  return propAccess.getExpression().getText()
}

/**
 * Get the method name from a call expression.
 * For `z.string().optional()`, returns `optional`.
 */
function getMethodName(call: CallExpression): string | null {
  const expr = call.getExpression()
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return null
  return (expr as PropertyAccessExpression).getName()
}

// ---------------------------------------------------------------------------
// Transform: method wrappers → functional wrappers
// .optional() → z.optional(expr)
// .nullable() → z.nullable(expr)
// ---------------------------------------------------------------------------

const WRAPPER_METHODS = ['optional', 'nullable'] as const

export function transformWrappers(file: SourceFile): number {
  let count = 0

  // Process innermost calls first by reversing (deepest nodes last in AST order)
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression).reverse()

  for (const call of calls) {
    if (call.wasForgotten()) continue
    const method = getMethodName(call)
    if (!method || !WRAPPER_METHODS.includes(method as any)) continue
    if (call.getArguments().length > 0) continue // .optional(value) is different

    const obj = getCallObject(call)
    if (!obj) continue

    // Replace `expr.optional()` → `z.optional(expr)`
    call.replaceWithText(`z.${method}(${obj})`)
    count++
  }

  return count
}

// ---------------------------------------------------------------------------
// Transform: string/number validation methods → .check()
// .email() → .check(z.email())
// .url() → .check(z.url())
// .min(n) → .check(z.minLength(n)) / .check(z.min(n))
// .max(n) → .check(z.maxLength(n)) / .check(z.max(n))
// .length(n) → .check(z.length(n))
// .regex(r) → .check(z.regex(r))
// .trim() → .check(z.trim())
// .toLowerCase() → .check(z.toLowerCase())
// .toUpperCase() → .check(z.toUpperCase())
// .startsWith(s) → .check(z.startsWith(s))
// .endsWith(s) → .check(z.endsWith(s))
// .includes(s) → .check(z.includes(s))
// .int() → .check(z.int())
// .positive() → .check(z.positive())
// .negative() → .check(z.negative())
// .nonnegative() → .check(z.nonnegative())
// .nonpositive() → .check(z.nonpositive())
// .multipleOf(n) → .check(z.multipleOf(n))
// .finite() → .check(z.finite()) — not in mini, but included for completeness
//
// Special cases:
// .min(n) on string → z.minLength(n)
// .max(n) on string → z.maxLength(n)
// .min(n) on number → z.min(n) (same name but standalone)
// .max(n) on number → z.max(n)
// ---------------------------------------------------------------------------

/** Identifiers that are Zod/zodvex namespaces, not schema expressions.
 *  Calls like `z.string()`, `zx.date()` are constructors, not method chains. */
const NAMESPACE_IDENTIFIERS = new Set(['z', 'zx', 'zm', 'zod'])

/** Returns true if the object expression is a bare namespace (z, zx, zm) */
function isNamespaceCall(obj: string): boolean {
  return NAMESPACE_IDENTIFIERS.has(obj.trim())
}

/** Check methods UNIQUE to Zod that have verified standalone z.methodName() equivalents.
 *  EXCLUDED: ip, cidr, datetime, duration, finite, safe — no standalone functions. */
const ZOD_ONLY_CHECK_METHODS = [
  'email', 'url', 'uuid', 'cuid', 'cuid2', 'ulid', 'nanoid',
  'emoji', 'base64', 'base64url', 'jwt',
  'int', 'positive', 'negative', 'nonnegative', 'nonpositive',
  'multipleOf',
] as const

/** Check methods that COLLIDE with standard JS methods (String.startsWith, etc.).
 *  Only convert these when the object expression is clearly a Zod schema chain
 *  (starts with z. or is a known schema construction pattern). */
const AMBIGUOUS_CHECK_METHODS = [
  'trim', 'toLowerCase', 'toUpperCase',
  'startsWith', 'endsWith', 'includes', 'regex',
  'length',
  'gt', 'gte', 'lt', 'lte',
] as const

/** Returns true if the object expression looks like a Zod schema chain */
function isLikelySchemaExpr(obj: string): boolean {
  // z.string(), z.number(), z.object({...}), z.array(...), etc.
  if (obj.match(/^z\.\w+\(/)) return true
  // zx.id(...), zx.date(), etc.
  if (obj.match(/^zx\.\w+\(/)) return true
  // Chained schema: something.check(...), z.optional(...)
  if (obj.match(/^z\.(optional|nullable)\(/)) return true
  return false
}

/**
 * Uses the TypeScript type checker to determine if the receiver of a method call
 * is a Zod schema. Checks for the `_zod` property which exists on every Zod schema
 * instance (both full zod and zod/mini).
 *
 * Returns:
 *  - `true`  — the receiver is confirmed to be a Zod schema
 *  - `false` — the receiver is confirmed to NOT be a Zod schema
 *  - `null`  — the type checker couldn't determine the type (e.g., `any`)
 *              Callers should fall back to the syntactic heuristic.
 */
function isZodSchemaByType(call: CallExpression, typeChecker: TypeChecker): boolean | null {
  const expr = call.getExpression()
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false
  const receiver = (expr as PropertyAccessExpression).getExpression()

  try {
    const type = typeChecker.getTypeAtLocation(receiver)
    // If the type resolved to `any`, the checker couldn't determine the actual type.
    // This happens after AST mutations (e.g., z.partial(...) is not in zod's type defs)
    // or for unresolvable expressions. Return null to signal "unknown".
    if (type.isAny()) return null
    return type.getProperties().some(p => p.getName() === '_zod')
  } catch {
    return null
  }
}

/** Methods that need renaming for string context */
const STRING_RENAME: Record<string, string> = {
  min: 'minLength',
  max: 'maxLength',
}

/** Number .min()/.max() → z.gte()/z.lte() (the standalone names differ from the method names) */
const NUMBER_RENAME: Record<string, string> = {
  min: 'gte',
  max: 'lte',
}

export function transformChecks(file: SourceFile): number {
  let count = 0
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression).reverse()

  for (const call of calls) {
    if (call.wasForgotten()) continue
    const method = getMethodName(call)
    if (!method) continue

    const obj = getCallObject(call)
    if (!obj) continue

    // Skip namespace calls (z.email() is a constructor, not a method chain)
    if (isNamespaceCall(obj)) continue

    const args = call.getArguments().map(a => a.getText())
    const argsStr = args.length > 0 ? args.join(', ') : ''

    // Zod-unique check methods — safe to convert unconditionally
    if ((ZOD_ONLY_CHECK_METHODS as readonly string[]).includes(method)) {
      call.replaceWithText(`${obj}.check(z.${method}(${argsStr}))`)
      count++
      continue
    }

    // Ambiguous methods — only convert when the object is clearly a schema
    if ((AMBIGUOUS_CHECK_METHODS as readonly string[]).includes(method) && isLikelySchemaExpr(obj)) {
      call.replaceWithText(`${obj}.check(z.${method}(${argsStr}))`)
      count++
      continue
    }

    // .min()/.max() — only on schema expressions, context-dependent rename
    if ((method === 'min' || method === 'max') && isLikelySchemaExpr(obj)) {
      const isString = obj.includes('z.string')
      const checkName = isString ? STRING_RENAME[method] : NUMBER_RENAME[method]
      call.replaceWithText(`${obj}.check(z.${checkName}(${argsStr}))`)
      count++
      continue
    }
  }

  return count
}

// ---------------------------------------------------------------------------
// Transform: schema methods → top-level functions
// schema.transform(fn) → z.transform(schema, fn)
// schema.refine(fn, opts) → schema.check(z.refine(fn, opts))
// schema.superRefine(fn) → schema.check(z.superRefine(fn))
// schema.describe(str) → schema.check(z.describe(str))
// schema.default(val) → z.default(schema, val) — NOT in mini, but transform anyway
// schema.pipe(other) → z.pipe(schema, other)
// schema.brand(tag) → z.brand(schema, tag)
// ---------------------------------------------------------------------------

/** Methods that become z.methodName(schema, ...args) — safe to transform unconditionally */
const UNCONDITIONAL_TOP_LEVEL = ['pipe', 'brand'] as const

/** Methods that become z.methodName(schema, ...args) — only transform when receiver is
 *  confirmed as a Zod schema. These method names collide with non-Zod APIs
 *  (e.g., ConvexCodec.pick(), Lodash.extend()). Without type info, we fall back to
 *  the isLikelySchemaExpr heuristic. */
const AMBIGUOUS_TOP_LEVEL = ['partial', 'extend', 'catchall', 'omit', 'pick'] as const

/** schema.default(val) → z._default(schema, val) — underscore-prefixed in mini */
const RENAMED_METHODS = new Map<string, string>([
  ['default', '_default'],
])

/** schema.transform(fn) → z.pipe(schema, z.transform(fn)) */
const TRANSFORM_METHOD = 'transform'

/** Methods that become schema.check(z.methodName(...args)) */
const CHECK_WRAP_METHODS = ['refine', 'superRefine', 'describe'] as const

export function transformMethods(file: SourceFile, typeChecker?: TypeChecker): number {
  let count = 0
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression).reverse()

  for (const call of calls) {
    if (call.wasForgotten()) continue
    const method = getMethodName(call)
    if (!method) continue

    const obj = getCallObject(call)
    if (!obj) continue

    // Skip namespace calls (z.transform() is a constructor, not a method chain)
    if (isNamespaceCall(obj)) continue

    const args = call.getArguments().map(a => a.getText())

    // Unconditional top-level: always safe to transform (no name collisions)
    if ((UNCONDITIONAL_TOP_LEVEL as readonly string[]).includes(method)) {
      const argsStr = args.length > 0 ? `, ${args.join(', ')}` : ''
      call.replaceWithText(`z.${method}(${obj}${argsStr})`)
      count++
      continue
    }

    // Ambiguous top-level: only transform when receiver is a Zod schema.
    if ((AMBIGUOUS_TOP_LEVEL as readonly string[]).includes(method)) {
      let isSchema: boolean
      if (typeChecker) {
        const typeResult = isZodSchemaByType(call, typeChecker)
        // true = confirmed schema, false = confirmed non-schema, null = unknown (any)
        // When the type checker returns null (couldn't resolve), fall back to the heuristic.
        // This happens after AST mutations create z.partial(...) etc. which don't exist in
        // zod's type definitions (they're zod/mini constructs).
        isSchema = typeResult === true || (typeResult === null && isLikelySchemaExpr(obj))
      } else {
        isSchema = isLikelySchemaExpr(obj)
      }
      if (!isSchema) continue

      const argsStr = args.length > 0 ? `, ${args.join(', ')}` : ''
      call.replaceWithText(`z.${method}(${obj}${argsStr})`)
      count++
      continue
    }

    // Renamed methods: schema.default(val) → z._default(schema, val)
    if (RENAMED_METHODS.has(method)) {
      const newName = RENAMED_METHODS.get(method)!
      const argsStr = args.length > 0 ? `, ${args.join(', ')}` : ''
      call.replaceWithText(`z.${newName}(${obj}${argsStr})`)
      count++
      continue
    }

    // schema.transform(fn) → z.pipe(schema, z.transform(fn))
    if (method === TRANSFORM_METHOD) {
      const argsStr = args.join(', ')
      call.replaceWithText(`z.pipe(${obj}, z.transform(${argsStr}))`)
      count++
      continue
    }

    // Check-wrap form: schema.method(args) → schema.check(z.method(args))
    if ((CHECK_WRAP_METHODS as readonly string[]).includes(method)) {
      const argsStr = args.join(', ')
      call.replaceWithText(`${obj}.check(z.${method}(${argsStr}))`)
      count++
      continue
    }

  }

  return count
}

// ---------------------------------------------------------------------------
// Transform: constructor-replacing methods
// z.object(shape).passthrough() → z.looseObject(shape)
// z.object(shape).strict() → z.strictObject(shape)
//
// These change the constructor, so the object expression MUST be z.object(shape).
// We extract the shape argument from z.object() and emit the replacement constructor.
// ---------------------------------------------------------------------------

const CONSTRUCTOR_REPLACEMENTS: Record<string, string> = {
  passthrough: 'looseObject',
  strict: 'strictObject',
}

export function transformConstructorReplacements(file: SourceFile): number {
  let count = 0
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression).reverse()

  for (const call of calls) {
    if (call.wasForgotten()) continue
    const method = getMethodName(call)
    if (!method) continue

    const obj = getCallObject(call)
    if (!obj) continue

    // z.object(shape).passthrough() → z.looseObject(shape)
    // z.object(shape).strict() → z.strictObject(shape)
    if (method in CONSTRUCTOR_REPLACEMENTS && call.getArguments().length === 0) {
      // Must be z.object(shape) — allow optional whitespace between z and .object(
      const match = obj.match(/^z\s*\.object\(([\s\S]*)\)$/)
      if (!match) continue

      const shape = match[1]
      const replacement = CONSTRUCTOR_REPLACEMENTS[method]
      call.replaceWithText(`z.${replacement}(${shape})`)
      count++
      continue
    }

    // z.string().datetime(opts?) → z.iso.datetime(opts?)
    // In zod/mini, .datetime() is not a method on string — it's z.iso.datetime().
    if (method === 'datetime' && /^z\s*\.string\(\s*\)$/.test(obj)) {
      const args = call.getArguments().map(a => a.getText())
      const argsStr = args.length > 0 ? args.join(', ') : ''
      call.replaceWithText(`z.iso.datetime(${argsStr})`)
      count++
      continue
    }
  }

  return count
}

// ---------------------------------------------------------------------------
// Warnings: methods that need manual attention
// ---------------------------------------------------------------------------

/** Methods that need manual attention — not auto-convertible */
const WARN_METHODS = [
  'merge',        // use z.extend() or spread
] as const

export function findObjectOnlyMethods(file: SourceFile): Array<{ line: number; method: string; text: string }> {
  const results: Array<{ line: number; method: string; text: string }> = []
  const calls = file.getDescendantsOfKind(SyntaxKind.CallExpression)

  for (const call of calls) {
    const method = getMethodName(call)
    if (!method || !(WARN_METHODS as readonly string[]).includes(method)) continue
    results.push({
      line: call.getStartLineNumber(),
      method,
      text: call.getText().slice(0, 80),
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Transform: import paths
// import { z } from 'zod' → import { z } from 'zod/mini'
// import { ZodError } from 'zod' → import { ZodError } from 'zod/mini'
// ---------------------------------------------------------------------------

export function transformImports(file: SourceFile): number {
  let count = 0
  const imports = file.getImportDeclarations()

  for (const imp of imports) {
    const moduleSpecifier = imp.getModuleSpecifierValue()
    if (moduleSpecifier === 'zod') {
      imp.setModuleSpecifier('zod/mini')
      count++
    }
  }

  return count
}

// ---------------------------------------------------------------------------
// Transform: class references
// z.ZodError → $ZodError (+ add import from zod/v4/core)
// z.ZodObject → $ZodObject
// z.ZodType → $ZodType
// z.ZodTypeAny → $ZodType
// etc.
// ---------------------------------------------------------------------------

const CLASS_RENAMES: Record<string, string> = {
  'z.ZodError': '$ZodError',
  'z.ZodType': '$ZodType',
  'z.ZodTypeAny': '$ZodType',
  'z.ZodRawShape': '$ZodShape',
  'z.ZodObject': '$ZodObject',
  'z.ZodArray': '$ZodArray',
  'z.ZodString': '$ZodString',
  'z.ZodNumber': '$ZodNumber',
  'z.ZodBoolean': '$ZodBoolean',
  'z.ZodOptional': '$ZodOptional',
  'z.ZodNullable': '$ZodNullable',
  'z.ZodUnion': '$ZodUnion',
  'z.ZodEnum': '$ZodEnum',
  'z.ZodLiteral': '$ZodLiteral',
  'z.ZodCodec': '$ZodCodec',
  'z.ZodCustom': '$ZodCustom',
  'z.ZodDefault': '$ZodDefault',
  'z.ZodRecord': '$ZodRecord',
  'z.ZodTuple': '$ZodTuple',
  'z.ZodDiscriminatedUnion': '$ZodDiscriminatedUnion',
  'z.ZodLazy': '$ZodLazy',
  'z.ZodPipe': '$ZodPipe',
  'z.ZodTransform': '$ZodTransform',
}

export function transformClassRefs(file: SourceFile): number {
  let count = 0
  const neededImports = new Set<string>()

  // Find runtime property access expressions like z.ZodError in `instanceof z.ZodError`
  const propAccesses = file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)

  for (const pa of propAccesses) {
    if (pa.wasForgotten()) continue
    const text = pa.getText()
    const replacement = CLASS_RENAMES[text]
    if (!replacement) continue

    pa.replaceWithText(replacement)
    neededImports.add(replacement)
    count++
  }

  // Find type-level qualified names like z.ZodType in `function foo(x: z.ZodType)`
  // These are QualifiedName nodes in the AST, distinct from PropertyAccessExpression.
  const qualNames = file.getDescendantsOfKind(SyntaxKind.QualifiedName)

  for (const qn of qualNames) {
    if (qn.wasForgotten()) continue
    const text = qn.getText()
    const replacement = CLASS_RENAMES[text]
    if (!replacement) continue

    qn.replaceWithText(replacement)
    neededImports.add(replacement)
    count++
  }

  // Add import for the core types if needed
  if (neededImports.size > 0) {
    const existingCoreImport = file.getImportDeclaration(d =>
      d.getModuleSpecifierValue() === 'zod/v4/core'
    )

    if (existingCoreImport) {
      // Add to existing import
      for (const name of neededImports) {
        if (!existingCoreImport.getNamedImports().some(n => n.getName() === name)) {
          existingCoreImport.addNamedImport(name)
        }
      }
    } else {
      // Check for ../src/zod-core import (internal zodvex tests)
      const internalImport = file.getImportDeclaration(d =>
        d.getModuleSpecifierValue().endsWith('/zod-core')
      )
      if (internalImport) {
        for (const name of neededImports) {
          if (!internalImport.getNamedImports().some(n => n.getName() === name)) {
            internalImport.addNamedImport(name)
          }
        }
      } else {
        // Add new import
        file.addImportDeclaration({
          moduleSpecifier: 'zod/v4/core',
          namedImports: [...neededImports].sort(),
        })
      }
    }
  }

  return count
}

// ---------------------------------------------------------------------------
// Main: apply all transforms in fixed-point loop
// ---------------------------------------------------------------------------

export interface TransformResult {
  filePath: string
  constructorReplacements: number
  wrappers: number
  checks: number
  methods: number
  imports: number
  classRefs: number
  objectOnlyWarnings: Array<{ line: number; method: string; text: string }>
  totalChanges: number
}

export function transformFile(file: SourceFile, typeChecker?: TypeChecker): TransformResult {
  const filePath = file.getFilePath()
  let constructorReplacements = 0
  let wrappers = 0
  let checks = 0
  let methods = 0

  // Fixed-point loop: transforms may create new opportunities
  // (e.g., unwrapping .optional() reveals .email() underneath)
  for (let i = 0; i < 10; i++) {
    // Constructor replacements FIRST — they change z.object(shape).passthrough()
    // into z.looseObject(shape), which may then have .optional() etc. on the outside
    const cr = transformConstructorReplacements(file)
    const w = transformWrappers(file)
    const c = transformChecks(file)
    const m = transformMethods(file, typeChecker)
    constructorReplacements += cr
    wrappers += w
    checks += c
    methods += m
    if (cr + w + c + m === 0) break
  }

  const classRefs = transformClassRefs(file)
  const objectOnlyWarnings = findObjectOnlyMethods(file)

  // Import transform is done LAST (after all other transforms)
  // so we don't accidentally affect the transform logic
  // NOTE: We do NOT transform imports by default — the caller decides
  const imports = 0

  return {
    filePath,
    constructorReplacements,
    wrappers,
    checks,
    methods,
    imports,
    classRefs,
    objectOnlyWarnings,
    totalChanges: constructorReplacements + wrappers + checks + methods + classRefs,
  }
}

// ---------------------------------------------------------------------------
// String-in/string-out convenience wrapper
// ---------------------------------------------------------------------------

/**
 * String-in/string-out transform wrapper.
 * Creates an in-memory ts-morph project, applies all transforms, returns the result.
 *
 * If ts-morph throws during transformation (e.g., a manipulation error from an
 * unhandled code pattern), the original code is returned unchanged. This ensures
 * the vite plugin never crashes the build — the file simply runs un-transformed.
 */
export function transformCode(
  code: string,
  options?: { filename?: string; project?: Project }
): { code: string; changed: boolean } {
  try {
    const project = options?.project ?? new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: false },
    })
    const filename = options?.filename ?? 'transform.ts'
    const file = project.createSourceFile(filename, code, { overwrite: true })

    const typeChecker = options?.project
      ? project.getTypeChecker()
      : undefined

    const result = transformFile(file, typeChecker)
    const transformed = file.getFullText()

    // Clean up the source file from the project if we're reusing it
    if (options?.project) {
      project.removeSourceFile(file)
    }

    return {
      code: transformed,
      changed: result.totalChanges > 0,
    }
  } catch (err) {
    const filename = options?.filename ?? 'unknown'
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[zod-to-mini] Transform failed for ${filename}, returning original code: ${message}`)
    return { code, changed: false }
  }
}
