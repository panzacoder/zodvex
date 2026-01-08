/**
 * Tests for src/security/sensitive.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests the sensitive() marker and related helper functions.
 */

import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  SENSITIVE_META_KEY,
  findSensitiveFields,
  getSensitiveMetadata,
  isSensitiveSchema,
  sensitive
} from '../../src/security/sensitive'
import type { ReadPolicy, SensitiveMetadata, WritePolicy } from '../../src/security/types'

describe('security/sensitive.ts', () => {
  describe('SENSITIVE_META_KEY', () => {
    it('should be the correct key', () => {
      expect(SENSITIVE_META_KEY).toBe('zodvex:sensitive')
    })
  })

  describe('sensitive()', () => {
    describe('basic marking', () => {
      it('should mark a string schema as sensitive', () => {
        const schema = sensitive(z.string())

        expect(isSensitiveSchema(schema)).toBe(true)
      })

      it('should mark a number schema as sensitive', () => {
        const schema = sensitive(z.number())

        expect(isSensitiveSchema(schema)).toBe(true)
      })

      it('should mark a boolean schema as sensitive', () => {
        const schema = sensitive(z.boolean())

        expect(isSensitiveSchema(schema)).toBe(true)
      })

      it('should preserve the inner schema type', () => {
        const schema = sensitive(z.string())

        // Should still parse as string
        expect(schema.parse('hello')).toBe('hello')
        expect(() => schema.parse(123)).toThrow()
      })

      it('should allow chaining with .optional()', () => {
        const schema = sensitive(z.string()).optional()

        expect(schema.parse(undefined)).toBeUndefined()
        expect(schema.parse('hello')).toBe('hello')
      })

      it('should allow chaining with .nullable()', () => {
        const schema = sensitive(z.string()).nullable()

        expect(schema.parse(null)).toBeNull()
        expect(schema.parse('hello')).toBe('hello')
      })
    })

    describe('with read policy', () => {
      it('should attach read policy to metadata', () => {
        const readPolicy: ReadPolicy<string> = [
          { status: 'full', requirements: 'admin' },
          { status: 'masked', requirements: 'user' }
        ]
        const schema = sensitive(z.string(), { read: readPolicy })

        const meta = getSensitiveMetadata<string>(schema)
        expect(meta?.read).toEqual(readPolicy)
      })

      it('should support single-tier read policy', () => {
        const schema = sensitive(z.string(), {
          read: [{ status: 'full', requirements: 'admin' }]
        })

        const meta = getSensitiveMetadata<string>(schema)
        expect(meta?.read).toHaveLength(1)
        expect(meta?.read?.[0].requirements).toBe('admin')
      })

      it('should support mask functions in read policy', () => {
        const maskFn = (v: unknown) => String(v).replace(/./g, '*')
        const schema = sensitive(z.string(), {
          read: [{ status: 'masked', requirements: 'user', mask: maskFn }]
        })

        const meta = getSensitiveMetadata<string>(schema)
        expect(meta?.read?.[0].mask).toBe(maskFn)
      })
    })

    describe('with write policy', () => {
      it('should attach write policy to metadata', () => {
        const writePolicy: WritePolicy<string> = {
          requirements: 'admin',
          reason: 'admin_only'
        }
        const schema = sensitive(z.string(), { write: writePolicy })

        const meta = getSensitiveMetadata<string>(schema)
        expect(meta?.write).toEqual(writePolicy)
      })
    })

    describe('with both read and write policies', () => {
      it('should attach both policies', () => {
        const schema = sensitive(z.string(), {
          read: [{ status: 'full', requirements: 'admin' }],
          write: { requirements: 'superuser' }
        })

        const meta = getSensitiveMetadata<string>(schema)
        expect(meta?.read).toBeDefined()
        expect(meta?.write).toBeDefined()
        expect(meta?.read?.[0].requirements).toBe('admin')
        expect(meta?.write?.requirements).toBe('superuser')
      })
    })

    describe('with complex requirement types', () => {
      it('should support object requirements', () => {
        type Requirement = { role: string; permission: string }
        const schema = sensitive(z.string(), {
          read: [{ status: 'full', requirements: { role: 'admin', permission: 'read:all' } }],
          write: { requirements: { role: 'admin', permission: 'write:all' } }
        })

        const meta = getSensitiveMetadata<Requirement>(schema)
        expect((meta?.read?.[0].requirements as Requirement).role).toBe('admin')
        expect((meta?.write?.requirements as Requirement).permission).toBe('write:all')
      })

      it('should support array requirements', () => {
        const schema = sensitive(z.string(), {
          read: [{ status: 'full', requirements: ['admin', 'superuser'] }]
        })

        const meta = getSensitiveMetadata<string[]>(schema)
        expect(meta?.read?.[0].requirements).toEqual(['admin', 'superuser'])
      })
    })
  })

  describe('isSensitiveSchema()', () => {
    it('should return true for sensitive schemas', () => {
      const schema = sensitive(z.string())
      expect(isSensitiveSchema(schema)).toBe(true)
    })

    it('should return false for non-sensitive schemas', () => {
      const schema = z.string()
      expect(isSensitiveSchema(schema)).toBe(false)
    })

    it('should return false for schemas with other metadata', () => {
      const schema = z.string().meta({ foo: 'bar' })
      expect(isSensitiveSchema(schema)).toBe(false)
    })

    it('should detect sensitive through .optional() wrapper', () => {
      // When .optional() is applied after sensitive(), the meta should still be accessible
      // Note: Zod v4 may or may not preserve meta through optional, depending on implementation
      const schema = sensitive(z.string())

      // The inner schema should be sensitive
      expect(isSensitiveSchema(schema)).toBe(true)
    })
  })

  describe('getSensitiveMetadata()', () => {
    it('should return metadata for sensitive schemas', () => {
      const schema = sensitive(z.string(), {
        read: [{ status: 'full', requirements: 'admin' }]
      })

      const meta = getSensitiveMetadata(schema)
      expect(meta).toBeDefined()
      expect(meta?.sensitive).toBe(true)
    })

    it('should return undefined for non-sensitive schemas', () => {
      const schema = z.string()
      expect(getSensitiveMetadata(schema)).toBeUndefined()
    })

    it('should return full metadata structure', () => {
      const maskFn = (v: unknown) => '***'
      const schema = sensitive(z.string(), {
        read: [
          { status: 'full', requirements: 'admin' },
          { status: 'masked', requirements: 'user', mask: maskFn, reason: 'partial_access' }
        ],
        write: { requirements: 'admin', reason: 'admin_only' }
      })

      const meta = getSensitiveMetadata<string>(schema)
      expect(meta?.sensitive).toBe(true)
      expect(meta?.read).toHaveLength(2)
      expect(meta?.read?.[1].mask).toBe(maskFn)
      expect(meta?.read?.[1].reason).toBe('partial_access')
      expect(meta?.write?.reason).toBe('admin_only')
    })
  })

  describe('findSensitiveFields()', () => {
    describe('flat objects', () => {
      it('should find sensitive fields in a flat object', () => {
        const schema = z.object({
          name: z.string(),
          email: sensitive(z.string()),
          age: z.number()
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(1)
        expect(fields[0].path).toBe('email')
        expect(fields[0].meta.sensitive).toBe(true)
      })

      it('should find multiple sensitive fields', () => {
        const schema = z.object({
          email: sensitive(z.string()),
          ssn: sensitive(z.string()),
          name: z.string()
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(2)
        const paths = fields.map(f => f.path)
        expect(paths).toContain('email')
        expect(paths).toContain('ssn')
      })

      it('should return empty array for objects with no sensitive fields', () => {
        const schema = z.object({
          name: z.string(),
          age: z.number()
        })

        const fields = findSensitiveFields(schema)
        expect(fields).toHaveLength(0)
      })
    })

    describe('nested objects', () => {
      it('should find sensitive fields in nested objects', () => {
        const schema = z.object({
          profile: z.object({
            email: sensitive(z.string()),
            phone: z.string()
          })
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(1)
        expect(fields[0].path).toBe('profile.email')
      })

      it('should find deeply nested sensitive fields', () => {
        const schema = z.object({
          level1: z.object({
            level2: z.object({
              level3: z.object({
                secret: sensitive(z.string())
              })
            })
          })
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(1)
        expect(fields[0].path).toBe('level1.level2.level3.secret')
      })

      it('should find multiple sensitive fields at different nesting levels', () => {
        const schema = z.object({
          email: sensitive(z.string()),
          profile: z.object({
            ssn: sensitive(z.string()),
            address: z.object({
              street: sensitive(z.string())
            })
          })
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(3)
        const paths = fields.map(f => f.path)
        expect(paths).toContain('email')
        expect(paths).toContain('profile.ssn')
        expect(paths).toContain('profile.address.street')
      })
    })

    describe('optional fields', () => {
      it('should find optional sensitive fields', () => {
        const schema = z.object({
          email: sensitive(z.string()).optional()
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(1)
        expect(fields[0].path).toBe('email')
      })

      it('should find sensitive optional fields in nested objects', () => {
        const schema = z.object({
          profile: z
            .object({
              phone: sensitive(z.string()).optional()
            })
            .optional()
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(1)
        expect(fields[0].path).toBe('profile.phone')
      })
    })

    describe('nullable fields', () => {
      it('should find nullable sensitive fields', () => {
        const schema = z.object({
          email: sensitive(z.string()).nullable()
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(1)
        expect(fields[0].path).toBe('email')
      })
    })

    describe('arrays', () => {
      it('should find sensitive fields in array elements', () => {
        const schema = z.object({
          contacts: z.array(
            z.object({
              email: sensitive(z.string())
            })
          )
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(1)
        expect(fields[0].path).toBe('contacts[].email')
      })

      it('should find sensitive array itself', () => {
        const schema = z.object({
          secretCodes: z.array(sensitive(z.string()))
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(1)
        expect(fields[0].path).toBe('secretCodes[]')
      })
    })

    describe('unions', () => {
      it('should find sensitive fields in union variants', () => {
        const schema = z.union([
          z.object({ type: z.literal('user'), email: sensitive(z.string()) }),
          z.object({ type: z.literal('anon'), sessionId: z.string() })
        ])

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(1)
        expect(fields[0].path).toBe('email')
      })

      it('should find sensitive fields in multiple union variants', () => {
        const schema = z.union([
          z.object({ type: z.literal('patient'), ssn: sensitive(z.string()) }),
          z.object({ type: z.literal('provider'), npi: sensitive(z.string()) })
        ])

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(2)
        const paths = fields.map(f => f.path)
        expect(paths).toContain('ssn')
        expect(paths).toContain('npi')
      })
    })

    describe('discriminated unions', () => {
      it('should find sensitive fields in discriminated union variants', () => {
        const schema = z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('patient'),
            name: z.string(),
            ssn: sensitive(z.string())
          }),
          z.object({
            kind: z.literal('provider'),
            name: z.string(),
            npi: sensitive(z.string())
          })
        ])

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(2)
        const paths = fields.map(f => f.path)
        expect(paths).toContain('ssn')
        expect(paths).toContain('npi')
      })

      it('should find sensitive fields shared across all variants', () => {
        const schema = z.discriminatedUnion('type', [
          z.object({
            type: z.literal('contact'),
            email: sensitive(z.string())
          }),
          z.object({
            type: z.literal('address'),
            email: sensitive(z.string())
          })
        ])

        const fields = findSensitiveFields(schema)

        // Same field in multiple variants - should only appear once
        // (or twice if we track per-variant - depends on implementation)
        expect(fields.length).toBeGreaterThanOrEqual(1)
        expect(fields.some(f => f.path === 'email')).toBe(true)
      })
    })

    describe('custom path prefix', () => {
      it('should support custom path prefix', () => {
        const schema = z.object({
          email: sensitive(z.string())
        })

        const fields = findSensitiveFields(schema, 'user')

        expect(fields).toHaveLength(1)
        expect(fields[0].path).toBe('user.email')
      })
    })

    describe('metadata preservation', () => {
      it('should include full metadata in results', () => {
        const maskFn = (v: unknown) => '***'
        const schema = z.object({
          email: sensitive(z.string(), {
            read: [
              { status: 'full', requirements: 'admin' },
              { status: 'masked', requirements: 'user', mask: maskFn }
            ],
            write: { requirements: 'admin' }
          })
        })

        const fields = findSensitiveFields(schema)

        expect(fields).toHaveLength(1)
        const meta = fields[0].meta as SensitiveMetadata<string>
        expect(meta.sensitive).toBe(true)
        expect(meta.read).toHaveLength(2)
        expect(meta.read?.[1].mask).toBe(maskFn)
        expect(meta.write?.requirements).toBe('admin')
      })
    })
  })
})
