/**
 * Reproduces the exact hotpot encode pipeline to diagnose why SensitiveField
 * reaches Convex's useQuery unencoded.
 *
 * Pipeline under test:
 *   1. zodvexCodec() creates the codec (like hotpot's sensitive())
 *   2. extractCodec() extracts it from a model schema (like codegen does)
 *   3. z.object({ email: extracted }) builds the registry args schema
 *   4. createBoundaryHelpers(registry).encodeArgs() encodes at the client boundary
 */

import { describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { zodvexCodec } from '../src/codec'
import { extractCodec } from '../src/codegen/extractCodec'
import { safeEncode } from '../src/normalizeCodecPaths'
import { stripUndefined } from '../src/utils'

// ---------------------------------------------------------------------------
// Mock convex/server
// ---------------------------------------------------------------------------

mock.module('convex/server', () => ({
  getFunctionName: (ref: any) => ref._testPath
}))

const { createBoundaryHelpers } = await import('../src/boundaryHelpers')

function fakeRef(path: string) {
  return { _testPath: path } as any
}

// ---------------------------------------------------------------------------
// SensitiveWrapper — minimal reproduction of hotpot's SensitiveField
// ---------------------------------------------------------------------------

const PRIVATE_VALUES = new WeakMap<SensitiveWrapper<unknown>, unknown>()

class SensitiveWrapper<T> {
  public readonly status: 'full' | 'hidden'

  private constructor(value: T | null, status: 'full' | 'hidden') {
    PRIVATE_VALUES.set(this, value)
    this.status = status
  }

  static full<T>(value: T): SensitiveWrapper<T> {
    return new SensitiveWrapper(value, 'full')
  }

  static hidden<T>(): SensitiveWrapper<T> {
    return new SensitiveWrapper<T>(null, 'hidden')
  }

  static fromWire<T>(wire: { value: T | null; status: 'full' | 'hidden' }): SensitiveWrapper<T> {
    if (wire.status === 'hidden') return SensitiveWrapper.hidden<T>()
    return new SensitiveWrapper<T>(wire.value, wire.status)
  }

  expose(): T {
    if (this.status === 'hidden') throw new Error('Cannot expose hidden value')
    return PRIVATE_VALUES.get(this) as T
  }

  toWire(): { value: T | null; status: 'full' | 'hidden' } {
    return {
      status: this.status,
      value: this.status === 'full' ? (PRIVATE_VALUES.get(this) as T) : null
    }
  }

  // Anti-coercion guards (like hotpot's SensitiveField)
  toJSON() {
    return '❌❌❌❌❌'
  }
  toString() {
    return '❌❌❌❌❌'
  }
  valueOf() {
    return '❌❌❌❌❌'
  }
}

// ---------------------------------------------------------------------------
// Create sensitive codec (matches hotpot's sensitive() pattern)
// ---------------------------------------------------------------------------

function createSensitiveCodec<T extends z.ZodTypeAny>(inner: T) {
  const wireSchema = z.object({
    value: inner.nullable(),
    status: z.enum(['full', 'hidden'])
  })

  const fieldSchema = z.custom<SensitiveWrapper<z.output<T>>>(
    val => val instanceof SensitiveWrapper
  )

  return zodvexCodec(wireSchema, fieldSchema, {
    decode: wire => SensitiveWrapper.fromWire(wire),
    encode: field => field.toWire()
  })
}

// ---------------------------------------------------------------------------
// Model schema (like hotpot's patients model)
// ---------------------------------------------------------------------------

const sensitiveEmail = createSensitiveCodec(z.string().email())
const sensitiveName = createSensitiveCodec(z.string())

const patientDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  clinicId: z.string(),
  email: sensitiveEmail.optional(),
  firstName: sensitiveName.optional(),
  lastName: sensitiveName.optional()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Exact hotpot encode pipeline reproduction', () => {
  // Step 1: extractCodec from model schema (like codegen does)
  const _mc0 = extractCodec(patientDocSchema.shape.email)

  it('extractCodec returns a ZodCodec', () => {
    expect(_mc0).toBeInstanceOf(z.ZodCodec)
  })

  // Step 2: Build registry args schema (like generated api.ts)
  const argsSchema = z.object({ email: _mc0 })

  // Step 3: Build registry (like generated api.ts)
  const registry = {
    'patients/index:getByEmail': {
      args: argsSchema,
      returns: patientDocSchema.nullable()
    }
  }

  describe('z.encode directly on args schema', () => {
    it('encodes SensitiveWrapper to wire format', () => {
      const runtimeArgs = { email: SensitiveWrapper.full('test@example.com') }
      const wire = z.encode(argsSchema, runtimeArgs)

      expect(wire.email).toEqual({ value: 'test@example.com', status: 'full' })
    })

    it('encodes SensitiveWrapper with empty string', () => {
      // This is the exact failing case: SensitiveField.full('')
      const runtimeArgs = { email: SensitiveWrapper.full('') }

      // Empty string fails z.string().email() validation in the wire schema
      // Does z.encode throw here?
      let threw = false
      let result: any
      try {
        result = z.encode(argsSchema, runtimeArgs)
      } catch (e) {
        threw = true
        console.log('z.encode threw:', e)
      }

      if (threw) {
        console.log('z.encode THREW for empty email — try/catch in useZodQuery would catch this')
      } else {
        console.log('z.encode SUCCEEDED:', JSON.stringify(result))
        // If it succeeded, check if the result still has SensitiveWrapper
        expect(result.email).not.toBeInstanceOf(SensitiveWrapper)
      }
    })
  })

  describe('safeEncode on args schema', () => {
    it('encodes SensitiveWrapper via safeEncode', () => {
      const runtimeArgs = { email: SensitiveWrapper.full('test@example.com') }
      const wire = stripUndefined(safeEncode(argsSchema, runtimeArgs))

      expect(wire).toHaveProperty('email')
      expect((wire as any).email).toEqual({ value: 'test@example.com', status: 'full' })
    })

    it('handles empty email through safeEncode', () => {
      const runtimeArgs = { email: SensitiveWrapper.full('') }

      let threw = false
      let result: any
      try {
        result = stripUndefined(safeEncode(argsSchema, runtimeArgs))
      } catch (e) {
        threw = true
        console.log('safeEncode threw:', e instanceof z.ZodError ? `ZodError: ${e.message}` : e)
      }

      if (threw) {
        console.log('safeEncode THREW — useZodQuery try/catch would catch and auto-skip')
      } else {
        console.log('safeEncode SUCCEEDED:', JSON.stringify(result))
      }
    })
  })

  describe('createBoundaryHelpers.encodeArgs (full pipeline)', () => {
    const { encodeArgs } = createBoundaryHelpers(registry as any)

    it('encodes valid email through full pipeline', () => {
      const args = { email: SensitiveWrapper.full('test@example.com') }
      const result = encodeArgs(fakeRef('patients/index:getByEmail'), args)

      expect(result.email).toEqual({ value: 'test@example.com', status: 'full' })
      expect(result.email).not.toBeInstanceOf(SensitiveWrapper)
    })

    it('encodes empty email through full pipeline', () => {
      const args = { email: SensitiveWrapper.full('') }

      let threw = false
      let result: any
      try {
        result = encodeArgs(fakeRef('patients/index:getByEmail'), args)
      } catch (e) {
        threw = true
        console.log('encodeArgs threw:', e)
      }

      console.log('encodeArgs threw:', threw, 'result:', threw ? 'N/A' : JSON.stringify(result))

      if (!threw) {
        // If it didn't throw, did it passthrough or actually encode?
        const isPassthrough = result.email instanceof SensitiveWrapper
        console.log('Is passthrough (SensitiveWrapper still in result):', isPassthrough)
        if (isPassthrough) {
          console.log(
            'BUG: encodeArgs returned raw SensitiveWrapper — this causes the Convex error'
          )
        }
      }
    })

    it('passthrough check: unknown function path', () => {
      const args = { email: SensitiveWrapper.full('test@example.com') }
      const result = encodeArgs(fakeRef('unknown/path:fn'), args)

      // Should passthrough unchanged
      expect(result.email).toBeInstanceOf(SensitiveWrapper)
    })
  })
})
