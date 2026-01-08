/**
 * Spike 4: Policy-before-handler semantics
 *
 * Goal: Validate that:
 * 1. Handlers receive already-limited SensitiveField values (not raw)
 * 2. Policy is applied immediately after DB reads
 * 3. Privileged-read escape hatch exists for when handlers need raw access
 * 4. Non-secure wrappers auto-limit or reject appropriately
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

// --- Core types (reused from Spike 2) ---

type SensitiveDb<T> = {
  __sensitiveValue: T
}

type SensitiveStatus = 'full' | 'masked' | 'hidden'

type PolicyDecision = {
  status: SensitiveStatus
  reason?: string
  mask?: (value: unknown) => unknown
}

type PolicyResolver<TCtx = unknown> = (context: {
  ctx: TCtx
  path: string
  rawValue: unknown
}) => PolicyDecision | Promise<PolicyDecision>

// --- SensitiveField (simplified from Spike 2) ---

const VALUES = new WeakMap<SensitiveField<any>, unknown>()

class SensitiveField<T> {
  public readonly status: SensitiveStatus
  public readonly field: string | null
  public readonly reason?: string

  private constructor(
    value: T | undefined,
    status: SensitiveStatus,
    field: string | null,
    reason?: string
  ) {
    VALUES.set(this, value)
    this.status = status
    this.field = field
    this.reason = reason
  }

  static full<T>(value: T, field?: string): SensitiveField<T> {
    return new SensitiveField(value, 'full', field ?? null)
  }

  static masked<T>(maskedValue: T, field?: string, reason?: string): SensitiveField<T> {
    return new SensitiveField(maskedValue, 'masked', field ?? null, reason)
  }

  static hidden<T>(field?: string, reason?: string): SensitiveField<T> {
    return new SensitiveField<T>(undefined, 'hidden', field ?? null, reason)
  }

  /**
   * Create a hidden field that still stores the raw value internally.
   * This supports privileged reads while preventing normal access.
   */
  static hiddenWithRaw<T>(rawValue: T, field?: string, reason?: string): SensitiveField<T> {
    return new SensitiveField<T>(rawValue, 'hidden', field ?? null, reason)
  }

  unwrap(): T {
    if (this.status !== 'full') {
      throw new Error(`Cannot unwrap ${this.status} SensitiveField`)
    }
    return VALUES.get(this) as T
  }

  getValue(): T | undefined {
    if (this.status === 'hidden') return undefined
    return VALUES.get(this) as T
  }

  toWire() {
    return {
      __sensitiveField: this.field,
      status: this.status,
      value: this.status === 'hidden' ? null : VALUES.get(this),
      ...(this.reason && { reason: this.reason })
    }
  }
}

// --- Sensitive metadata helpers ---

const SENSITIVE_META_KEY = 'zodvex:sensitive'

function sensitive<T extends z.ZodTypeAny>(inner: T): T {
  return inner.meta({ [SENSITIVE_META_KEY]: { sensitive: true } }) as T
}

function isSensitive(schema: z.ZodTypeAny): boolean {
  const meta = schema.meta()
  return meta?.[SENSITIVE_META_KEY]?.sensitive === true
}

// --- Mock DB types ---

type PatientDb = {
  _id: string
  name: string
  email: SensitiveDb<string>
  ssn: SensitiveDb<string>
}

type QueryContext = {
  role: 'admin' | 'provider' | 'patient'
  userId: string
}

// --- Policy application ---

/**
 * Apply policy decision and create SensitiveField.
 * IMPORTANT: We always store the raw value internally (even for hidden fields)
 * to support privileged reads. The status controls what's exposed via getValue()/unwrap().
 */
function applyDecision<T>(
  rawValue: T,
  decision: PolicyDecision,
  field?: string
): SensitiveField<T> {
  switch (decision.status) {
    case 'full':
      return SensitiveField.full(rawValue, field)
    case 'masked':
      const maskedValue = decision.mask ? decision.mask(rawValue) : rawValue
      return SensitiveField.masked(maskedValue as T, field, decision.reason)
    case 'hidden':
      // Store raw value for privileged reads, but hide it from normal access
      return SensitiveField.hiddenWithRaw(rawValue, field, decision.reason)
    default:
      return SensitiveField.hiddenWithRaw(rawValue, field, 'unknown status')
  }
}

