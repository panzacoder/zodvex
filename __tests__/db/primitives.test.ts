import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { decodeDoc, encodeDoc } from '../../src/db/primitives'
import { zodTable } from '../../src/tables'
import { zx } from '../../src/zx'

describe('decodeDoc', () => {
  it('decodes a wire-format document using zodTable schema', () => {
    const Events = zodTable('events', {
      title: z.string(),
      startDate: zx.date()
    })

    const wire = {
      _id: 'events:123' as any,
      _creationTime: 1000,
      title: 'Meeting',
      startDate: 1700000000000
    }

    const decoded = decodeDoc(Events.schema.doc, wire)
    expect(decoded.title).toBe('Meeting')
    expect(decoded.startDate).toBeInstanceOf(Date)
    expect(decoded.startDate.getTime()).toBe(1700000000000)
  })

  it('returns null passthrough for null input', () => {
    const Users = zodTable('users', { name: z.string() })
    const result = decodeDoc(Users.schema.doc.nullable(), null)
    expect(result).toBeNull()
  })
})

describe('encodeDoc', () => {
  it('encodes a runtime document to wire format', () => {
    const Events = zodTable('events', {
      title: z.string(),
      startDate: zx.date()
    })

    const runtime = {
      _id: 'events:123' as any,
      _creationTime: 1000,
      title: 'Meeting',
      startDate: new Date(1700000000000)
    }

    const encoded = encodeDoc(Events.schema.doc, runtime)
    expect(encoded.title).toBe('Meeting')
    expect(encoded.startDate).toBe(1700000000000)
    expect(typeof encoded.startDate).toBe('number')
  })

  it('strips undefined values from encoded output', () => {
    const Users = zodTable('users', {
      name: z.string(),
      bio: z.string().optional()
    })

    const runtime = {
      _id: 'users:1' as any,
      _creationTime: 1000,
      name: 'John',
      bio: undefined
    }

    const encoded = encodeDoc(Users.schema.doc, runtime)
    expect('bio' in encoded).toBe(false)
  })
})
