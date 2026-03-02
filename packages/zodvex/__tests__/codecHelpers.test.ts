import { describe, expect, it, mock, spyOn } from 'bun:test'
import { z } from 'zod'
import { zx } from '../src/zx'

// Mock convex/server
mock.module('convex/server', () => ({
  getFunctionName: (ref: any) => ref._testPath
}))

const { createCodecHelpers, ZodvexDecodeError } = await import('../src/codecHelpers')

function fakeRef(path: string) {
  return { _testPath: path } as any
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
  it('is an instance of z.ZodError', () => {
    const err = new ZodvexDecodeError('tasks:get', [], { bad: 'data' })
    expect(err).toBeInstanceOf(z.ZodError)
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
    const codec = createCodecHelpers(registry)
    // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-op spy
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})

    // Pass invalid data — title should be string, not number
    const wire = { _id: 'x', title: 123, createdAt: 1700000000000 }
    const result = codec.decodeResult(fakeRef('tasks:get'), wire)

    expect(result).toBe(wire) // raw wire data returned
    expect(warnSpy).toHaveBeenCalled()
    const msg = warnSpy.mock.calls[0][0] as string
    expect(msg).toContain('tasks:get')
    warnSpy.mockRestore()
  })

  it('throw mode: throws ZodvexDecodeError on decode failure', () => {
    const codec = createCodecHelpers(registry, { onDecodeError: 'throw' })
    const wire = { _id: 'x', title: 123, createdAt: 1700000000000 }

    try {
      codec.decodeResult(fakeRef('tasks:get'), wire)
      expect(true).toBe(false) // should not reach
    } catch (err: any) {
      expect(err).toBeInstanceOf(ZodvexDecodeError)
      expect(err).toBeInstanceOf(z.ZodError)
      expect(err.functionPath).toBe('tasks:get')
      expect(err.wireData).toBe(wire)
    }
  })

  it('successful decode still works normally', () => {
    const codec = createCodecHelpers(registry)
    const wire = { _id: 'x', title: 'Hello', createdAt: 1700000000000 }
    const result = codec.decodeResult(fakeRef('tasks:get'), wire)

    expect(result.title).toBe('Hello')
    expect(result.createdAt).toBeInstanceOf(Date)
  })

  it('passthrough when function not in registry (unchanged)', () => {
    const codec = createCodecHelpers(registry)
    const wire = { anything: 'goes' }
    const result = codec.decodeResult(fakeRef('unknown:fn'), wire)
    expect(result).toBe(wire)
  })
})
