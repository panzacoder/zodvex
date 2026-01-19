import { describe, expect, it } from 'bun:test'
import { failure, formFailure, formSuccess, ok, success } from '../src/results'

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
