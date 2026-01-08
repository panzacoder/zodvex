/**
 * Tests for src/security/db.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests secure database wrappers: createSecureReader, createSecureWriter
 */

import { describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'
import { createSecureReader, createSecureWriter } from '../../src/security/db'
import { sensitive } from '../../src/security/sensitive'
import type { RlsRule } from '../../src/security/types'

// Test types
type TestCtx = { userId: string; role: 'admin' | 'user' }
type TestDoc = { _id: string; ownerId: string; title: string; email?: { __sensitiveValue: string } }

// Mock database implementation
function createMockDb(docs: Record<string, TestDoc>) {
  return {
    get: mock(async (id: string) => docs[id] ?? null),
    query: mock((table: string) => ({
      filter: () => ({
        collect: async () => Object.values(docs)
      })
    })),
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

describe('security/db.ts', () => {
  describe('createSecureReader', () => {
    describe('get()', () => {
      it('should return document when RLS allows', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user1', title: 'Test' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const rules: Record<string, RlsRule<TestCtx, TestDoc>> = {
          posts: { read: (ctx, doc) => ctx.userId === doc.ownerId }
        }

        const reader = createSecureReader(mockDb as any, ctx, { rules, resolver: async () => true })
        const result = await reader.get('posts', 'doc1')

        expect(result).not.toBeNull()
        expect(result?._id).toBe('doc1')
      })

      it('should return null when RLS denies', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user2', title: 'Test' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const rules: Record<string, RlsRule<TestCtx, TestDoc>> = {
          posts: { read: (ctx, doc) => ctx.userId === doc.ownerId }
        }

        const reader = createSecureReader(mockDb as any, ctx, { rules, resolver: async () => true })
        const result = await reader.get('posts', 'doc1')

        expect(result).toBeNull()
      })

      it('should return null when document not found', async () => {
        const mockDb = createMockDb({})
        const ctx: TestCtx = { userId: 'user1', role: 'user' }

        const reader = createSecureReader(mockDb as any, ctx, { resolver: async () => true })
        const result = await reader.get('posts', 'nonexistent')

        expect(result).toBeNull()
      })

      it('should allow all when no RLS rules defined', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user2', title: 'Test' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }

        const reader = createSecureReader(mockDb as any, ctx, { resolver: async () => true })
        const result = await reader.get('posts', 'doc1')

        expect(result).not.toBeNull()
      })

      it('should apply FLS when schema is provided', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: {
            _id: 'doc1',
            ownerId: 'user1',
            title: 'Test',
            email: { __sensitiveValue: 'secret@example.com' }
          }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }

        const schema = z.object({
          _id: z.string(),
          ownerId: z.string(),
          title: z.string(),
          email: sensitive(z.string(), {
            read: [{ status: 'full', requirements: { role: 'admin' } }]
          }).optional()
        })

        const resolver = async (_ctx: any, req: { role: string }) => {
          return ctx.role === req.role
        }

        const reader = createSecureReader(mockDb as any, ctx, {
          resolver,
          schemas: { posts: schema }
        })
        const result = await reader.get('posts', 'doc1')

        // User is not admin, so email should be hidden
        expect(result).not.toBeNull()
        expect(result?.email).toBeDefined()
        expect((result?.email as any)?.status).toBe('hidden')
      })
    })

    describe('query()', () => {
      it('should filter documents by RLS', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user1', title: 'My Doc' },
          doc2: { _id: 'doc2', ownerId: 'user2', title: 'Other Doc' },
          doc3: { _id: 'doc3', ownerId: 'user1', title: 'Another My Doc' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const rules: Record<string, RlsRule<TestCtx, TestDoc>> = {
          posts: { read: (ctx, doc) => ctx.userId === doc.ownerId }
        }

        const reader = createSecureReader(mockDb as any, ctx, { rules, resolver: async () => true })
        const result = await reader.query('posts', () => true)

        expect(result).toHaveLength(2)
        expect(result.map(d => d._id)).toContain('doc1')
        expect(result.map(d => d._id)).toContain('doc3')
        expect(result.map(d => d._id)).not.toContain('doc2')
      })

      it('should return all when no RLS rules', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user1', title: 'Doc 1' },
          doc2: { _id: 'doc2', ownerId: 'user2', title: 'Doc 2' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }

        const reader = createSecureReader(mockDb as any, ctx, { resolver: async () => true })
        const result = await reader.query('posts', () => true)

        expect(result).toHaveLength(2)
      })

      it('should apply FLS to each document in query results', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: {
            _id: 'doc1',
            ownerId: 'user1',
            title: 'Test 1',
            email: { __sensitiveValue: 'a@example.com' }
          },
          doc2: {
            _id: 'doc2',
            ownerId: 'user1',
            title: 'Test 2',
            email: { __sensitiveValue: 'b@example.com' }
          }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'admin' }

        const schema = z.object({
          _id: z.string(),
          ownerId: z.string(),
          title: z.string(),
          email: sensitive(z.string(), {
            read: [{ status: 'full', requirements: { role: 'admin' } }]
          }).optional()
        })

        const resolver = async (_ctx: any, req: { role: string }) => {
          return ctx.role === req.role
        }

        const reader = createSecureReader(mockDb as any, ctx, {
          resolver,
          schemas: { posts: schema }
        })
        const result = await reader.query('posts', () => true)

        // Admin should see full values
        expect(result).toHaveLength(2)
        for (const doc of result) {
          expect((doc.email as any)?.status).toBe('full')
        }
      })
    })
  })

  describe('createSecureWriter', () => {
    describe('insert()', () => {
      it('should allow insert when RLS permits', async () => {
        const docs: Record<string, TestDoc> = {}
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const rules: Record<string, RlsRule<TestCtx, TestDoc>> = {
          posts: { insert: (ctx, doc) => ctx.userId === doc.ownerId }
        }

        const writer = createSecureWriter(mockDb as any, ctx, { rules, resolver: async () => true })
        const newDoc: TestDoc = { _id: '', ownerId: 'user1', title: 'New Post' }
        const id = await writer.insert('posts', newDoc)

        expect(id).toBeDefined()
        expect(mockDb.insert).toHaveBeenCalled()
      })

      it('should throw when RLS denies insert', async () => {
        const docs: Record<string, TestDoc> = {}
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const rules: Record<string, RlsRule<TestCtx, TestDoc>> = {
          posts: { insert: (ctx, doc) => ctx.userId === doc.ownerId }
        }

        const writer = createSecureWriter(mockDb as any, ctx, { rules, resolver: async () => true })
        const newDoc: TestDoc = { _id: '', ownerId: 'user2', title: 'Not My Post' }

        await expect(writer.insert('posts', newDoc)).rejects.toThrow('RLS denied insert')
      })

      it('should allow insert when no RLS rules', async () => {
        const docs: Record<string, TestDoc> = {}
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }

        const writer = createSecureWriter(mockDb as any, ctx, { resolver: async () => true })
        const newDoc: TestDoc = { _id: '', ownerId: 'user2', title: 'Any Post' }
        const id = await writer.insert('posts', newDoc)

        expect(id).toBeDefined()
      })
    })

    describe('patch()', () => {
      it('should allow update when RLS permits', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user1', title: 'Original' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const rules: Record<string, RlsRule<TestCtx, TestDoc>> = {
          posts: { update: (ctx, old, _new) => ctx.userId === old.ownerId }
        }

        const writer = createSecureWriter(mockDb as any, ctx, { rules, resolver: async () => true })
        await writer.patch('posts', 'doc1', { title: 'Updated' })

        expect(mockDb.patch).toHaveBeenCalledWith('doc1', { title: 'Updated' })
      })

      it('should throw when RLS denies update', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user2', title: 'Original' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const rules: Record<string, RlsRule<TestCtx, TestDoc>> = {
          posts: { update: (ctx, old, _new) => ctx.userId === old.ownerId }
        }

        const writer = createSecureWriter(mockDb as any, ctx, { rules, resolver: async () => true })

        await expect(writer.patch('posts', 'doc1', { title: 'Updated' })).rejects.toThrow(
          'RLS denied update'
        )
      })

      it('should throw when document not found', async () => {
        const mockDb = createMockDb({})
        const ctx: TestCtx = { userId: 'user1', role: 'user' }

        const writer = createSecureWriter(mockDb as any, ctx, { resolver: async () => true })

        await expect(writer.patch('posts', 'nonexistent', { title: 'Updated' })).rejects.toThrow(
          'Document not found'
        )
      })
    })

    describe('delete()', () => {
      it('should allow delete when RLS permits', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user1', title: 'To Delete' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'admin' }
        const rules: Record<string, RlsRule<TestCtx, TestDoc>> = {
          posts: { delete: ctx => ctx.role === 'admin' }
        }

        const writer = createSecureWriter(mockDb as any, ctx, { rules, resolver: async () => true })
        await writer.delete('posts', 'doc1')

        expect(mockDb.delete).toHaveBeenCalledWith('doc1')
      })

      it('should throw when RLS denies delete', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user1', title: 'Protected' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const rules: Record<string, RlsRule<TestCtx, TestDoc>> = {
          posts: { delete: ctx => ctx.role === 'admin' }
        }

        const writer = createSecureWriter(mockDb as any, ctx, { rules, resolver: async () => true })

        await expect(writer.delete('posts', 'doc1')).rejects.toThrow('RLS denied delete')
      })

      it('should silently succeed when document not found', async () => {
        const mockDb = createMockDb({})
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const rules: Record<string, RlsRule<TestCtx, TestDoc>> = {
          posts: { delete: () => false } // Would deny if doc existed
        }

        const writer = createSecureWriter(mockDb as any, ctx, { rules, resolver: async () => true })

        // Should not throw - doc doesn't exist
        await expect(writer.delete('posts', 'nonexistent')).resolves.toBeUndefined()
      })
    })

    describe('reader methods on writer', () => {
      it('should have get() from reader', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user1', title: 'Test' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }

        const writer = createSecureWriter(mockDb as any, ctx, { resolver: async () => true })
        const result = await writer.get('posts', 'doc1')

        expect(result).not.toBeNull()
        expect(result?._id).toBe('doc1')
      })

      it('should have query() from reader', async () => {
        const docs: Record<string, TestDoc> = {
          doc1: { _id: 'doc1', ownerId: 'user1', title: 'Test' }
        }
        const mockDb = createMockDb(docs)
        const ctx: TestCtx = { userId: 'user1', role: 'user' }

        const writer = createSecureWriter(mockDb as any, ctx, { resolver: async () => true })
        const result = await writer.query('posts', () => true)

        expect(result).toHaveLength(1)
      })
    })
  })
})
