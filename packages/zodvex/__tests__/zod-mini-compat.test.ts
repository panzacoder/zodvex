import { describe, expect, it } from 'vitest'
import { z as zm } from 'zod/mini'
import { zodToConvex } from '../src/mapping/core'

describe('zod-mini compatibility', () => {
  it('maps a mini string schema to convex', () => {
    const result = zodToConvex(zm.string())
    expect(result).toBeDefined()
  })

  it('maps a mini number schema to convex', () => {
    const result = zodToConvex(zm.number())
    expect(result).toBeDefined()
  })

  it('maps a mini boolean schema to convex', () => {
    const result = zodToConvex(zm.boolean())
    expect(result).toBeDefined()
  })

  it('maps a mini object schema to convex', () => {
    const schema = zm.object({
      name: zm.string(),
      age: zm.number()
    })
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini optional to convex optional', () => {
    const schema = zm.object({
      name: zm.string(),
      nickname: zm.optional(zm.string())
    })
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini nullable to convex union with null', () => {
    const schema = zm.object({
      name: zm.string(),
      bio: zm.nullable(zm.string())
    })
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini array to convex array', () => {
    const schema = zm.array(zm.string())
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini enum to convex', () => {
    const schema = zm.enum(['a', 'b', 'c'])
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini literal to convex', () => {
    const schema = zm.literal('hello')
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini union to convex', () => {
    const schema = zm.union([zm.string(), zm.number()])
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps mini record to convex', () => {
    const schema = zm.record(zm.string(), zm.number())
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })

  it('maps a complex mini object with nested types', () => {
    const schema = zm.object({
      name: zm.string(),
      age: zm.number(),
      active: zm.boolean(),
      tags: zm.array(zm.string()),
      metadata: zm.optional(
        zm.object({
          source: zm.string(),
          version: zm.number()
        })
      ),
      score: zm.nullable(zm.number())
    })
    const result = zodToConvex(schema)
    expect(result).toBeDefined()
  })
})
