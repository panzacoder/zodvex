/**
 * Spike: Field-level write policies enforced at mutation time
 *
 * Goal: Validate that:
 * 1. Write policies can be defined per-field in the schema
 * 2. Write policies are checked before allowing mutations
 * 3. Denied writes throw/reject appropriately
 * 4. Partial writes (some fields allowed, some denied) are handled
 * 5. Nested sensitive fields in objects/arrays are validated
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

// --- Types ---

const SENSITIVE_META_KEY = 'zodvex:sensitive'

interface ReadPolicy<TReq = unknown> {
  status: 'full' | 'masked'
  requirements: TReq
  mask?: (value: unknown) => unknown
}

interface WritePolicy<TReq = unknown> {
  requirements: TReq
}

interface SensitiveMetadata<TReq = unknown> {
  sensitive: true
  read?: ReadPolicy<TReq>[]
  write?: WritePolicy<TReq>
}

type EntitlementCheckResult = boolean | { ok: boolean; reason?: string }

type EntitlementResolver<TCtx, TReq = unknown> = (
  ctx: TCtx,
  requirements: TReq,
  operation: 'read' | 'write'
) => EntitlementCheckResult | Promise<EntitlementCheckResult>

interface WriteDecision {
  allowed: boolean
  reason?: string
}

interface WriteValidationResult {
  allowed: boolean
  deniedFields: Array<{ path: string; reason?: string }>
}

// --- Implementation ---

/**
 * Mark a Zod schema as sensitive with read and write policies.
 */
function sensitive<T extends z.ZodTypeAny, TReq = unknown>(
  inner: T,
  options?: {
    read?: ReadPolicy<TReq>[]
    write?: WritePolicy<TReq>
  }
): T {
  const meta: SensitiveMetadata<TReq> = {
    sensitive: true,
    read: options?.read,
    write: options?.write
  }
  return inner.meta({ [SENSITIVE_META_KEY]: meta }) as T
}

function getSensitiveMeta<TReq = unknown>(
  schema: z.ZodTypeAny
): SensitiveMetadata<TReq> | undefined {
  const meta = schema.meta()
  return meta?.[SENSITIVE_META_KEY]
}

function isSensitive(schema: z.ZodTypeAny): boolean {
  return getSensitiveMeta(schema)?.sensitive === true
}

/**
 * Check if a single field's write policy allows the write.
 */
async function checkFieldWritePolicy<TCtx, TReq>(
  ctx: TCtx,
  meta: SensitiveMetadata<TReq>,
  resolver: EntitlementResolver<TCtx, TReq>
): Promise<WriteDecision> {
  // No write policy = allow by default
  if (!meta.write) {
    return { allowed: true }
  }

  const result = await resolver(ctx, meta.write.requirements, 'write')
  const allowed = typeof result === 'boolean' ? result : result.ok
  const reason = typeof result === 'boolean' ? undefined : result.reason

  return { allowed, reason }
}

/**
 * Validate write policies for all sensitive fields being written.
 * Returns which fields are allowed/denied.
 */
async function validateWritePolicies<TCtx, TReq>(
  value: unknown,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  resolver: EntitlementResolver<TCtx, TReq>,
  path: string = ''
): Promise<WriteValidationResult> {
  const defType = (schema as any)._def?.type
  const deniedFields: Array<{ path: string; reason?: string }> = []

  if (value === null || value === undefined) {
    return { allowed: true, deniedFields }
  }

  // Check if this field is sensitive and has a write policy
  const meta = getSensitiveMeta<TReq>(schema)
  if (meta?.sensitive && meta.write) {
    const decision = await checkFieldWritePolicy(ctx, meta, resolver)
    if (!decision.allowed) {
      deniedFields.push({ path: path || '(root)', reason: decision.reason })
    }
  }

  // Handle optional/nullable wrappers
  if (defType === 'optional' || defType === 'nullable') {
    const inner =
      defType === 'optional'
        ? (schema as z.ZodOptional<any>).unwrap()
        : (schema as z.ZodNullable<any>).unwrap()
    const innerResult = await validateWritePolicies(value, inner, ctx, resolver, path)
    deniedFields.push(...innerResult.deniedFields)
    return { allowed: deniedFields.length === 0, deniedFields }
  }

  // Handle objects - check each field
  if (defType === 'object' && typeof value === 'object' && value !== null) {
    const shape = (schema as z.ZodObject<any>).shape
    for (const [key, fieldSchema] of Object.entries(shape)) {
      if (key in (value as Record<string, unknown>)) {
        const fieldPath = path ? `${path}.${key}` : key
        const fieldValue = (value as Record<string, unknown>)[key]
        const fieldResult = await validateWritePolicies(
          fieldValue,
          fieldSchema as z.ZodTypeAny,
          ctx,
          resolver,
          fieldPath
        )
        deniedFields.push(...fieldResult.deniedFields)
      }
    }
  }

  // Handle arrays - check each element
  if (defType === 'array' && Array.isArray(value)) {
    const element = (schema as z.ZodArray<any>).element
    for (let i = 0; i < value.length; i++) {
      const itemPath = `${path}[${i}]`
      const itemResult = await validateWritePolicies(value[i], element, ctx, resolver, itemPath)
      deniedFields.push(...itemResult.deniedFields)
    }
  }

  // Handle unions
  if (defType === 'union') {
    const options = (schema as any)._def.options as z.ZodTypeAny[]
    // Try to find matching variant
    for (const variant of options) {
      const parseResult = variant.safeParse(value)
      if (parseResult.success) {
        const variantResult = await validateWritePolicies(value, variant, ctx, resolver, path)
        deniedFields.push(...variantResult.deniedFields)
        break
      }
    }
  }

  return { allowed: deniedFields.length === 0, deniedFields }
}

