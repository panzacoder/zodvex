import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import {
  type FormError,
  type FormResult,
  failure,
  formFailure,
  formSuccess,
  type MutationResult,
  ok,
  success,
  type VoidMutationResult,
  zFormResult,
  zMutationResult,
  zVoidMutationResult
} from '../src'

describe('result helpers', () => {
  describe('success/failure', () => {
    it('success() creates success result with data', () => {
      const result = success({ id: '123', name: 'test' })
      expect(result).toEqual({ success: true, data: { id: '123', name: 'test' } })
    })

    it('failure() creates failure result with error', () => {
      const result = failure('Not found')
      expect(result).toEqual({ success: false, error: 'Not found' })
    })
  })

  describe('ok', () => {
    it('ok() creates void success result', () => {
      const result = ok()
      expect(result).toEqual({ success: true })
    })
  })

  describe('formSuccess/formFailure', () => {
    it('formSuccess() creates success result with data', () => {
      const result = formSuccess({ email: 'test@example.com' })
      expect(result).toEqual({ success: true, data: { email: 'test@example.com' } })
    })

    it('formFailure() creates failure result with data and errors', () => {
      const result = formFailure(
        { email: 'bad' },
        { formErrors: ['Invalid submission'], fieldErrors: { email: ['Invalid email'] } }
      )
      expect(result).toEqual({
        success: false,
        data: { email: 'bad' },
        error: { formErrors: ['Invalid submission'], fieldErrors: { email: ['Invalid email'] } }
      })
    })
  })
})

describe('result Zod schemas', () => {
  describe('zMutationResult', () => {
    it('validates success result', () => {
      const schema = zMutationResult(z.object({ id: z.string() }))
      const result = schema.parse({ success: true, data: { id: '123' } })
      expect(result).toEqual({ success: true, data: { id: '123' } })
    })

    it('validates failure result', () => {
      const schema = zMutationResult(z.object({ id: z.string() }))
      const result = schema.parse({ success: false, error: 'Not found' })
      expect(result).toEqual({ success: false, error: 'Not found' })
    })

    it('rejects invalid success result', () => {
      const schema = zMutationResult(z.object({ id: z.string() }))
      expect(() => schema.parse({ success: true, data: { id: 123 } })).toThrow()
    })

    it('rejects invalid failure result', () => {
      const schema = zMutationResult(z.object({ id: z.string() }))
      expect(() => schema.parse({ success: false, error: 123 })).toThrow()
    })
  })

  describe('zVoidMutationResult', () => {
    it('validates void success result', () => {
      const result = zVoidMutationResult.parse({ success: true })
      expect(result).toEqual({ success: true })
    })

    it('validates void failure result', () => {
      const result = zVoidMutationResult.parse({ success: false, error: 'Failed' })
      expect(result).toEqual({ success: false, error: 'Failed' })
    })
  })

  describe('zFormResult', () => {
    it('validates form success result', () => {
      const schema = zFormResult(z.object({ email: z.string() }))
      const result = schema.parse({ success: true, data: { email: 'test@example.com' } })
      expect(result).toEqual({ success: true, data: { email: 'test@example.com' } })
    })

    it('validates form failure result with errors', () => {
      const schema = zFormResult(z.object({ email: z.string() }))
      const result = schema.parse({
        success: false,
        data: { email: 'bad' },
        error: { formErrors: ['Invalid'], fieldErrors: { email: ['Bad email'] } }
      })
      expect(result).toEqual({
        success: false,
        data: { email: 'bad' },
        error: { formErrors: ['Invalid'], fieldErrors: { email: ['Bad email'] } }
      })
    })
  })
})
