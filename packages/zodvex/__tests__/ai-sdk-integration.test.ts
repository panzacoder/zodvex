import { describe, expect, it } from 'bun:test'
import { jsonSchema as aiJsonSchema, generateObject } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import { zid } from '../src/ids'
import { toJSONSchema } from '../src/registry'

describe('AI SDK integration (JSON Schema)', () => {
  it('can consume zodvex JSON Schema (zid + date) via generateObject', async () => {
    const schema = z.object({
      userId: zid('users'),
      createdAt: z.date(),
      deletedAt: z.date().nullable(),
      teamId: zid('teams').optional()
    })

    const jsonSchema = toJSONSchema(schema, { target: 'draft-7' })

    const outputObject = {
      userId: 'user_abc123',
      createdAt: '2025-01-01T00:00:00.000Z',
      deletedAt: null
    }

    const model = new MockLanguageModelV3({
      provider: 'test',
      modelId: 'mock',
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify(outputObject) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 }
        },
        warnings: []
      }
    })

    const result = await generateObject({
      model,
      prompt: 'Return a JSON object that matches the schema.',
      schema: aiJsonSchema(jsonSchema as any, {
        validate: value => {
          const validator = z.object({
            userId: z.string(),
            createdAt: z.string().datetime(),
            deletedAt: z.string().datetime().nullable(),
            teamId: z.string().optional()
          })
          const parsed = validator.safeParse(value)
          return parsed.success
            ? { success: true, value: parsed.data }
            : { success: false, error: parsed.error }
        }
      })
    })

    expect(result.object).toEqual(outputObject)
    expect(model.doGenerateCalls).toHaveLength(1)

    const call = model.doGenerateCalls[0]
    expect(call.responseFormat?.type).toBe('json')

    const calledSchema: any = call.responseFormat?.schema
    expect(calledSchema.type).toBe('object')
    expect(calledSchema.properties.userId).toEqual(
      expect.objectContaining({
        type: 'string',
        format: 'convex-id:users'
      })
    )
    expect(calledSchema.properties.createdAt).toEqual(
      expect.objectContaining({
        type: 'string',
        format: 'date-time'
      })
    )
    expect(calledSchema.properties.deletedAt.anyOf).toEqual(
      expect.arrayContaining([{ type: 'string', format: 'date-time' }, { type: 'null' }])
    )
    expect(calledSchema.required).not.toContain('teamId')
  })
})
