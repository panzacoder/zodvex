import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'
import { zodToSource } from '../src/codegen/zodToSource'

describe('zodToSource', () => {
  describe('primitives', () => {
    it('z.string()', () => {
      expect(zodToSource(z.string())).toBe('z.string()')
    })

    it('z.number()', () => {
      expect(zodToSource(z.number())).toBe('z.number()')
    })

    it('z.boolean()', () => {
      expect(zodToSource(z.boolean())).toBe('z.boolean()')
    })

    it('z.null()', () => {
      expect(zodToSource(z.null())).toBe('z.null()')
    })

    it('z.undefined()', () => {
      expect(zodToSource(z.undefined())).toBe('z.undefined()')
    })

    it('z.any()', () => {
      expect(zodToSource(z.any())).toBe('z.any()')
    })
  })

  describe('objects', () => {
    it('z.object({ a: z.string(), b: z.number() })', () => {
      expect(zodToSource(z.object({ a: z.string(), b: z.number() }))).toBe(
        'z.object({ a: z.string(), b: z.number() })'
      )
    })
  })

  describe('arrays', () => {
    it('z.array(z.string())', () => {
      expect(zodToSource(z.array(z.string()))).toBe('z.array(z.string())')
    })
  })

  describe('modifiers', () => {
    it('.optional()', () => {
      expect(zodToSource(z.string().optional())).toBe('z.string().optional()')
    })

    it('.nullable()', () => {
      expect(zodToSource(z.string().nullable())).toBe('z.string().nullable()')
    })

    it('.optional().nullable()', () => {
      expect(zodToSource(z.string().optional().nullable())).toBe('z.string().optional().nullable()')
    })
  })

  describe('zodvex extensions', () => {
    it('zx.id("users")', () => {
      expect(zodToSource(zx.id('users'))).toBe('zx.id("users")')
    })

    it('zx.id("teams")', () => {
      expect(zodToSource(zx.id('teams'))).toBe('zx.id("teams")')
    })

    it('zx.date()', () => {
      expect(zodToSource(zx.date())).toBe('zx.date()')
    })
  })

  describe('enums', () => {
    it('z.enum(["a", "b"])', () => {
      expect(zodToSource(z.enum(['a', 'b']))).toBe('z.enum(["a", "b"])')
    })
  })

  describe('literals', () => {
    it('z.literal("hello")', () => {
      expect(zodToSource(z.literal('hello'))).toBe('z.literal("hello")')
    })

    it('z.literal(42)', () => {
      expect(zodToSource(z.literal(42))).toBe('z.literal(42)')
    })

    it('z.literal(true)', () => {
      expect(zodToSource(z.literal(true))).toBe('z.literal(true)')
    })
  })

  describe('unions', () => {
    it('z.union([z.string(), z.number()])', () => {
      expect(zodToSource(z.union([z.string(), z.number()]))).toBe(
        'z.union([z.string(), z.number()])'
      )
    })
  })

  describe('tuples', () => {
    it('z.tuple([z.string(), z.number()])', () => {
      expect(zodToSource(z.tuple([z.string(), z.number()]))).toBe(
        'z.tuple([z.string(), z.number()])'
      )
    })
  })

  describe('records', () => {
    it('z.record(z.string(), z.number())', () => {
      expect(zodToSource(z.record(z.string(), z.number()))).toBe('z.record(z.string(), z.number())')
    })
  })

  describe('nested', () => {
    it('objects containing objects and arrays', () => {
      const schema = z.object({
        name: z.string(),
        tags: z.array(z.string()),
        address: z.object({
          city: z.string(),
          zip: z.number()
        })
      })
      expect(zodToSource(schema)).toBe(
        'z.object({ name: z.string(), tags: z.array(z.string()), address: z.object({ city: z.string(), zip: z.number() }) })'
      )
    })
  })

  describe('unsupported', () => {
    it('z.custom() falls back to z.any() with comment', () => {
      const schema = z.custom<string>(() => true)
      expect(zodToSource(schema)).toBe('z.any() /* unsupported: custom */')
    })
  })
})