/**
 * Apply policy to a document, transforming all sensitive DB values to SensitiveFields.
 * This is called immediately after DB read.
 */
async function applyPolicyToDoc<TDoc extends object, TCtx>(
  doc: TDoc,
  schema: z.ZodObject<any>,
  ctx: TCtx,
  resolver: PolicyResolver<TCtx>
): Promise<TDoc> {
  const result = { ...doc } as Record<string, unknown>
  const shape = schema.shape

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const value = result[key]

    if (isSensitive(fieldSchema as z.ZodTypeAny)) {
      // This is a sensitive field - apply policy
      if (value && typeof value === 'object' && '__sensitiveValue' in value) {
        const dbValue = value as SensitiveDb<unknown>
        const decision = await resolver({
          ctx,
          path: key,
          rawValue: dbValue.__sensitiveValue
        })
        result[key] = applyDecision(dbValue.__sensitiveValue, decision, key)
      }
    }
  }

  return result as TDoc
}

// --- Secure wrapper pattern ---

type SecureQueryOptions<TCtx, TArgs, TResult> = {
  args: z.ZodObject<any>
  returns: z.ZodObject<any>
  policy: PolicyResolver<TCtx>
  handler: (ctx: TCtx, args: TArgs, db: SecureDb<TCtx>) => Promise<TResult>
}

/**
 * A mock "secure DB" that applies policy immediately after reads.
 */
class SecureDb<TCtx> {
  constructor(
    private ctx: TCtx,
    private policy: PolicyResolver<TCtx>,
    private mockDb: Map<string, object>
  ) {}

  async get<T extends object>(id: string, schema: z.ZodObject<any>): Promise<T | null> {
    const doc = this.mockDb.get(id) as T | undefined
    if (!doc) return null

    // Policy applied immediately after read
    return applyPolicyToDoc(doc, schema, this.ctx, this.policy) as Promise<T>
  }
}

/**
 * Create a secure query wrapper that:
 * 1. Applies policy immediately after DB reads
 * 2. Handler receives already-limited SensitiveField values
 */
function zSecureQuery<TCtx, TArgs, TResult>(options: SecureQueryOptions<TCtx, TArgs, TResult>) {
  return async (ctx: TCtx, args: TArgs, mockDb: Map<string, object>): Promise<TResult> => {
    const db = new SecureDb(ctx, options.policy, mockDb)
    return options.handler(ctx, args, db)
  }
}

// --- Privileged read pattern ---

type PrivilegedReadOptions = {
  reason: string
  auditLog?: (info: { path: string; reason: string }) => void
}

/**
 * Escape hatch for privileged reads when handler needs raw values.
 * This should be explicit and audited.
 */
function privilegedUnwrap<T>(field: SensitiveField<T>, options: PrivilegedReadOptions): T {
  // Always log privileged access attempts
  if (options.auditLog) {
    options.auditLog({
      path: field.field ?? 'unknown',
      reason: options.reason
    })
  }

  // Get raw value regardless of status
  const rawValue = VALUES.get(field) as T

  if (rawValue === undefined && field.status === 'hidden') {
    throw new Error(
      `Privileged read failed: field "${field.field}" has no raw value (was hidden at source)`
    )
  }

  return rawValue
}

// --- Auto-limit pattern for non-secure wrappers ---

/**
 * Auto-limit all sensitive fields to 'hidden' status.
 * Used by non-secure query wrappers to prevent accidental exposure.
 */
function autoLimit<T extends object>(doc: T, schema: z.ZodObject<any>): T {
  const result = { ...doc } as Record<string, unknown>
  const shape = schema.shape

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const value = result[key]

    if (isSensitive(fieldSchema as z.ZodTypeAny)) {
      if (value && typeof value === 'object' && '__sensitiveValue' in value) {
        // Replace with hidden SensitiveField
        result[key] = SensitiveField.hidden(key, 'auto-limited')
      }
    }
  }

  return result as T
}

/**
 * Assert that a schema has no sensitive fields.
 * Used by non-secure mutation/action wrappers.
 */
function assertNoSensitive(schema: z.ZodObject<any>): void {
  const shape = schema.shape

  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (isSensitive(fieldSchema as z.ZodTypeAny)) {
      throw new Error(
        `Schema contains sensitive field "${key}". Use zSecureMutation/zSecureAction instead.`
      )
    }
  }
}

