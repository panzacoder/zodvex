/**
 * Tests for src/security/rls.ts
 *
 * TDD: Write tests first, then implement to make them pass.
 *
 * Tests Row-Level Security primitives: checkRlsRead, checkRlsWrite, filterByRls
 */

import { describe, expect, it } from 'bun:test'
import { checkRlsRead, checkRlsWrite, filterByRls } from '../../src/security/rls'
import type { RlsRule } from '../../src/security/types'

// Test types
type TestCtx = { userId: string; role: 'admin' | 'user' | 'guest' }
type TestDoc = { _id: string; ownerId: string; title: string }

describe('security/rls.ts', () => {
  describe('checkRlsRead', () => {
    it('should allow read when no rule is defined', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'user' }
      const doc: TestDoc = { _id: 'doc1', ownerId: 'user2', title: 'Test' }

      const result = await checkRlsRead(ctx, doc, undefined)

      expect(result.allowed).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should allow read when rule returns true', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'admin' }
      const doc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'Test' }
      const rule: RlsRule<TestCtx, TestDoc> = {
        read: (ctx, doc) => ctx.userId === doc.ownerId || ctx.role === 'admin'
      }

      const result = await checkRlsRead(ctx, doc, rule)

      expect(result.allowed).toBe(true)
    })

    it('should deny read when rule returns false', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'user' }
      const doc: TestDoc = { _id: 'doc1', ownerId: 'user2', title: 'Test' }
      const rule: RlsRule<TestCtx, TestDoc> = {
        read: (ctx, doc) => ctx.userId === doc.ownerId
      }

      const result = await checkRlsRead(ctx, doc, rule)

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe('rls_read_denied')
    })

    it('should handle async read rules', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'user' }
      const doc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'Test' }
      const rule: RlsRule<TestCtx, TestDoc> = {
        read: async (ctx, doc) => {
          await new Promise(resolve => setTimeout(resolve, 1))
          return ctx.userId === doc.ownerId
        }
      }

      const result = await checkRlsRead(ctx, doc, rule)

      expect(result.allowed).toBe(true)
    })

    it('should allow read when rule has no read property', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'user' }
      const doc: TestDoc = { _id: 'doc1', ownerId: 'user2', title: 'Test' }
      const rule: RlsRule<TestCtx, TestDoc> = {
        insert: () => false // Only insert rule, no read rule
      }

      const result = await checkRlsRead(ctx, doc, rule)

      expect(result.allowed).toBe(true)
    })
  })

  describe('checkRlsWrite', () => {
    describe('insert operation', () => {
      it('should allow insert when no rule is defined', async () => {
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const doc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'Test' }

        const result = await checkRlsWrite(ctx, doc, undefined, 'insert')

        expect(result.allowed).toBe(true)
      })

      it('should allow insert when rule returns true', async () => {
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const doc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'Test' }
        const rule: RlsRule<TestCtx, TestDoc> = {
          insert: (ctx, doc) => ctx.userId === doc.ownerId
        }

        const result = await checkRlsWrite(ctx, doc, rule, 'insert')

        expect(result.allowed).toBe(true)
      })

      it('should deny insert when rule returns false', async () => {
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const doc: TestDoc = { _id: 'doc1', ownerId: 'user2', title: 'Test' }
        const rule: RlsRule<TestCtx, TestDoc> = {
          insert: (ctx, doc) => ctx.userId === doc.ownerId
        }

        const result = await checkRlsWrite(ctx, doc, rule, 'insert')

        expect(result.allowed).toBe(false)
        expect(result.reason).toBe('rls_insert_denied')
      })
    })

    describe('update operation', () => {
      it('should allow update when no rule is defined', async () => {
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const oldDoc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'Old' }
        const newDoc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'New' }

        const result = await checkRlsWrite(ctx, newDoc, undefined, 'update', oldDoc)

        expect(result.allowed).toBe(true)
      })

      it('should pass both old and new doc to update rule', async () => {
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const oldDoc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'Old' }
        const newDoc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'New' }
        let receivedOld: TestDoc | undefined
        let receivedNew: TestDoc | undefined

        const rule: RlsRule<TestCtx, TestDoc> = {
          update: (ctx, old, new_) => {
            receivedOld = old
            receivedNew = new_
            return true
          }
        }

        await checkRlsWrite(ctx, newDoc, rule, 'update', oldDoc)

        expect(receivedOld).toEqual(oldDoc)
        expect(receivedNew).toEqual(newDoc)
      })

      it('should deny update when ownership changes without permission', async () => {
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const oldDoc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'Test' }
        const newDoc: TestDoc = { _id: 'doc1', ownerId: 'user2', title: 'Test' }
        const rule: RlsRule<TestCtx, TestDoc> = {
          update: (ctx, old, new_) => {
            // Only admins can change ownership
            if (old.ownerId !== new_.ownerId && ctx.role !== 'admin') {
              return false
            }
            return ctx.userId === old.ownerId
          }
        }

        const result = await checkRlsWrite(ctx, newDoc, rule, 'update', oldDoc)

        expect(result.allowed).toBe(false)
        expect(result.reason).toBe('rls_update_denied')
      })
    })

    describe('delete operation', () => {
      it('should allow delete when no rule is defined', async () => {
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const doc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'Test' }

        const result = await checkRlsWrite(ctx, doc, undefined, 'delete')

        expect(result.allowed).toBe(true)
      })

      it('should allow delete when rule returns true', async () => {
        const ctx: TestCtx = { userId: 'user1', role: 'admin' }
        const doc: TestDoc = { _id: 'doc1', ownerId: 'user2', title: 'Test' }
        const rule: RlsRule<TestCtx, TestDoc> = {
          delete: ctx => ctx.role === 'admin'
        }

        const result = await checkRlsWrite(ctx, doc, rule, 'delete')

        expect(result.allowed).toBe(true)
      })

      it('should deny delete when rule returns false', async () => {
        const ctx: TestCtx = { userId: 'user1', role: 'user' }
        const doc: TestDoc = { _id: 'doc1', ownerId: 'user2', title: 'Test' }
        const rule: RlsRule<TestCtx, TestDoc> = {
          delete: (ctx, doc) => ctx.userId === doc.ownerId
        }

        const result = await checkRlsWrite(ctx, doc, rule, 'delete')

        expect(result.allowed).toBe(false)
        expect(result.reason).toBe('rls_delete_denied')
      })
    })

    it('should handle async write rules', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'user' }
      const doc: TestDoc = { _id: 'doc1', ownerId: 'user1', title: 'Test' }
      const rule: RlsRule<TestCtx, TestDoc> = {
        insert: async (ctx, doc) => {
          await new Promise(resolve => setTimeout(resolve, 1))
          return ctx.userId === doc.ownerId
        }
      }

      const result = await checkRlsWrite(ctx, doc, rule, 'insert')

      expect(result.allowed).toBe(true)
    })
  })

  describe('filterByRls', () => {
    it('should return all docs when no rule is defined', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'user' }
      const docs: TestDoc[] = [
        { _id: 'doc1', ownerId: 'user1', title: 'Doc 1' },
        { _id: 'doc2', ownerId: 'user2', title: 'Doc 2' },
        { _id: 'doc3', ownerId: 'user3', title: 'Doc 3' }
      ]

      const result = await filterByRls(ctx, docs, undefined)

      expect(result).toHaveLength(3)
      expect(result).toEqual(docs)
    })

    it('should filter docs based on read rule', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'user' }
      const docs: TestDoc[] = [
        { _id: 'doc1', ownerId: 'user1', title: 'My Doc' },
        { _id: 'doc2', ownerId: 'user2', title: 'Other Doc' },
        { _id: 'doc3', ownerId: 'user1', title: 'Another My Doc' }
      ]
      const rule: RlsRule<TestCtx, TestDoc> = {
        read: (ctx, doc) => ctx.userId === doc.ownerId
      }

      const result = await filterByRls(ctx, docs, rule)

      expect(result).toHaveLength(2)
      expect(result.map(d => d._id)).toEqual(['doc1', 'doc3'])
    })

    it('should return empty array when all docs are filtered out', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'guest' }
      const docs: TestDoc[] = [
        { _id: 'doc1', ownerId: 'user2', title: 'Doc 1' },
        { _id: 'doc2', ownerId: 'user3', title: 'Doc 2' }
      ]
      const rule: RlsRule<TestCtx, TestDoc> = {
        read: ctx => ctx.role === 'admin'
      }

      const result = await filterByRls(ctx, docs, rule)

      expect(result).toHaveLength(0)
    })

    it('should handle empty input array', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'user' }
      const rule: RlsRule<TestCtx, TestDoc> = {
        read: () => true
      }

      const result = await filterByRls(ctx, [], rule)

      expect(result).toHaveLength(0)
    })

    it('should handle async read rules', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'user' }
      const docs: TestDoc[] = [
        { _id: 'doc1', ownerId: 'user1', title: 'My Doc' },
        { _id: 'doc2', ownerId: 'user2', title: 'Other Doc' }
      ]
      const rule: RlsRule<TestCtx, TestDoc> = {
        read: async (ctx, doc) => {
          await new Promise(resolve => setTimeout(resolve, 1))
          return ctx.userId === doc.ownerId
        }
      }

      const result = await filterByRls(ctx, docs, rule)

      expect(result).toHaveLength(1)
      expect(result[0]._id).toBe('doc1')
    })

    it('should return all docs when rule has no read property', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'user' }
      const docs: TestDoc[] = [
        { _id: 'doc1', ownerId: 'user2', title: 'Doc 1' },
        { _id: 'doc2', ownerId: 'user3', title: 'Doc 2' }
      ]
      const rule: RlsRule<TestCtx, TestDoc> = {
        insert: () => false // Only insert rule
      }

      const result = await filterByRls(ctx, docs, rule)

      expect(result).toHaveLength(2)
    })

    it('should preserve document order', async () => {
      const ctx: TestCtx = { userId: 'user1', role: 'admin' }
      const docs: TestDoc[] = [
        { _id: 'doc3', ownerId: 'user1', title: 'Third' },
        { _id: 'doc1', ownerId: 'user1', title: 'First' },
        { _id: 'doc2', ownerId: 'user1', title: 'Second' }
      ]
      const rule: RlsRule<TestCtx, TestDoc> = {
        read: () => true
      }

      const result = await filterByRls(ctx, docs, rule)

      expect(result.map(d => d._id)).toEqual(['doc3', 'doc1', 'doc2'])
    })
  })
})
