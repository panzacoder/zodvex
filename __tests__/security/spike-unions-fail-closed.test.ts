/**
 * Spike 3: Unions/discriminated unions cannot bypass sensitive traversal/transforms
 *
 * Goal: Ensure that:
 * 1. Sensitive fields in any union variant are always detected
 * 2. Discriminated unions are traversed correctly
 * 3. Nested unions with sensitive fields are handled
 * 4. No path should leak raw values - must fail closed
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

// --- Metadata + sensitive() marker (from Spike 1) ---

const SENSITIVE_META_KEY = 'zodvex:sensitive'

interface SensitiveMetadata {
  sensitive: true
  requirements?: unknown
}

function sensitive<T extends z.ZodTypeAny>(inner: T): T {
  return inner.meta({ [SENSITIVE_META_KEY]: { sensitive: true } }) as T
}

function isSensitive(schema: z.ZodTypeAny): boolean {
  const meta = schema.meta()
  return meta?.[SENSITIVE_META_KEY]?.sensitive === true
}

// --- Sensitive Field Finder ---

interface FoundSensitiveField {
  path: string
  schema: z.ZodTypeAny
}

/**
 * Find all sensitive fields in a schema, traversing all union variants.
 * This is the critical function that must not miss any sensitive fields.
 */
function findSensitiveFields(
  schema: z.ZodTypeAny,
  path: string = ''
): FoundSensitiveField[] {
  const defType = (schema as any)._def?.type
  const results: FoundSensitiveField[] = []

  // Check if this schema itself is marked sensitive
  if (isSensitive(schema)) {
    results.push({ path, schema })
  }

  // Handle optional/nullable wrappers
  if (defType === 'optional') {
    const inner = (schema as z.ZodOptional<any>).unwrap()
    results.push(...findSensitiveFields(inner, path))
    return results
  }

  if (defType === 'nullable') {
    const inner = (schema as z.ZodNullable<any>).unwrap()
    results.push(...findSensitiveFields(inner, path))
    return results
  }

  // Handle objects - traverse all fields
  if (defType === 'object') {
    const shape = (schema as z.ZodObject<any>).shape
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const fieldPath = path ? `${path}.${key}` : key
      results.push(...findSensitiveFields(fieldSchema as z.ZodTypeAny, fieldPath))
    }
    return results
  }

  // Handle arrays - traverse element type
  if (defType === 'array') {
    const element = (schema as z.ZodArray<any>).element
    results.push(...findSensitiveFields(element, `${path}[]`))
    return results
  }

  // Handle unions - CRITICAL: must traverse ALL variants
  if (defType === 'union') {
    const options = (schema as any)._def.options as z.ZodTypeAny[]
    for (let i = 0; i < options.length; i++) {
      results.push(...findSensitiveFields(options[i], `${path}[union:${i}]`))
    }
    return results
  }

  // Handle discriminated unions (Zod v4)
  if (defType === 'discriminatedUnion') {
    const options = (schema as any)._def.options as z.ZodTypeAny[]
    for (let i = 0; i < options.length; i++) {
      results.push(...findSensitiveFields(options[i], `${path}[variant:${i}]`))
    }
    return results
  }

  return results
}

// --- Value Transformer for Runtime ---

/**
 * Transform all sensitive fields in a value based on schema.
 * Returns paths that were transformed.
 */
type TransformFn = (value: unknown, path: string) => unknown

