/**
 * Tests for src/security/secure-wrappers.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests secure function wrappers: zSecureQuery, zSecureMutation, zSecureAction
 */

import { describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { zSecureQuery, zSecureMutation, zSecureAction } from '../../src/security/secure-wrappers'
import { sensitive } from '../../src/security/sensitive'
import type { RlsRule } from '../../src/security/types'

// Test types
type SecurityCtx = { userId: string; role: 'admin' | 'user' }
type TestDoc = { _id: string; ownerId: string; title: string; email?: { __sensitiveValue: string } }

// Mock query builder that supports chaining
function createMockQueryBuilder(docs: TestDoc[]) {
  const builder = {
    filter: mock(() => builder),
    withIndex: mock(() => builder),
    order: mock(() => builder),
    collect: mock(async () => docs)
  }
  return builder
}

// Mock Convex contexts
function createMockQueryCtx(docs: Record<string, TestDoc>) {
  return {
    db: {
      get: mock(async (id: string) => docs[id] ?? null),
      query: mock((table: string) => createMockQueryBuilder(Object.values(docs)))
    }
  }
}

function createMockMutationCtx(docs: Record<string, TestDoc>) {
  return {
    db: {
      get: mock(async (id: string) => docs[id] ?? null),
      query: mock((table: string) => createMockQueryBuilder(Object.values(docs))),
      insert: mock(async (table: string, doc: TestDoc) => {
        const id = `new_${Date.now()}`
        docs[id] = { ...doc, _id: id }
        return id
      }),
      patch: mock(async (id: string, patch: Partial<TestDoc>) => {
        if (docs[id]) {
          docs[id] = { ...docs[id], ...patch }
        }
      }),
      delete: mock(async (id: string) => {
        delete docs[id]
      })
    }
  }
}

function createMockActionCtx() {
  return {
    runQuery: mock(async () => null),
    runMutation: mock(async () => null)
  }
}

describe('security/secure-wrappers.ts', () => {
  describe('zSecureQuery', () => {
    it('should resolve security context before handler', async () => {
      let capturedCtx: SecurityCtx | null = null
      const resolveContext = mock(async () => ({ userId: 'user1', role: 'admin' as const }))

      const secureQuery = zSecureQuery({
        resolveContext,
        resolver: async () => true
      })

      const query = secureQuery({
        args: z.object({ id: z.string() }),
        returns: z.string().nullable(),
        handler: async (ctx, args) => {
          capturedCtx = ctx.securityCtx
          return 'result'
        }
      })

      const mockCtx = createMockQueryCtx({})
      await query.handler(mockCtx as any, { id: 'test' })

      expect(resolveContext).toHaveBeenCalled()
      expect(capturedCtx).toEqual({ userId: 'user1', role: 'admin' })
    })

    it('should call authorize if provided', async () => {
      const authorize = mock(async () => {})

      const secureQuery = zSecureQuery({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true,
        authorize
      })

      const query = secureQuery({
        args: z.object({ id: z.string() }),
        returns: z.string().nullable(),
        handler: async () => 'result'
      })

      const mockCtx = createMockQueryCtx({})
      await query.handler(mockCtx as any, { id: 'test' })

      expect(authorize).toHaveBeenCalled()
    })

    it('should throw if authorize throws', async () => {
      const secureQuery = zSecureQuery({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true,
        authorize: async () => {
          throw new Error('Unauthorized')
        }
      })

      const query = secureQuery({
        args: z.object({ id: z.string() }),
        returns: z.string().nullable(),
        handler: async () => 'result'
      })

      const mockCtx = createMockQueryCtx({})
      await expect(query.handler(mockCtx as any, { id: 'test' })).rejects.toThrow('Unauthorized')
    })

    it('should provide secure db reader to handler', async () => {
      const docs: Record<string, TestDoc> = {
        doc1: { _id: 'doc1', ownerId: 'user1', title: 'Test' }
      }

      const secureQuery = zSecureQuery({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true
      })

      const query = secureQuery({
        args: z.object({ id: z.string() }),
        returns: z.any(),
        handler: async (ctx, args) => {
          return ctx.db.get('posts', args.id)
        }
      })

      const mockCtx = createMockQueryCtx(docs)
      const result = await query.handler(mockCtx as any, { id: 'doc1' })

      expect(result).not.toBeNull()
      expect(result._id).toBe('doc1')
    })

    it('should apply RLS rules to db queries', async () => {
      const docs: Record<string, TestDoc> = {
        doc1: { _id: 'doc1', ownerId: 'user1', title: 'My Doc' },
        doc2: { _id: 'doc2', ownerId: 'user2', title: 'Other Doc' }
      }
      const rules: Record<string, RlsRule<SecurityCtx, TestDoc>> = {
        posts: { read: (ctx, doc) => ctx.userId === doc.ownerId }
      }

      const secureQuery = zSecureQuery({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true,
        rules
      })

      const query = secureQuery({
        args: z.object({}),
        returns: z.any(),
        handler: async ctx => {
          return ctx.db.query('posts')
        }
      })

      const mockCtx = createMockQueryCtx(docs)
      const result = await query.handler(mockCtx as any, {})

      expect(result).toHaveLength(1)
      expect(result[0]._id).toBe('doc1')
    })

    it('should apply FLS to return value', async () => {
      const schema = z.object({
        _id: z.string(),
        title: z.string(),
        secret: sensitive(z.string(), {
          read: [{ status: 'full', requirements: { role: 'admin' } }]
        }).optional()
      })

      const secureQuery = zSecureQuery<SecurityCtx, { role: string }>({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async (ctx, req) => ctx.ctx.role === req.role
      })

      const query = secureQuery({
        args: z.object({}),
        returns: schema,
        handler: async () => ({
          _id: 'doc1',
          title: 'Test',
          secret: { __sensitiveValue: 'hidden value' }
        })
      })

      const mockCtx = createMockQueryCtx({})
      const result = await query.handler(mockCtx as any, {})

      // User is not admin, so secret should be hidden
      expect(result.secret).toBeDefined()
      expect((result.secret as any).status).toBe('hidden')
    })
  })

  describe('zSecureMutation', () => {
    it('should resolve security context before handler', async () => {
      let capturedCtx: SecurityCtx | null = null

      const secureMutation = zSecureMutation({
        resolveContext: async () => ({ userId: 'user1', role: 'admin' as const }),
        resolver: async () => true
      })

      const mutation = secureMutation({
        args: z.object({ title: z.string() }),
        returns: z.string(),
        handler: async (ctx, args) => {
          capturedCtx = ctx.securityCtx
          return 'created'
        }
      })

      const mockCtx = createMockMutationCtx({})
      await mutation.handler(mockCtx as any, { title: 'New Post' })

      expect(capturedCtx).toEqual({ userId: 'user1', role: 'admin' })
    })

    it('should provide secure db writer to handler', async () => {
      const docs: Record<string, TestDoc> = {}
      const rules: Record<string, RlsRule<SecurityCtx, TestDoc>> = {
        posts: { insert: (ctx, doc) => ctx.userId === doc.ownerId }
      }

      const secureMutation = zSecureMutation({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true,
        rules
      })

      const mutation = secureMutation({
        args: z.object({ title: z.string() }),
        returns: z.string(),
        handler: async (ctx, args) => {
          const id = await ctx.db.insert('posts', {
            _id: '',
            ownerId: 'user1',
            title: args.title
          } as TestDoc)
          return id
        }
      })

      const mockCtx = createMockMutationCtx(docs)
      const result = await mutation.handler(mockCtx as any, { title: 'New Post' })

      expect(result).toBeDefined()
      expect(mockCtx.db.insert).toHaveBeenCalled()
    })

    it('should apply RLS on insert', async () => {
      const docs: Record<string, TestDoc> = {}
      const rules: Record<string, RlsRule<SecurityCtx, TestDoc>> = {
        posts: { insert: (ctx, doc) => ctx.userId === doc.ownerId }
      }

      const secureMutation = zSecureMutation({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true,
        rules
      })

      const mutation = secureMutation({
        args: z.object({ title: z.string() }),
        returns: z.string(),
        handler: async (ctx, args) => {
          // Try to insert as different user - should fail
          await ctx.db.insert('posts', {
            _id: '',
            ownerId: 'user2', // Not the current user
            title: args.title
          } as TestDoc)
          return 'created'
        }
      })

      const mockCtx = createMockMutationCtx(docs)
      await expect(mutation.handler(mockCtx as any, { title: 'Hack' })).rejects.toThrow(
        'RLS denied insert'
      )
    })

    it('should call authorize if provided', async () => {
      const authorize = mock(async () => {})

      const secureMutation = zSecureMutation({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true,
        authorize
      })

      const mutation = secureMutation({
        args: z.object({}),
        returns: z.void(),
        handler: async () => {}
      })

      const mockCtx = createMockMutationCtx({})
      await mutation.handler(mockCtx as any, {})

      expect(authorize).toHaveBeenCalled()
    })
  })

  describe('zSecureAction', () => {
    it('should resolve security context before handler', async () => {
      let capturedCtx: SecurityCtx | null = null

      const secureAction = zSecureAction({
        resolveContext: async () => ({ userId: 'user1', role: 'admin' as const }),
        resolver: async () => true
      })

      const action = secureAction({
        args: z.object({}),
        returns: z.void(),
        handler: async ctx => {
          capturedCtx = ctx.securityCtx
        }
      })

      const mockCtx = createMockActionCtx()
      await action.handler(mockCtx as any, {})

      expect(capturedCtx).toEqual({ userId: 'user1', role: 'admin' })
    })

    it('should provide runQuery and runMutation to handler', async () => {
      const secureAction = zSecureAction({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true
      })

      const action = secureAction({
        args: z.object({}),
        returns: z.void(),
        handler: async ctx => {
          expect(ctx.runQuery).toBeDefined()
          expect(ctx.runMutation).toBeDefined()
        }
      })

      const mockCtx = createMockActionCtx()
      await action.handler(mockCtx as any, {})
    })

    it('should call authorize if provided', async () => {
      const authorize = mock(async () => {})

      const secureAction = zSecureAction({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true,
        authorize
      })

      const action = secureAction({
        args: z.object({}),
        returns: z.void(),
        handler: async () => {}
      })

      const mockCtx = createMockActionCtx()
      await action.handler(mockCtx as any, {})

      expect(authorize).toHaveBeenCalled()
    })

    it('should throw if authorize throws', async () => {
      const secureAction = zSecureAction({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true,
        authorize: async () => {
          throw new Error('Forbidden')
        }
      })

      const action = secureAction({
        args: z.object({}),
        returns: z.void(),
        handler: async () => {}
      })

      const mockCtx = createMockActionCtx()
      await expect(action.handler(mockCtx as any, {})).rejects.toThrow('Forbidden')
    })
  })

  describe('type inference', () => {
    it('should correctly infer args type', async () => {
      const secureQuery = zSecureQuery({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true
      })

      const query = secureQuery({
        args: z.object({ name: z.string(), count: z.number() }),
        returns: z.string(),
        handler: async (ctx, args) => {
          // TypeScript should know args has name: string, count: number
          return `${args.name} - ${args.count}`
        }
      })

      expect(query.args).toBeDefined()
      expect(query.returns).toBeDefined()
    })

    it('should preserve schema on returned definition', () => {
      const secureQuery = zSecureQuery({
        resolveContext: async () => ({ userId: 'user1', role: 'user' as const }),
        resolver: async () => true
      })

      const argsSchema = z.object({ id: z.string() })
      const returnsSchema = z.object({ name: z.string() })

      const query = secureQuery({
        args: argsSchema,
        returns: returnsSchema,
        handler: async () => ({ name: 'test' })
      })

      expect(query.args).toBe(argsSchema)
      expect(query.returns).toBe(returnsSchema)
    })
  })
})