/**
 * Assert that all write policies pass, throwing if any are denied.
 */
async function assertWriteAllowed<TCtx, TReq>(
  value: unknown,
  schema: z.ZodTypeAny,
  ctx: TCtx,
  resolver: EntitlementResolver<TCtx, TReq>
): Promise<void> {
  const result = await validateWritePolicies(value, schema, ctx, resolver)
  if (!result.allowed) {
    const fieldList = result.deniedFields.map((f) => f.path).join(', ')
    throw new Error(`Write denied for fields: ${fieldList}`)
  }
}

// --- Tests ---

describe('Spike: Field-level write policies', () => {
  // Simple resolver that checks if entitlement is in ctx.entitlements array
  type TestCtx = { entitlements: string[] }
  const testResolver: EntitlementResolver<TestCtx, string> = (ctx, requirement, _operation) => {
    const hasEntitlement = ctx.entitlements.includes(requirement)
    return hasEntitlement ? { ok: true } : { ok: false, reason: 'missing_entitlement' }
  }

  describe('Schema definition with write policies', () => {
    it('should allow defining write policies on sensitive fields', () => {
      const patientSchema = z.object({
        name: z.string(),
        ssn: sensitive(z.string(), {
          read: [{ status: 'full', requirements: 'read:patient:ssn' }],
          write: { requirements: 'write:patient:ssn' }
        }),
        email: sensitive(z.string(), {
          read: [{ status: 'full', requirements: 'read:patient:email' }],
          write: { requirements: 'write:patient:contact' }
        })
      })

      // Verify metadata is stored correctly
      const ssnMeta = getSensitiveMeta<string>(patientSchema.shape.ssn)
      expect(ssnMeta?.write?.requirements).toBe('write:patient:ssn')

      const emailMeta = getSensitiveMeta<string>(patientSchema.shape.email)
      expect(emailMeta?.write?.requirements).toBe('write:patient:contact')
    })

    it('should allow sensitive fields without write policies (default allow)', () => {
      const schema = z.object({
        readOnlySecret: sensitive(z.string(), {
          read: [{ status: 'full', requirements: 'read:secret' }]
          // No write policy - allows writes by default
        })
      })

      const meta = getSensitiveMeta(schema.shape.readOnlySecret)
      expect(meta?.sensitive).toBe(true)
      expect(meta?.write).toBeUndefined()
    })
  })

  describe('Write policy validation', () => {
    const schema = z.object({
      name: z.string(),
      ssn: sensitive(z.string(), {
        write: { requirements: 'write:ssn' }
      }),
      email: sensitive(z.string(), {
        write: { requirements: 'write:email' }
      })
    })

    it('should allow write when user has required entitlement', async () => {
      const ctx: TestCtx = { entitlements: ['write:ssn', 'write:email'] }
      const value = { name: 'John', ssn: '123-45-6789', email: 'john@example.com' }

      const result = await validateWritePolicies(value, schema, ctx, testResolver)

      expect(result.allowed).toBe(true)
      expect(result.deniedFields).toEqual([])
    })

    it('should deny write when user lacks required entitlement', async () => {
      const ctx: TestCtx = { entitlements: ['write:email'] } // Missing write:ssn
      const value = { name: 'John', ssn: '123-45-6789', email: 'john@example.com' }

      const result = await validateWritePolicies(value, schema, ctx, testResolver)

      expect(result.allowed).toBe(false)
      expect(result.deniedFields).toHaveLength(1)
      expect(result.deniedFields[0].path).toBe('ssn')
      expect(result.deniedFields[0].reason).toBe('missing_entitlement')
    })

    it('should report all denied fields, not just the first', async () => {
      const ctx: TestCtx = { entitlements: [] } // Missing both
      const value = { name: 'John', ssn: '123-45-6789', email: 'john@example.com' }

      const result = await validateWritePolicies(value, schema, ctx, testResolver)

      expect(result.allowed).toBe(false)
      expect(result.deniedFields).toHaveLength(2)
      expect(result.deniedFields.map((f) => f.path)).toContain('ssn')
      expect(result.deniedFields.map((f) => f.path)).toContain('email')
    })

    it('should allow partial object writes when only some fields are present', async () => {
      const ctx: TestCtx = { entitlements: ['write:email'] } // Has email but not ssn
      // Only updating email, not ssn
      const partialValue = { name: 'John', email: 'new@example.com' }

      const result = await validateWritePolicies(partialValue, schema, ctx, testResolver)

      // Should be allowed since we're not writing ssn
      expect(result.allowed).toBe(true)
    })
  })

  describe('assertWriteAllowed', () => {
    const schema = z.object({
      secret: sensitive(z.string(), {
        write: { requirements: 'admin' }
      })
    })

    it('should not throw when write is allowed', async () => {
      const ctx: TestCtx = { entitlements: ['admin'] }
      const value = { secret: 'new-value' }

      // Should not throw
      await expect(assertWriteAllowed(value, schema, ctx, testResolver)).resolves.toBeUndefined()
    })

    it('should throw when write is denied', async () => {
      const ctx: TestCtx = { entitlements: [] }
      const value = { secret: 'new-value' }

      await expect(assertWriteAllowed(value, schema, ctx, testResolver)).rejects.toThrow(
        'Write denied for fields: secret'
      )
    })
  })

  describe('Nested sensitive fields', () => {
    it('should validate write policies in nested objects', async () => {
      const schema = z.object({
        profile: z.object({
          public: z.string(),
          private: sensitive(z.string(), {
            write: { requirements: 'write:profile:private' }
          })
        })
      })

      const ctx: TestCtx = { entitlements: [] }
      const value = { profile: { public: 'visible', private: 'secret' } }

      const result = await validateWritePolicies(value, schema, ctx, testResolver)

      expect(result.allowed).toBe(false)
      expect(result.deniedFields[0].path).toBe('profile.private')
    })

    it('should validate write policies in arrays', async () => {
      const schema = z.object({
        contacts: z.array(
          z.object({
            type: z.string(),
            value: sensitive(z.string(), {
              write: { requirements: 'write:contact' }
            })
          })
        )
      })

      const ctx: TestCtx = { entitlements: [] }
      const value = {
        contacts: [
          { type: 'email', value: 'a@b.com' },
          { type: 'phone', value: '123-456' }
        ]
      }

      const result = await validateWritePolicies(value, schema, ctx, testResolver)

      expect(result.allowed).toBe(false)
      expect(result.deniedFields).toHaveLength(2)
      expect(result.deniedFields.map((f) => f.path)).toContain('contacts[0].value')
      expect(result.deniedFields.map((f) => f.path)).toContain('contacts[1].value')
    })
  })

  describe('Optional sensitive fields', () => {
    it('should skip validation when optional field is not present', async () => {
      const schema = z.object({
        name: z.string(),
        ssn: sensitive(z.string(), {
          write: { requirements: 'write:ssn' }
        }).optional()
      })

      const ctx: TestCtx = { entitlements: [] }
      const value = { name: 'John' } // ssn not present

      const result = await validateWritePolicies(value, schema, ctx, testResolver)

      expect(result.allowed).toBe(true)
    })

    it('should validate when optional field is present', async () => {
      const schema = z.object({
        name: z.string(),
        ssn: sensitive(z.string(), {
          write: { requirements: 'write:ssn' }
        }).optional()
      })

      const ctx: TestCtx = { entitlements: [] }
      const value = { name: 'John', ssn: '123-45-6789' }

      const result = await validateWritePolicies(value, schema, ctx, testResolver)

      expect(result.allowed).toBe(false)
      expect(result.deniedFields[0].path).toBe('ssn')
    })
  })

  describe('Write policies in unions', () => {
    it('should validate write policies in matched union variant', async () => {
      const schema = z.union([
        z.object({
          type: z.literal('user'),
          email: sensitive(z.string(), { write: { requirements: 'write:user:email' } })
        }),
        z.object({
          type: z.literal('admin'),
          email: sensitive(z.string(), { write: { requirements: 'write:admin:email' } })
        })
      ])

      // User trying to write admin email
      const ctx: TestCtx = { entitlements: ['write:user:email'] }
      const adminValue = { type: 'admin' as const, email: 'admin@example.com' }

      const result = await validateWritePolicies(adminValue, schema, ctx, testResolver)

      expect(result.allowed).toBe(false)
      expect(result.deniedFields[0].path).toBe('email')
    })

    it('should allow write when user has correct variant entitlement', async () => {
      const schema = z.union([
        z.object({
          type: z.literal('user'),
          email: sensitive(z.string(), { write: { requirements: 'write:user:email' } })
        }),
        z.object({
          type: z.literal('admin'),
          email: sensitive(z.string(), { write: { requirements: 'write:admin:email' } })
        })
      ])

      const ctx: TestCtx = { entitlements: ['write:user:email'] }
      const userValue = { type: 'user' as const, email: 'user@example.com' }

      const result = await validateWritePolicies(userValue, schema, ctx, testResolver)

      expect(result.allowed).toBe(true)
    })
  })

  describe('Different write policies per field', () => {
    it('should support varying restriction levels', async () => {
      const schema = z.object({
        // Anyone can write name
        name: z.string(),
        // Staff can write email
        email: sensitive(z.string(), { write: { requirements: 'staff' } }),
        // Only admins can write SSN
        ssn: sensitive(z.string(), { write: { requirements: 'admin' } })
      })

      // Staff user (not admin)
      const ctx: TestCtx = { entitlements: ['staff'] }
      const value = { name: 'John', email: 'john@example.com', ssn: '123-45-6789' }

      const result = await validateWritePolicies(value, schema, ctx, testResolver)

      expect(result.allowed).toBe(false)
      expect(result.deniedFields).toHaveLength(1)
      expect(result.deniedFields[0].path).toBe('ssn')
    })
  })

  describe('Integration with mutation flow', () => {
    /**
     * Simulates a secure mutation wrapper that validates write policies
     * before allowing the mutation to proceed.
     */
    async function secureMutation<TCtx extends TestCtx, TArgs, TResult>(
      ctx: TCtx,
      args: TArgs,
      schema: z.ZodTypeAny,
      resolver: EntitlementResolver<TCtx, string>,
      handler: (ctx: TCtx, args: TArgs) => Promise<TResult>
    ): Promise<TResult> {
      // Validate write policies before running handler
      await assertWriteAllowed(args, schema, ctx, resolver)

      // If we get here, all write policies passed
      return handler(ctx, args)
    }

    it('should allow mutation when write policies pass', async () => {
      const argsSchema = z.object({
        patientId: z.string(),
        updates: z.object({
          email: sensitive(z.string(), { write: { requirements: 'write:patient:email' } })
        })
      })

      const ctx: TestCtx = { entitlements: ['write:patient:email'] }
      const args = { patientId: 'p123', updates: { email: 'new@example.com' } }

      let handlerCalled = false
      const result = await secureMutation(ctx, args, argsSchema, testResolver, async () => {
        handlerCalled = true
        return { success: true }
      })

      expect(handlerCalled).toBe(true)
      expect(result).toEqual({ success: true })
    })

    it('should block mutation when write policies fail', async () => {
      const argsSchema = z.object({
        patientId: z.string(),
        updates: z.object({
          ssn: sensitive(z.string(), { write: { requirements: 'admin' } })
        })
      })

      const ctx: TestCtx = { entitlements: ['staff'] } // Not admin
      const args = { patientId: 'p123', updates: { ssn: '123-45-6789' } }

      let handlerCalled = false
      await expect(
        secureMutation(ctx, args, argsSchema, testResolver, async () => {
          handlerCalled = true
          return { success: true }
        })
      ).rejects.toThrow('Write denied')

      expect(handlerCalled).toBe(false)
    })
  })
})