function transformSensitiveValues<T>(
  value: T,
  schema: z.ZodTypeAny,
  transform: TransformFn,
  path: string = ''
): { result: unknown; transformedPaths: string[] } {
  const defType = (schema as any)._def?.type
  const transformedPaths: string[] = []

  // Handle null/undefined
  if (value === null || value === undefined) {
    return { result: value, transformedPaths }
  }

  // Check if this value is marked sensitive
  if (isSensitive(schema)) {
    transformedPaths.push(path)
    return { result: transform(value, path), transformedPaths }
  }

  // Handle optional/nullable wrappers
  if (defType === 'optional' || defType === 'nullable') {
    const inner =
      defType === 'optional'
        ? (schema as z.ZodOptional<any>).unwrap()
        : (schema as z.ZodNullable<any>).unwrap()
    return transformSensitiveValues(value, inner, transform, path)
  }

  // Handle objects
  if (defType === 'object' && typeof value === 'object') {
    const shape = (schema as z.ZodObject<any>).shape
    const result: Record<string, unknown> = { ...(value as object) }

    for (const [key, fieldSchema] of Object.entries(shape)) {
      if (key in result) {
        const fieldPath = path ? `${path}.${key}` : key
        const transformed = transformSensitiveValues(
          result[key],
          fieldSchema as z.ZodTypeAny,
          transform,
          fieldPath
        )
        result[key] = transformed.result
        transformedPaths.push(...transformed.transformedPaths)
      }
    }

    return { result, transformedPaths }
  }

  // Handle arrays
  if (defType === 'array' && Array.isArray(value)) {
    const element = (schema as z.ZodArray<any>).element
    const result = value.map((item, i) => {
      const itemPath = `${path}[${i}]`
      const transformed = transformSensitiveValues(item, element, transform, itemPath)
      transformedPaths.push(...transformed.transformedPaths)
      return transformed.result
    })
    return { result, transformedPaths }
  }

  // Handle unions - determine which variant matches and transform that one
  if (defType === 'union') {
    const options = (schema as any)._def.options as z.ZodTypeAny[]

    // Try each variant until one parses successfully
    for (let i = 0; i < options.length; i++) {
      const variant = options[i]
      const parseResult = variant.safeParse(value)
      if (parseResult.success) {
        return transformSensitiveValues(value, variant, transform, path)
      }
    }

    // No variant matched - this shouldn't happen with valid data
    // Fail closed: return the value unchanged but log a warning
    console.warn(`Union at path "${path}" did not match any variant`)
    return { result: value, transformedPaths }
  }

  // Handle discriminated unions
  if (defType === 'discriminatedUnion') {
    const discriminator = (schema as any)._def.discriminator as string
    const options = (schema as any)._def.options as z.ZodTypeAny[]

    if (typeof value === 'object' && value !== null && discriminator in value) {
      const discriminatorValue = (value as Record<string, unknown>)[discriminator]

      // Find matching variant
      for (let i = 0; i < options.length; i++) {
        const variant = options[i]
        if ((variant as any)._def?.type === 'object') {
          const shape = (variant as z.ZodObject<any>).shape
          const discField = shape[discriminator]
          if (discField && (discField as any)._def?.type === 'literal') {
            const literalValue = (discField as any)._def.value
            if (literalValue === discriminatorValue) {
              return transformSensitiveValues(value, variant, transform, path)
            }
          }
        }
      }
    }

    // No variant matched - fail closed
    console.warn(`Discriminated union at path "${path}" did not match any variant`)
    return { result: value, transformedPaths }
  }

  // For other types, return unchanged
  return { result: value, transformedPaths }
}

// --- Tests ---

