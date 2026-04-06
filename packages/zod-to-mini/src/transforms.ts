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

/** Methods that become z.methodName(schema, ...args) — safe to transform unconditionally.
 *  `parse` and `safeParse` exist as instance methods on mini schemas at runtime, but
 *  `$ZodType` from `zod/v4/core` doesn't declare them in its interface. Transforming to
 *  the functional form `z.parse(schema, value)` works at both the type AND runtime level
 *  and is the recommended idiom in mini. */
const UNCONDITIONAL_TOP_LEVEL = ['pipe', 'brand', 'parse', 'safeParse'] as const

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

    // schema.unwrap() → schema._zod.def.innerType
    // .unwrap() on ZodOptional/ZodNullable returns the inner type.
    // In mini, the accessor is the internal ._zod.def.innerType property.
    if (method === 'unwrap' && call.getArguments().length === 0) {
      call.replaceWithText(`${obj}._zod.def.innerType`)
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
// Transform: internal property accessors
// schema.shape → schema._zod.def.shape
// schema.element → schema._zod.def.element
// schema.options → schema._zod.def.options
//
// These are property accesses (not method calls) that exist on full-zod schemas
// but not on zod/mini schemas. The mini equivalent accesses the internal _zod.def.
//
// Because .shape, .element, .options are common property names, we only auto-
// transform when the type checker confirms the receiver is a Zod schema.
// Without type info, we emit warnings instead.
// ---------------------------------------------------------------------------

/** Property names that are Zod schema accessors in full zod but not in mini */
const INTERNAL_PROPERTY_ACCESSORS: Record<string, string> = {
  shape: '_zod.def.shape',
  element: '_zod.def.element',
  options: '_zod.def.options',
}

/**
 * Uses the TypeScript type checker to determine if the receiver of a property
 * access is a Zod schema. Same logic as isZodSchemaByType but for PropertyAccessExpression
 * instead of CallExpression.
 */
function isZodSchemaByTypePA(pa: PropertyAccessExpression, typeChecker: TypeChecker): boolean | null {
  const receiver = pa.getExpression()
  try {
    const type = typeChecker.getTypeAtLocation(receiver)
    if (type.isAny()) return null
    return type.getProperties().some(p => p.getName() === '_zod')
  } catch {
    return null
  }
}

export function transformPropertyAccessors(file: SourceFile, typeChecker?: TypeChecker): number {
  let count = 0
  const propAccesses = file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).reverse()

  for (const pa of propAccesses) {
    if (pa.wasForgotten()) continue
    const propName = pa.getName()
    const replacement = INTERNAL_PROPERTY_ACCESSORS[propName]
    if (!replacement) continue

    const receiver = pa.getExpression()
    const receiverText = receiver.getText()

    // Skip namespace calls like z.shape (shouldn't happen but be safe)
    if (NAMESPACE_IDENTIFIERS.has(receiverText.trim())) continue

    // Skip if this is already an internal access (e.g., foo._zod.def.shape)
    // Check both "contains" (for deeply nested) and "ends with" (the receiver of
    // ._zod.def.shape is "foo._zod.def" which ends with but doesn't contain "._zod.def.")
    if (receiverText.includes('._zod.def.') || receiverText.endsWith('._zod.def')) continue

    // Determine if receiver is a Zod schema
    let isSchema: boolean
    if (typeChecker) {
      const typeResult = isZodSchemaByTypePA(pa, typeChecker)
      isSchema = typeResult === true || (typeResult === null && isLikelySchemaExpr(receiverText))
    } else {
      isSchema = isLikelySchemaExpr(receiverText)
    }

    if (!isSchema) continue

    pa.replaceWithText(`${receiverText}.${replacement}`)
    count++
  }

  return count
}

/**
 * Find property accesses that may need manual migration (.shape, .element, .options)
 * when the type checker can't confirm the receiver is a Zod schema.
 */
export function findInternalPropertyAccess(
  file: SourceFile,
  typeChecker?: TypeChecker,
): Array<{ line: number; property: string; text: string }> {
  const results: Array<{ line: number; property: string; text: string }> = []
  const propAccesses = file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)

  for (const pa of propAccesses) {
    if (pa.wasForgotten()) continue
    const propName = pa.getName()
    if (!(propName in INTERNAL_PROPERTY_ACCESSORS)) continue

    const receiver = pa.getExpression()
    const receiverText = receiver.getText()

    // Skip namespace and already-internal accesses
    if (NAMESPACE_IDENTIFIERS.has(receiverText.trim())) continue
    if (receiverText.includes('._zod.def.') || receiverText.endsWith('._zod.def')) continue

    // Skip if already transformed by transformPropertyAccessors (heuristic matched)
    if (isLikelySchemaExpr(receiverText)) continue

    // If type checker says it's definitely not a schema, skip the warning
    if (typeChecker) {
      const typeResult = isZodSchemaByTypePA(pa, typeChecker)
      if (typeResult === false) continue
    }

    results.push({
      line: pa.getStartLineNumber(),
      property: propName,
      text: pa.getText().slice(0, 80),
    })
  }

  return results
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
  'z.ZodReadonly': '$ZodReadonly',
}