// --- Tests ---

describe('Spike 4: Policy-before-handler semantics', () => {
  // Test schema
  const patientSchema = z.object({
    _id: z.string(),
    name: z.string(),
    email: sensitive(z.string()),
    ssn: sensitive(z.string())
  })

  // Mock database
  const mockDb = new Map<string, PatientDb>([
    [
      'patient1',
      {
        _id: 'patient1',
        name: 'John Doe',
        email: { __sensitiveValue: 'john@example.com' },
        ssn: { __sensitiveValue: '123-45-6789' }
      }
    ]
  ])

  // Sample policy: admins get full, providers get masked email/hidden ssn, patients get hidden
  const patientPolicy: PolicyResolver<QueryContext> = ({ ctx, path }) => {
    if (ctx.role === 'admin') {
      return { status: 'full' }
    }

    if (ctx.role === 'provider') {
      if (path === 'email') {
        return {
          status: 'masked',
          reason: 'provider access',
          mask: v => String(v).replace(/^(.{2}).*(@.*)$/, '$1***$2')
        }
      }
      return { status: 'hidden', reason: 'ssn not available to providers' }
    }

    // Patient - hidden by default
    return { status: 'hidden', reason: 'patient cannot view other patient data' }
  }

  describe('Handler receives already-limited values', () => {
    it('should provide full access to admin', async () => {
      let handlerReceivedEmail: SensitiveField<string> | undefined
      let handlerReceivedSsn: SensitiveField<string> | undefined

      const getPatient = zSecureQuery({
        args: z.object({ id: z.string() }),
        returns: patientSchema,
        policy: patientPolicy,
        handler: async (ctx, args, db) => {
          const patient = await db.get<any>(args.id, patientSchema)
          handlerReceivedEmail = patient?.email
          handlerReceivedSsn = patient?.ssn
          return patient
        }
      })

      const ctx: QueryContext = { role: 'admin', userId: 'admin1' }
      await getPatient(ctx, { id: 'patient1' }, mockDb)

      expect(handlerReceivedEmail?.status).toBe('full')
      expect(handlerReceivedEmail?.unwrap()).toBe('john@example.com')
      expect(handlerReceivedSsn?.status).toBe('full')
      expect(handlerReceivedSsn?.unwrap()).toBe('123-45-6789')
    })

    it('should provide masked email and hidden ssn to provider', async () => {
      let handlerReceivedEmail: SensitiveField<string> | undefined
      let handlerReceivedSsn: SensitiveField<string> | undefined

      const getPatient = zSecureQuery({
        args: z.object({ id: z.string() }),
        returns: patientSchema,
        policy: patientPolicy,
        handler: async (ctx, args, db) => {
          const patient = await db.get<any>(args.id, patientSchema)
          handlerReceivedEmail = patient?.email
          handlerReceivedSsn = patient?.ssn
          return patient
        }
      })

      const ctx: QueryContext = { role: 'provider', userId: 'doc1' }
      await getPatient(ctx, { id: 'patient1' }, mockDb)

      expect(handlerReceivedEmail?.status).toBe('masked')
      expect(handlerReceivedEmail?.getValue()).toBe('jo***@example.com')
      expect(() => handlerReceivedEmail?.unwrap()).toThrow()

      expect(handlerReceivedSsn?.status).toBe('hidden')
      expect(handlerReceivedSsn?.getValue()).toBeUndefined()
      expect(() => handlerReceivedSsn?.unwrap()).toThrow()
    })

    it('should hide all sensitive fields for patient', async () => {
      let handlerReceivedEmail: SensitiveField<string> | undefined

      const getPatient = zSecureQuery({
        args: z.object({ id: z.string() }),
        returns: patientSchema,
        policy: patientPolicy,
        handler: async (ctx, args, db) => {
          const patient = await db.get<any>(args.id, patientSchema)
          handlerReceivedEmail = patient?.email
          return patient
        }
      })

      const ctx: QueryContext = { role: 'patient', userId: 'patient2' }
      await getPatient(ctx, { id: 'patient1' }, mockDb)

      expect(handlerReceivedEmail?.status).toBe('hidden')
      expect(() => handlerReceivedEmail?.unwrap()).toThrow()
    })
  })

  describe('Privileged read escape hatch', () => {
    it('should allow privileged unwrap with audit logging', async () => {
      const auditLog: Array<{ path: string; reason: string }> = []

      const getPatient = zSecureQuery({
        args: z.object({ id: z.string() }),
        returns: patientSchema,
        policy: patientPolicy,
        handler: async (ctx, args, db) => {
          const patient = await db.get<any>(args.id, patientSchema)

          // Provider needs SSN for specific business logic (e.g., insurance verification)
          if (patient?.ssn) {
            const rawSsn = privilegedUnwrap(patient.ssn, {
              reason: 'Insurance verification',
              auditLog: info => auditLog.push(info)
            })
            // Use rawSsn for business logic...
            expect(rawSsn).toBe('123-45-6789')
          }

          return patient
        }
      })

      const ctx: QueryContext = { role: 'provider', userId: 'doc1' }
      await getPatient(ctx, { id: 'patient1' }, mockDb)

      // Verify audit log captured the access
      expect(auditLog.length).toBe(1)
      expect(auditLog[0].path).toBe('ssn')
      expect(auditLog[0].reason).toBe('Insurance verification')
    })

    it('should work for admin without special handling', async () => {
      const getPatient = zSecureQuery({
        args: z.object({ id: z.string() }),
        returns: patientSchema,
        policy: patientPolicy,
        handler: async (ctx, args, db) => {
          const patient = await db.get<any>(args.id, patientSchema)

          // Admin can just unwrap directly
          if (patient?.ssn && patient.ssn.status === 'full') {
            const rawSsn = patient.ssn.unwrap()
            expect(rawSsn).toBe('123-45-6789')
          }

          return patient
        }
      })

      const ctx: QueryContext = { role: 'admin', userId: 'admin1' }
      await getPatient(ctx, { id: 'patient1' }, mockDb)
    })
  })

  describe('Auto-limit for non-secure wrappers', () => {
    it('should auto-limit all sensitive fields to hidden', () => {
      const rawDoc: PatientDb = {
        _id: 'patient1',
        name: 'John Doe',
        email: { __sensitiveValue: 'john@example.com' },
        ssn: { __sensitiveValue: '123-45-6789' }
      }

      const limited = autoLimit(rawDoc, patientSchema)

      expect((limited.email as SensitiveField<string>).status).toBe('hidden')
      expect((limited.email as SensitiveField<string>).reason).toBe('auto-limited')
      expect((limited.ssn as SensitiveField<string>).status).toBe('hidden')
    })

    it('should preserve non-sensitive fields', () => {
      const rawDoc: PatientDb = {
        _id: 'patient1',
        name: 'John Doe',
        email: { __sensitiveValue: 'john@example.com' },
        ssn: { __sensitiveValue: '123-45-6789' }
      }

      const limited = autoLimit(rawDoc, patientSchema)

      expect(limited._id).toBe('patient1')
      expect(limited.name).toBe('John Doe')
    })
  })

  describe('assertNoSensitive for mutations/actions', () => {
    it('should throw for schema with sensitive fields', () => {
      expect(() => assertNoSensitive(patientSchema)).toThrow(
        'Schema contains sensitive field "email"'
      )
    })

    it('should pass for schema without sensitive fields', () => {
      const safeSchema = z.object({
        id: z.string(),
        name: z.string()
      })

      expect(() => assertNoSensitive(safeSchema)).not.toThrow()
    })
  })

  describe('Wire serialization preserves policy decisions', () => {
    it('should serialize limited fields correctly for wire', async () => {
      const getPatient = zSecureQuery({
        args: z.object({ id: z.string() }),
        returns: patientSchema,
        policy: patientPolicy,
        handler: async (ctx, args, db) => {
          return db.get<any>(args.id, patientSchema)
        }
      })

      const ctx: QueryContext = { role: 'provider', userId: 'doc1' }
      const result = await getPatient(ctx, { id: 'patient1' }, mockDb)

      // Serialize for wire
      const wireEmail = (result?.email as SensitiveField<string>).toWire()
      const wireSsn = (result?.ssn as SensitiveField<string>).toWire()

      expect(wireEmail).toEqual({
        __sensitiveField: 'email',
        status: 'masked',
        value: 'jo***@example.com',
        reason: 'provider access'
      })

      expect(wireSsn).toEqual({
        __sensitiveField: 'ssn',
        status: 'hidden',
        value: null,
        reason: 'ssn not available to providers'
      })
    })
  })
})
