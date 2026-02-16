import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { defineZodSchema } from '../src/schema'
import { zodTable } from '../src/tables'

describe('defineZodSchema', () => {
  const Users = zodTable('users', {
    name: z.string(),
    email: z.string()
  })

  const Events = zodTable('events', {
    title: z.string(),
    date: z.number()
  })

  it('returns an object with .zodTables preserving the input', () => {
    const schema = defineZodSchema({ users: Users, events: Events })
    expect(schema.zodTables.users).toBe(Users)
    expect(schema.zodTables.events).toBe(Events)
  })

  it('returns an object with .tables containing Convex table defs', () => {
    const schema = defineZodSchema({ users: Users, events: Events })
    expect(schema.tables).toBeDefined()
    expect(schema.tables.users).toBe(Users.table)
    expect(schema.tables.events).toBe(Events.table)
  })

  it('preserves table names from zodTable', () => {
    const schema = defineZodSchema({ users: Users, events: Events })
    expect(Object.keys(schema.zodTables)).toEqual(['users', 'events'])
  })
})