export function transformClassRefs(file: SourceFile): number {
  let count = 0
  /** Names that appear in runtime (value) positions — need regular `import` */
  const runtimeImports = new Set<string>()
  /** Names that appear ONLY in type positions — can use `import type` */
  const typeOnlyImports = new Set<string>()

  // Find runtime property access expressions like z.ZodError in `instanceof z.ZodError`
  const propAccesses = file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)

  for (const pa of propAccesses) {
    if (pa.wasForgotten()) continue
    const text = pa.getText()
    const replacement = CLASS_RENAMES[text]
    if (!replacement) continue

    pa.replaceWithText(replacement)
    runtimeImports.add(replacement)
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
    // Only type-only if NOT also seen in a runtime position
    if (!runtimeImports.has(replacement)) {
      typeOnlyImports.add(replacement)
    }
    count++
  }

  // Reconcile: if a name is in both sets, it must be a runtime import
  for (const name of runtimeImports) {
    typeOnlyImports.delete(name)
  }

  // Helper: add named imports to an existing import declaration
  const addToExistingImport = (imp: ReturnType<SourceFile['getImportDeclaration']>, names: Set<string>) => {
    if (!imp) return
    for (const name of names) {
      if (!imp.getNamedImports().some(n => n.getName() === name)) {
        imp.addNamedImport(name)
      }
    }
  }

  // Add runtime imports (regular `import`)
  if (runtimeImports.size > 0) {
    const existingCoreImport = file.getImportDeclaration(d =>
      d.getModuleSpecifierValue() === 'zod/v4/core' && !d.isTypeOnly()
    )

    if (existingCoreImport) {
      addToExistingImport(existingCoreImport, runtimeImports)
    } else {
      const internalImport = file.getImportDeclaration(d =>
        d.getModuleSpecifierValue().endsWith('/zod-core') && !d.isTypeOnly()
      )
      if (internalImport) {
        addToExistingImport(internalImport, runtimeImports)
      } else {
        file.addImportDeclaration({
          moduleSpecifier: 'zod/v4/core',
          namedImports: [...runtimeImports].sort(),
        })
      }
    }
  }

  // Add type-only imports (`import type`)
  if (typeOnlyImports.size > 0) {
    const existingTypeImport = file.getImportDeclaration(d =>
      d.getModuleSpecifierValue() === 'zod/v4/core' && d.isTypeOnly()
    )

    if (existingTypeImport) {
      addToExistingImport(existingTypeImport, typeOnlyImports)
    } else {
      const internalTypeImport = file.getImportDeclaration(d =>
        d.getModuleSpecifierValue().endsWith('/zod-core') && d.isTypeOnly()
      )
      if (internalTypeImport) {
        addToExistingImport(internalTypeImport, typeOnlyImports)
      } else {
        file.addImportDeclaration({
          moduleSpecifier: 'zod/v4/core',
          namedImports: [...typeOnlyImports].sort(),
          isTypeOnly: true,
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
  propertyAccessors: number
  imports: number
  classRefs: number
  objectOnlyWarnings: Array<{ line: number; method: string; text: string }>
  propertyAccessWarnings: Array<{ line: number; property: string; text: string }>
  totalChanges: number
}

export function transformFile(file: SourceFile, typeChecker?: TypeChecker): TransformResult {
  const filePath = file.getFilePath()
  let constructorReplacements = 0
  let wrappers = 0
  let checks = 0
  let methods = 0
  let propertyAccessors = 0

  // Fixed-point loop: transforms may create new opportunities
  // (e.g., unwrapping .optional() reveals .email() underneath)
  for (let i = 0; i < 10; i++) {
    // Constructor replacements FIRST — they change z.object(shape).passthrough()
    // into z.looseObject(shape), which may then have .optional() etc. on the outside
    const cr = transformConstructorReplacements(file)
    const w = transformWrappers(file)
    const c = transformChecks(file)
    const m = transformMethods(file, typeChecker)
    const pa = transformPropertyAccessors(file, typeChecker)
    constructorReplacements += cr
    wrappers += w
    checks += c
    methods += m
    propertyAccessors += pa
    if (cr + w + c + m + pa === 0) break
  }

  const classRefs = transformClassRefs(file)
  const objectOnlyWarnings = findObjectOnlyMethods(file)
  const propertyAccessWarnings = findInternalPropertyAccess(file, typeChecker)

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
    propertyAccessors,
    imports,
    classRefs,
    objectOnlyWarnings,
    propertyAccessWarnings,
    totalChanges: constructorReplacements + wrappers + checks + methods + propertyAccessors + classRefs,
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
