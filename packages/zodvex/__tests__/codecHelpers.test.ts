import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createBoundaryHelpers, ZodvexDecodeError } from '../src/internal/boundaryHelpers'
import { $ZodError } from '../src/internal/zod-core'
import { zx } from '../src/internal/zx'

const functionNameSymbol = Symbol.for('functionName')

/** Create a fake FunctionReference with the well-known functionName symbol */
function fakeRef(path: string) {
  return { [functionNameSymbol]: path } as any
}

const registry = {
  'tasks:get': {
    returns: z.object({
      _id: z.string(),
      title: z.string(),
      createdAt: zx.date()
    })
  }
} as any

describe('ZodvexDecodeError', () => {
  it('is an instance of $ZodError and ZodvexDecodeError', () => {
    const err = new ZodvexDecodeError('tasks:get', [], { bad: 'data' })
    // Extends $ZodError from zod/v4/core (works with both zod and zod/mini)
    expect(err).toBeInstanceOf($ZodError)
    expect(err).toBeInstanceOf(ZodvexDecodeError)
  })

  it('has functionPath and wireData properties', () => {
    const wire = { bad: 'data' }
    const err = new ZodvexDecodeError('tasks:get', [], wire)
    expect(err.functionPath).toBe('tasks:get')
    expect(err.wireData).toBe(wire)
  })
})

describe('decodeResult', () => {
  it('default (warn): logs warning and returns raw wire data on decode failure', () => {
    const codec = createBoundaryHelpers(registry)
    // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op spy
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Pass invalid data — title should be string, not number
    const wire = { _id: 'x', title: 123, createdAt: 1700000000000 }
    const result = codec.decodeResult(fakeRef('tasks:get'), wire)

    expect(result).toBe(wire) // raw wire data returned
    expect(warnSpy).toHaveBeenCalled()
    const msg = warnSpy.mock.calls[0][0] as string
    expect(msg).toContain('tasks:get')
    // The default warn message omits the raw wire preview — wire values may be sensitive (#111)
    expect(msg).toContain('Returning raw wire data')
    expect(msg).not.toContain('Preview')
    expect(msg).not.toContain('123')
    warnSpy.mockRestore()
  })

  it('warnWirePreview: true includes a preview of the raw wire data in the warn message', () => {
    const codec = createBoundaryHelpers(registry, { warnWirePreview: true })
    // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op spy
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Pass invalid data — title should be string, not number
    const wire = { _id: 'x', title: 123, createdAt: 1700000000000 }
    const result = codec.decodeResult(fakeRef('tasks:get'), wire)

    expect(result).toBe(wire) // raw wire data returned
    expect(warnSpy).toHaveBeenCalled()
    const msg = warnSpy.mock.calls[0][0] as string
    expect(msg).toContain('Preview:')
    expect(msg).toContain('"title":123')
    warnSpy.mockRestore()
  })

  it('warnWirePreview: true truncates previews longer than 200 chars', () => {
    const codec = createBoundaryHelpers(registry, { warnWirePreview: true })
    // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op spy
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // createdAt is wire-typed as a number, so this fails decode while keeping
    // the JSON payload well over 200 chars
    const wire = { _id: 'x', title: 'a'.repeat(400), createdAt: 'not-a-number' }
    const result = codec.decodeResult(fakeRef('tasks:get'), wire)

    expect(result).toBe(wire) // raw wire data returned
    const msg = warnSpy.mock.calls[0][0] as string
    expect(msg).toContain('Preview: ')
    const preview = msg.split('Preview: ')[1]
    expect(preview.length).toBe(203) // 200 chars + '...'
    expect(preview.endsWith('...')).toBe(true)
    warnSpy.mockRestore()
  })

  it('throw mode: throws ZodvexDecodeError on decode failure', () => {
    const codec = createBoundaryHelpers(registry, { onDecodeError: 'throw' })
    const wire = { _id: 'x', title: 123, createdAt: 1700000000000 }

    try {
      codec.decodeResult(fakeRef('tasks:get'), wire)
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err).toBeInstanceOf(ZodvexDecodeError)
      expect(err).toBeInstanceOf($ZodError)
      expect(err.functionPath).toBe('tasks:get')
      expect(err.wireData).toBe(wire)
    }
  })

  it('successful decode still works normally', () => {
    const codec = createBoundaryHelpers(registry)
    const wire = { _id: 'x', title: 'Hello', createdAt: 1700000000000 }
    const result = codec.decodeResult(fakeRef('tasks:get'), wire)

    expect(result.title).toBe('Hello')
    expect(result.createdAt).toBeInstanceOf(Date)
  })

  it('passthrough when function not in registry (unchanged)', () => {
    const codec = createBoundaryHelpers(registry)
    const wire = { anything: 'goes' }
    const result = codec.decodeResult(fakeRef('unknown:fn'), wire)
    expect(result).toBe(wire)
  })
})