describe('Spike 3: Unions fail-closed check', () => {
  describe('findSensitiveFields in unions', () => {
    it('should find sensitive field in first union variant', () => {
      const schema = z.union([
        z.object({ type: z.literal('a'), ssn: sensitive(z.string()) }),
        z.object({ type: z.literal('b'), name: z.string() })
      ])

      const found = findSensitiveFields(schema)

      expect(found.length).toBe(1)
      expect(found[0].path).toContain('ssn')
    })

    it('should find sensitive field in second union variant', () => {
      const schema = z.union([
        z.object({ type: z.literal('a'), name: z.string() }),
        z.object({ type: z.literal('b'), ssn: sensitive(z.string()) })
      ])

      const found = findSensitiveFields(schema)

      expect(found.length).toBe(1)
      expect(found[0].path).toContain('ssn')
    })

    it('should find sensitive fields in ALL union variants', () => {
      const schema = z.union([
        z.object({ ssn: sensitive(z.string()) }),
        z.object({ email: sensitive(z.string()) }),
        z.object({ phone: sensitive(z.string()) })
      ])

      const found = findSensitiveFields(schema)

      expect(found.length).toBe(3)
      expect(found.map((f) => f.path)).toContain('[union:0].ssn')
      expect(found.map((f) => f.path)).toContain('[union:1].email')
      expect(found.map((f) => f.path)).toContain('[union:2].phone')
    })

    it('should find sensitive fields in nested unions', () => {
      const innerUnion = z.union([
        z.object({ secret: sensitive(z.string()) }),
        z.object({ public: z.string() })
      ])

      const schema = z.object({
        nested: innerUnion
      })

      const found = findSensitiveFields(schema)

      expect(found.length).toBe(1)
      expect(found[0].path).toBe('nested[union:0].secret')
    })

    it('should find sensitive field that is itself a union', () => {
      const schema = z.object({
        data: sensitive(z.union([z.string(), z.number()]))
      })

      const found = findSensitiveFields(schema)

      expect(found.length).toBe(1)
      expect(found[0].path).toBe('data')
    })
  })

  describe('findSensitiveFields in discriminated unions', () => {
    it('should find sensitive fields across all discriminated variants', () => {
      const schema = z.discriminatedUnion('type', [
        z.object({ type: z.literal('person'), ssn: sensitive(z.string()) }),
        z.object({ type: z.literal('company'), ein: sensitive(z.string()) })
      ])

      const found = findSensitiveFields(schema)

      expect(found.length).toBe(2)
      const paths = found.map((f) => f.path)
      expect(paths.some((p) => p.includes('ssn'))).toBe(true)
      expect(paths.some((p) => p.includes('ein'))).toBe(true)
    })

    it('should handle discriminated union with some variants having no sensitive fields', () => {
      const schema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('public'), data: z.string() }),
        z.object({ kind: z.literal('private'), secret: sensitive(z.string()) }),
        z.object({ kind: z.literal('mixed'), public: z.string(), private: sensitive(z.string()) })
      ])

      const found = findSensitiveFields(schema)

      expect(found.length).toBe(2)
      const paths = found.map((f) => f.path)
      expect(paths.some((p) => p.includes('secret'))).toBe(true)
      expect(paths.some((p) => p.includes('private'))).toBe(true)
    })
  })

  describe('transformSensitiveValues with unions', () => {
    const redactTransform: TransformFn = (value, path) => ({
      __redacted: true,
      path
    })

    it('should transform sensitive field in matched union variant', () => {
      const schema = z.union([
        z.object({ type: z.literal('a'), ssn: sensitive(z.string()) }),
        z.object({ type: z.literal('b'), name: z.string() })
      ])

      const value = { type: 'a' as const, ssn: '123-45-6789' }
      const { result, transformedPaths } = transformSensitiveValues(
        value,
        schema,
        redactTransform
      )

      expect(transformedPaths).toContain('ssn')
      expect((result as any).ssn).toEqual({ __redacted: true, path: 'ssn' })
      expect((result as any).type).toBe('a')
    })

    it('should not transform non-sensitive fields in matched variant', () => {
      const schema = z.union([
        z.object({ type: z.literal('a'), ssn: sensitive(z.string()) }),
        z.object({ type: z.literal('b'), name: z.string() })
      ])

      const value = { type: 'b' as const, name: 'John' }
      const { result, transformedPaths } = transformSensitiveValues(
        value,
        schema,
        redactTransform
      )

      expect(transformedPaths).toEqual([])
      expect((result as any).name).toBe('John')
      expect((result as any).type).toBe('b')
    })

    it('should handle arrays of unions with sensitive fields', () => {
      const schema = z.array(
        z.union([
          z.object({ type: z.literal('sensitive'), data: sensitive(z.string()) }),
          z.object({ type: z.literal('public'), data: z.string() })
        ])
      )

      const value = [
        { type: 'sensitive' as const, data: 'secret1' },
        { type: 'public' as const, data: 'public1' },
        { type: 'sensitive' as const, data: 'secret2' }
      ]

      const { result, transformedPaths } = transformSensitiveValues(
        value,
        schema,
        redactTransform
      )

      expect(transformedPaths).toEqual(['[0].data', '[2].data'])
      expect((result as any)[0].data).toEqual({ __redacted: true, path: '[0].data' })
      expect((result as any)[1].data).toBe('public1')
      expect((result as any)[2].data).toEqual({ __redacted: true, path: '[2].data' })
    })
  })

  describe('transformSensitiveValues with discriminated unions', () => {
    const redactTransform: TransformFn = (value, path) => `[REDACTED:${path}]`

    it('should transform based on discriminator', () => {
      const schema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('user'), email: sensitive(z.string()) }),
        z.object({ kind: z.literal('company'), ein: sensitive(z.string()) })
      ])

      const userValue = { kind: 'user' as const, email: 'user@example.com' }
      const { result: userResult, transformedPaths: userPaths } = transformSensitiveValues(
        userValue,
        schema,
        redactTransform
      )

      expect(userPaths).toEqual(['email'])
      expect((userResult as any).email).toBe('[REDACTED:email]')

      const companyValue = { kind: 'company' as const, ein: '12-3456789' }
      const { result: companyResult, transformedPaths: companyPaths } = transformSensitiveValues(
        companyValue,
        schema,
        redactTransform
      )

      expect(companyPaths).toEqual(['ein'])
      expect((companyResult as any).ein).toBe('[REDACTED:ein]')
    })
  })

  describe('Fail-closed behavior', () => {
    it('should find sensitive fields even in deeply nested union structures', () => {
      // A complex nested structure
      const schema = z.object({
        level1: z.union([
          z.object({
            level2: z.array(
              z.union([
                z.object({
                  level3: z.union([
                    z.object({ deepSecret: sensitive(z.string()) }),
                    z.object({ deepPublic: z.string() })
                  ])
                }),
                z.object({ shallow: z.string() })
              ])
            )
          }),
          z.object({ other: z.string() })
        ])
      })

      const found = findSensitiveFields(schema)

      expect(found.length).toBe(1)
      expect(found[0].path).toContain('deepSecret')
    })

    it('should handle optional unions with sensitive fields', () => {
      const schema = z.object({
        maybeData: z
          .union([
            z.object({ secret: sensitive(z.string()) }),
            z.object({ public: z.string() })
          ])
          .optional()
      })

      const found = findSensitiveFields(schema)

      expect(found.length).toBe(1)
      expect(found[0].path).toContain('secret')
    })

    it('should transform all instances in array of mixed union variants', () => {
      const schema = z.array(
        z.union([
          z.object({ sensitive: sensitive(z.string()) }),
          z.object({ nonsensitive: z.string() })
        ])
      )

      const value = [
        { sensitive: 'a' },
        { nonsensitive: 'b' },
        { sensitive: 'c' },
        { nonsensitive: 'd' },
        { sensitive: 'e' }
      ]

      const { transformedPaths } = transformSensitiveValues(
        value,
        schema,
        (v) => 'REDACTED'
      )

      // Should find all 3 sensitive instances
      expect(transformedPaths).toEqual(['[0].sensitive', '[2].sensitive', '[4].sensitive'])
    })
  })
})
