import { describe, expect, it } from 'bun:test'
import { customCtx } from 'convex-helpers/server/customFunctions'
import { z } from 'zod'
import { initZodvex } from '../../src/init'
import { defineZodSchema } from '../../src/schema'
import { zodTable } from '../../src/tables'
import { zx } from '../../src/zx'

// ============================================================================
// Setup (mirrors example/convex/schema.ts pattern)
// ============================================================================

const STATE_MAP: Record<string, string> = { CA: 'California', NY: 'New York' }
const REVERSE_MAP: Record<string, string> = { California: 'CA', 'New York': 'NY' }

const stateCode = () =>
  zx.codec(z.string(), z.string(), {
    decode: (code: string) => STATE_MAP[code] ?? code,
    encode: (name: string) => REVERSE_MAP[name] ?? name
  })

const Users = zodTable('users', {
  name: z.string(),
  email: z.string(),
  state: stateCode()
})

const Events = zodTable('events', {
  title: z.string(),
  startDate: zx.date(),
  endDate: zx.date().optional(),
  organizerId: zx.id('users')
})

const schema = defineZodSchema({ users: Users, events: Events })

// In-memory mock database
function createMockDb() {
  const store: Record<string, any> = {}
  let nextId = 1

  return {
    store,
    get: async (id: string) => store[id] ?? null,
    query: (table: string) => {
      const docs = () => Object.values(store).filter((d: any) => d._table === table)
      return {
        collect: async () => docs(),
        first: async () => docs()[0] ?? null,
        unique: async () => (docs().length === 1 ? docs()[0] : null),
        take: async (n: number) => docs().slice(0, n),
        withIndex: function () {
          return this
        },
        order: function () {
          return this
        },
        filter: function () {
          return this
        }
      }
    },
    insert: async (table: string, doc: any) => {
      const id = `${table}:${nextId++}`
      store[id] = { ...doc, _id: id, _creationTime: Date.now(), _table: table }
      return id
    },
    patch: async (id: string, patch: any) => {
      if (!store[id]) throw new Error('Not found')
      Object.assign(store[id], patch)
    },
    delete: async (id: string) => {
      delete store[id]
    }
  }
}

// Mock server that passes handler through but injects mock db
function createMockServer(db: any) {
  const wrapper = (fn: any) => {
    return {
      ...fn,
      _handler: fn.handler,
      _invoke: async (args: any) => fn.handler({ db }, args)
    }
  }
  return {
    query: wrapper,
    mutation: wrapper,
    action: wrapper,
    internalQuery: wrapper,
    internalMutation: wrapper,
    internalAction: wrapper
  }
}

// ============================================================================
// SensitiveWrapper (simulates hotpot's SensitiveField codec)
// ============================================================================

const PRIVATE_VALUES = new WeakMap<any, unknown>()

class SensitiveWrapper {
  public readonly status: 'full' | 'hidden'
  constructor(value: unknown, status: 'full' | 'hidden') {
    PRIVATE_VALUES.set(this, value)
    this.status = status
  }
  static full(value: unknown) {
    return new SensitiveWrapper(value, 'full')
  }
  static hidden() {
    return new SensitiveWrapper(null, 'hidden')
  }
  expose() {
    if (this.status === 'hidden') throw new Error('Cannot expose hidden')
    return PRIVATE_VALUES.get(this)
  }
  toWire() {
    return {
      value: this.status === 'full' ? PRIVATE_VALUES.get(this) : null,
      status: this.status
    }
  }
}

const sensitiveString = zx.codec(
  z.object({ value: z.string().nullable(), status: z.enum(['full', 'hidden']) }),
  z.custom<SensitiveWrapper>(val => val instanceof SensitiveWrapper),
  {
    decode: (wire: any) =>
      wire.status === 'hidden' ? SensitiveWrapper.hidden() : SensitiveWrapper.full(wire.value),
    encode: (runtime: SensitiveWrapper) => runtime.toWire()
  }
)

// ============================================================================
// Extended schema for capstone tests
// ============================================================================

const Patients = zodTable('patients', {
  name: z.string(),
  email: sensitiveString,
  clinicId: z.string(),
  createdAt: zx.date()
})

const fullSchema = defineZodSchema({
  users: Users,
  events: Events,
  patients: Patients
})

