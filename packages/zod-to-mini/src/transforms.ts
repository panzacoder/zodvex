/**
 * AST transforms for converting Zod v4 full syntax to zod/mini functional forms.
 *
 * Each transform handles one category of method-to-function conversion.
 * Transforms are applied repeatedly until no more changes are made (fixed-point).
 */
import { type SourceFile, SyntaxKind, type CallExpression, type PropertyAccessExpression } from 'ts-morph'

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

/** Methods that become z.methodName(schema, ...args) */
const TOP_LEVEL_METHODS = [
  'describe', 'pipe', 'brand',
  'partial', 'extend', 'catchall', 'omit', 'pick',
] as const

/** schema.default(val) → z._default(schema, val) — underscore-prefixed in mini */
const RENAMED_METHODS: Record<string, string> = {
  'default': '_default',
}

/** schema.transform(fn) → z.pipe(schema, z.transform(fn)) */
const TRANSFORM_METHOD = 'transform'

/** Methods that become schema.check(z.methodName(...args)) */
const CHECK_WRAP_METHODS = ['refine', 'superRefine'] as const

export function transformMethods(file: SourceFile): number {
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

    // Top-level function form: schema.method(args) → z.method(schema, args)
    if ((TOP_LEVEL_METHODS as readonly string[]).includes(method)) {
      const argsStr = args.length > 0 ? `, ${args.join(', ')}` : ''
      call.replaceWithText(`z.${method}(${obj}${argsStr})`)
      count++
      continue
    }

    // Renamed methods: schema.default(val) → z._default(schema, val)
    if (method in RENAMED_METHODS) {
      const newName = RENAMED_METHODS[method]
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

    // schema.passthrough() → z.looseObject (deprecated, needs manual rewrite)
    // schema.strict() → z.strictObject (deprecated, needs manual rewrite)
    // These change the constructor, not a wrapper — can't auto-convert
  }

  return count
}

// ---------------------------------------------------------------------------
// Warnings: methods that need manual attention
// .passthrough() / .strict() are deprecated → z.looseObject() / z.strictObject()
//   These change the schema constructor, not just wrap it.
// .datetime() → z.iso.datetime() — different namespace path
// ---------------------------------------------------------------------------

/** Methods that need manual attention — not auto-convertible */
const WARN_METHODS = [
  'passthrough',  // deprecated → z.looseObject()
  'strict',       // deprecated → z.strictObject()
  'merge',        // use z.extend() or spread
  'datetime',     // → z.iso.datetime() (different namespace)
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
}

export function transformClassRefs(file: SourceFile): number {
  let count = 0
  const neededImports = new Set<string>()

  // Find all property access expressions like z.ZodError
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
  wrappers: number
  checks: number
  methods: number
  imports: number
  classRefs: number
  objectOnlyWarnings: Array<{ line: number; method: string; text: string }>
  totalChanges: number
}

export function transformFile(file: SourceFile): TransformResult {
  const filePath = file.getFilePath()
  let wrappers = 0
  let checks = 0
  let methods = 0

  // Fixed-point loop: transforms may create new opportunities
  // (e.g., unwrapping .optional() reveals .email() underneath)
  for (let i = 0; i < 10; i++) {
    const w = transformWrappers(file)
    const c = transformChecks(file)
    const m = transformMethods(file)
    wrappers += w
    checks += c
    methods += m
    if (w + c + m === 0) break
  }

  const classRefs = transformClassRefs(file)
  const objectOnlyWarnings = findObjectOnlyMethods(file)

  // Import transform is done LAST (after all other transforms)
  // so we don't accidentally affect the transform logic
  // NOTE: We do NOT transform imports by default — the caller decides
  const imports = 0

  return {
    filePath,
    wrappers,
    checks,
    methods,
    imports,
    classRefs,
    objectOnlyWarnings,
    totalChanges: wrappers + checks + methods + classRefs,
  }
}
