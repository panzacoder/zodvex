/**
 * Reproduces an exact consumer encode pipeline to diagnose why CustomField
 * reaches Convex's useQuery unencoded.
 *
 * Pipeline under test:
 *   1. zodvexCodec() creates the codec (like a consumer's custom())
 *   2. extractCodec() extracts it from a model schema (like codegen does)
 *   3. z.object({ email: extracted }) builds the registry args schema
 *   4. createBoundaryHelpers(registry).encodeArgs() encodes at the client boundary
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createBoundaryHelpers } from '../src/boundaryHelpers'
import { zodvexCodec } from '../src/codec'
import { extractCodec } from '../src/codegen/extractCodec'
import { safeEncode } from '../src/normalizeCodecPaths'
import { stripUndefined } from '../src/utils'
import { $ZodCodec } from "zod/v4/core";

const functionNameSymbol = Symbol.for('functionName')

/** Create a fake FunctionReference with the well-known functionName symbol */
function fakeRef(path: string) {
  return { [functionNameSymbol]: path } as any
}

// ---------------------------------------------------------------------------
// CustomWrapper — minimal reproduction of a consumer's CustomField
// ---------------------------------------------------------------------------

const PRIVATE_VALUES = new WeakMap<CustomWrapper<unknown>, unknown>()

class CustomWrapper<T> {
  public readonly status: 'full' | 'hidden'

  private constructor(value: T | null, status: 'full' | 'hidden') {
    PRIVATE_VALUES.set(this, value)
    this.status = status
  }

  static full<T>(value: T): CustomWrapper<T> {
    return new CustomWrapper(value, 'full')
  }

  static hidden<T>(): CustomWrapper<T> {
    return new CustomWrapper<T>(null, 'hidden')
  }

  static fromWire<T>(wire: { value: T | null; status: 'full' | 'hidden' }): CustomWrapper<T> {
    if (wire.status === 'hidden') return CustomWrapper.hidden<T>()
    return new CustomWrapper<T>(wire.value, wire.status)
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

  // Anti-coercion guards (like a consumer's CustomField)
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
// Create custom codec (matches a consumer's custom() pattern)
// ---------------------------------------------------------------------------

function createCustomCodec<T extends z.ZodTypeAny>(inner: T) {
  const wireSchema = z.object({
    value: z.nullable(inner),
    status: z.enum(['full', 'hidden'])
  })

  const fieldSchema = z.custom<CustomWrapper<z.output<T>>>(val => val instanceof CustomWrapper)

  return zodvexCodec(wireSchema, fieldSchema, {
    decode: wire => CustomWrapper.fromWire(wire),
    encode: field => field.toWire()
  })
}

// ---------------------------------------------------------------------------
// Model schema (like a consumer's data model)
// ---------------------------------------------------------------------------

const customEmail = createCustomCodec(z.string().check(z.email()))
const customName = createCustomCodec(z.string())

const userDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  orgId: z.string(),
  email: z.optional(customEmail),
  firstName: z.optional(customName),
  lastName: z.optional(customName)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Exact consumer encode pipeline reproduction', () => {
  // Step 1: extractCodec from model schema (like codegen does)
  const _mc0 = extractCodec(userDocSchema.shape.email)

  it('extractCodec returns a ZodCodec', () => {
    expect(_mc0).toBeInstanceOf($ZodCodec)
  })

  // Step 2: Build registry args schema (like generated api.ts)
  const argsSchema = z.object({ email: _mc0 })

  // Step 3: Build registry (like generated api.ts)
  const registry = {
    'users/index:getByEmail': {
      args: argsSchema,
      returns: z.nullable(userDocSchema)
    }
  }

  describe('z.encode directly on args schema', () => {
    it('encodes CustomWrapper to wire format', () => {
      const runtimeArgs = { email: CustomWrapper.full('test@example.com') }
      const wire = z.encode(argsSchema, runtimeArgs)

      expect(wire.email).toEqual({ value: 'test@example.com', status: 'full' })
    })
  })

  describe('safeEncode on args schema', () => {
    it('encodes CustomWrapper via safeEncode', () => {
      const runtimeArgs = { email: CustomWrapper.full('test@example.com') }
      const wire = stripUndefined(safeEncode(argsSchema, runtimeArgs))

      expect(wire).toHaveProperty('email')
      expect((wire as any).email).toEqual({ value: 'test@example.com', status: 'full' })
    })
  })

  describe('createBoundaryHelpers.encodeArgs (full pipeline)', () => {
    const { encodeArgs } = createBoundaryHelpers(registry as any)

    it('encodes valid email through full pipeline', () => {
      const args = { email: CustomWrapper.full('test@example.com') }
      const result = encodeArgs(fakeRef('users/index:getByEmail'), args)

      expect(result.email).toEqual({ value: 'test@example.com', status: 'full' })
      expect(result.email).not.toBeInstanceOf(CustomWrapper)
    })

    it('passthrough check: unknown function path', () => {
      const args = { email: CustomWrapper.full('test@example.com') }
      const result = encodeArgs(fakeRef('unknown/path:fn'), args)

      // Should passthrough unchanged
      expect(result.email).toBeInstanceOf(CustomWrapper)
    })
  })
})