// ============================================================================
// Tests
// ============================================================================

describe('Full codec pipeline integration', () => {
  it('decodes zx.date() on read through initZodvex builder', async () => {
    const db = createMockDb()
    db.store['events:1'] = {
      _id: 'events:1',
      _creationTime: 1000,
      _table: 'events',
      title: 'Meeting',
      startDate: 1700000000000,
      organizerId: 'users:1'
    }

    const server = createMockServer(db)
    const { zQuery } = initZodvex(schema, server as any)

    const getEvent = zQuery({
      args: { eventId: zx.id('events') },
      handler: async (ctx: any, { eventId }: any) => {
        const event = await ctx.db.get(eventId)
        expect(event.startDate).toBeInstanceOf(Date)
        expect(event.startDate.getTime()).toBe(1700000000000)
        return event
      }
    })

    await getEvent._invoke({ eventId: 'events:1' })
  })

  it('encodes stateCode() on write through initZodvex builder', async () => {
    const db = createMockDb()
    const server = createMockServer(db)
    const { zMutation } = initZodvex(schema, server as any)

    const createUser = zMutation({
      args: { name: z.string(), email: z.string(), state: stateCode() },
      handler: async (ctx: any, args: any) => {
        return ctx.db.insert('users', args)
      }
    })

    const id = await createUser._invoke({
      name: 'John',
      email: 'john@test.com',
      state: 'California'
    })

    // Wire format in DB should be "CA"
    expect(db.store[id].state).toBe('CA')
  })

  it('blessed builder with customCtx receives codec-aware ctx.db', async () => {
    const log: string[] = []
    const db = createMockDb()
    db.store['users:1'] = {
      _id: 'users:1',
      _creationTime: 1000,
      _table: 'users',
      name: 'John',
      email: 'john@test.com',
      state: 'CA'
    }

    const server = createMockServer(db)
    const { zCustomQuery } = initZodvex(schema, server as any)

    const adminQuery = zCustomQuery(
      customCtx(async (ctx: any) => {
        log.push('auth')
        const user = { name: 'Admin', role: 'admin' }

        // Wrap codec-aware db with security
        const secureDb = {
          ...ctx.db,
          query: (table: string) => {
            const chain = ctx.db.query(table)
            return {
              ...chain,
              collect: async () => {
                const docs = await chain.collect()
                log.push('security-filter')
                return docs.filter(() => user.role === 'admin')
              }
            }
          }
        }
        return { user, db: secureDb }
      })
    )

    const listUsers = adminQuery({
      args: {},
      handler: async (ctx: any) => {
        return ctx.db.query('users').collect()
      }
    })

    const result = await listUsers._invoke({})
    expect(log).toContain('auth')
    expect(log).toContain('security-filter')
    expect(result).toHaveLength(1)
    // Verify codec decoding happened (state should be decoded by codec layer)
    expect(result[0].state).toBe('California')
  })
})

describe('Full blessed-builder flow (hotpot-like scenario)', () => {
  it('initZodvex -> blessed builder -> codec db -> onSuccess audit -> wire result', async () => {
    const db = createMockDb()
    const auditLog: any[] = []

    // Seed wire-format data
    db.store['patients:1'] = {
      _id: 'patients:1',
      _creationTime: 1000,
      _table: 'patients',
      name: 'Jane Doe',
      email: { value: 'jane@example.com', status: 'full' },
      clinicId: 'clinic:1',
      createdAt: 1700000000000
    }

    const server = createMockServer(db)
    const { zCustomQuery } = initZodvex(fullSchema, server as any)

    // Blessed builder (like hotpotQuery) — uses raw customization for hooks
    const secureQuery = zCustomQuery({
      args: {},
      input: async (ctx: any) => {
        const user = { id: 'user:1', clinicId: 'clinic:1', role: 'doctor' }

        // Consumer wraps codec-aware db with RLS
        const secureDb = {
          ...ctx.db,
          get: async (id: any) => {
            const doc = await ctx.db.get(id)
            if (!doc) return null
            if (doc.clinicId !== user.clinicId) return null
            return doc
          }
        }

        return {
          ctx: { user, db: secureDb },
          args: {},
          hooks: {
            onSuccess: ({ result }: any) => {
              auditLog.push({ userId: user.id, action: 'read', result })
            }
          }
        }
      }
    })

    const getPatient = secureQuery({
      args: { patientId: z.string() },
      returns: Patients.schema.doc.nullable(),
      handler: async (ctx: any, { patientId }: any) => {
        return ctx.db.get(patientId)
      }
    })

    const wireResult = await getPatient._invoke({ patientId: 'patients:1' })

    // Wire result has encoded values (Date -> timestamp, SensitiveWrapper -> plain object)
    expect(wireResult).not.toBeNull()
    expect(typeof wireResult.createdAt).toBe('number')
    expect(wireResult.createdAt).toBe(1700000000000)
    expect(wireResult.email).toEqual({ value: 'jane@example.com', status: 'full' })

    // onSuccess saw runtime types (Date, SensitiveWrapper)
    expect(auditLog).toHaveLength(1)
    const auditEntry = auditLog[0]
    expect(auditEntry.userId).toBe('user:1')
    expect(auditEntry.result.createdAt).toBeInstanceOf(Date)
    expect(auditEntry.result.createdAt.getTime()).toBe(1700000000000)
    expect(auditEntry.result.email).toBeInstanceOf(SensitiveWrapper)
    expect(auditEntry.result.email.status).toBe('full')
    expect(auditEntry.result.email.expose()).toBe('jane@example.com')
  })

  it('mutation with codec-aware writes', async () => {
    const db = createMockDb()
    const server = createMockServer(db)
    const { zCustomMutation } = initZodvex(fullSchema, server as any)

    const secureMutation = zCustomMutation(
      customCtx(async () => {
        return { user: { id: 'user:1' } }
      })
    )

    const createPatient = secureMutation({
      args: {
        name: z.string(),
        email: sensitiveString,
        clinicId: z.string(),
        createdAt: zx.date()
      },
      handler: async (ctx: any, args: any) => {
        // Args are decoded: createdAt is a Date, email is SensitiveWrapper
        expect(args.createdAt).toBeInstanceOf(Date)
        expect(args.email).toBeInstanceOf(SensitiveWrapper)

        // ctx.db.insert encodes runtime -> wire automatically
        return ctx.db.insert('patients', args)
      }
    })

    const id = await createPatient._invoke({
      name: 'John',
      email: { value: 'john@example.com', status: 'full' },
      clinicId: 'clinic:1',
      createdAt: 1700000000000
    })

    // Verify wire format in DB
    const stored = db.store[id]
    expect(stored.name).toBe('John')
    expect(typeof stored.createdAt).toBe('number')
    expect(stored.email).toEqual({ value: 'john@example.com', status: 'full' })
  })

  it('RLS filtering works with codec-aware db', async () => {
    const db = createMockDb()
    db.store['patients:1'] = {
      _id: 'patients:1',
      _creationTime: 1000,
      _table: 'patients',
      name: 'Jane',
      email: { value: 'jane@example.com', status: 'full' },
      clinicId: 'clinic:1',
      createdAt: 1700000000000
    }
    db.store['patients:2'] = {
      _id: 'patients:2',
      _creationTime: 2000,
      _table: 'patients',
      name: 'Bob',
      email: { value: 'bob@example.com', status: 'full' },
      clinicId: 'clinic:2',
      createdAt: 1700100000000
    }

    const server = createMockServer(db)
    const { zCustomQuery } = initZodvex(fullSchema, server as any)

    // User belongs to clinic:1
    const secureQuery = zCustomQuery(
      customCtx(async (ctx: any) => {
        const user = { id: 'user:1', clinicId: 'clinic:1' }
        return {
          user,
          db: {
            ...ctx.db,
            get: async (id: any) => {
              const doc = await ctx.db.get(id)
              if (!doc) return null
              if (doc.clinicId !== user.clinicId) return null
              return doc
            }
          }
        }
      })
    )

    const getPatient = secureQuery({
      args: { id: z.string() },
      handler: async (ctx: any, { id }: any) => ctx.db.get(id)
    })

    // Can access own clinic's patient
    const result1 = await getPatient._invoke({ id: 'patients:1' })
    expect(result1).not.toBeNull()
    expect(result1.name).toBe('Jane')

    // Cannot access other clinic's patient
    const result2 = await getPatient._invoke({ id: 'patients:2' })
    expect(result2).toBeNull()
  })
})
