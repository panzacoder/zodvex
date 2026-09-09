import { describe, expect, test } from 'vitest'
import { assessValidity, classifyFailure, parseCompletion, summarize, type CapacityCompletion } from './measurements.js'

const marker = 'ZODVEX_CAPACITY {"run":"run-1","sample":"native-3","limit":25}'
const completion = {
  kind: 'Completion',
  identifier: 'native.js:read',
  logLines: [{ messages: [marker], level: 'LOG', timestamp: 123, isTruncated: false }],
  executionTime: 0.0125,
  userExecutionTime: 0.004,
  cachedResult: false,
  usageStats: { databaseReadDocuments: 25, databaseReadBytes: 51200, memoryUsedMb: 64 },
  returnBytes: 52000,
  requestId: 'request-1',
  executionId: 'execution-1',
  error: null,
}

describe('capacity completion records', () => {
  test('parses a sanitized hosted pilot completion with inspected structured messages', () => {
    // Actual hosted Completion shape; only correlation IDs and timestamps are replaced.
    const record = {
      kind: 'Completion', udfType: 'Query', componentPath: null,
      identifier: 'mini_lean/query:read',
      logLines: [{
        messages: ['\'ZODVEX_CAPACITY {"run":"pilot-run","sample":"initial-0","limit":1}\''],
        isTruncated: false, timestamp: 1700000000000, level: 'LOG', systemMetadata: null,
      }],
      timestamp: 1700000000.0203164, cachedResult: false, caller: 'Action',
      parentExecutionId: 'parent-execution', executionTime: 0.021347852,
      userExecutionTime: 0.016050712, success: null, error: null,
      requestId: 'pilot-request', executionId: 'pilot-execution',
      usageStats: {
        databaseReadBytes: 911, databaseWriteBytes: 0, databaseIoReadBytes: 911,
        databaseIoWriteBytes: 0, databaseReadDocuments: 1, databaseWriteDocuments: 0,
        databaseWriteIndexRows: 0, storageReadBytes: 0, storageWriteBytes: 0,
        vectorIndexReadBytes: 0, vectorIndexWriteBytes: 0, textIndexQueryBytes: 0,
        textIndexWriteQueryBytes: 0, vectorIndexReadQueryBytes: 0,
        vectorIndexWriteQueryBytes: 0, networkEgressBytes: 0, memoryUsedMb: 64,
      },
      returnBytes: 955, occInfo: null, willRetry: false,
      executionTimestamp: 1700000000, identityType: 'unknown', environment: 'isolate',
    }
    const parsed = parseCompletion(record)
    expect(parsed).toMatchObject({
      run: 'pilot-run', sample: 'initial-0', limit: 1, identifier: 'mini_lean/query:read',
      cachedResult: false, readDocuments: 1, readBytes: 911, returnBytes: 955,
      executionId: 'pilot-execution', requestId: 'pilot-request', error: null,
    })
    expect(parsed?.executionMs).toBeCloseTo(21.347852, 8)
    expect(parsed?.userExecutionMs).toBeCloseTo(16.050712, 8)
    expect(parsed?.raw).toBe(record)
  })

  test('correlates a structured marker and preserves fractional server milliseconds', () => {
    expect(parseCompletion(completion)).toEqual({
      run: 'run-1', sample: 'native-3', limit: 25, identifier: 'native.js:read',
      executionMs: 12.5, userExecutionMs: 4, cachedResult: false,
      readDocuments: 25, readBytes: 51200, returnBytes: 52000, error: null,
      requestId: 'request-1', executionId: 'execution-1', raw: completion,
    })
    expect(parseCompletion(completion)).not.toHaveProperty('memoryUsedMb')
  })

  test.each([
    marker,
    `[LOG] ${marker}`,
    `[LOG] '${marker}'`,
    `[LOG] ${JSON.stringify(marker)}`,
  ])('correlates a legacy log string: %s', line => {
    expect(parseCompletion({ ...completion, logLines: [line] })).toMatchObject({
      run: 'run-1', sample: 'native-3', limit: 25,
    })
  })

  test('retains explicit cache hits so the runner can exclude them', () => {
    expect(parseCompletion({ ...completion, cachedResult: true })?.cachedResult).toBe(true)
  })

  test('does not turn progress, unrelated messages or malformed markers into samples', () => {
    for (const record of [
      null, [], {},
      { ...completion, kind: 'Progress' },
      { ...completion, identifier: null },
      { ...completion, logLines: [`unrelated ${marker}`] },
      { ...completion, logLines: ['ZODVEX_CAPACITY {"run":"x","sample":"y","limit":"25"}'] },
      { ...completion, logLines: ['ZODVEX_CAPACITY {"run":"","sample":"y","limit":25}'] },
      { ...completion, logLines: ['ZODVEX_CAPACITY {"run":"x","sample":"y","limit":25.5}'] },
      { ...completion, logLines: ['ZODVEX_CAPACITY {"run":"x"'] },
    ]) expect(parseCompletion(record)).toBeNull()
  })

  test('preserves missing telemetry as null and distinguishes missing from zero', () => {
    const raw = { kind: 'Completion', identifier: 'read:run', logLines: [marker] }
    expect(parseCompletion(raw)).toMatchObject({
      executionMs: null, userExecutionMs: null, cachedResult: null,
      readDocuments: null, readBytes: null, returnBytes: null, error: null,
    })
    expect(parseCompletion({
      ...raw, executionTime: 0, userExecutionTime: 0, returnBytes: 0,
      usageStats: { databaseReadDocuments: 0, databaseReadBytes: 0 },
    })).toMatchObject({ executionMs: 0, userExecutionMs: 0, readDocuments: 0, readBytes: 0, returnBytes: 0 })
  })

  test('rejects numeric-string, nonfinite and negative telemetry instead of coercing it', () => {
    expect(parseCompletion({
      ...completion, executionTime: '0.01', userExecutionTime: Infinity, cachedResult: 'false',
      usageStats: { databaseReadDocuments: '25', databaseReadBytes: -1 }, returnBytes: NaN,
    })).toMatchObject({
      executionMs: null, userExecutionMs: null, cachedResult: null,
      readDocuments: null, readBytes: null, returnBytes: null,
    })
  })

  test('retains a failure with its correlated marker', () => {
    expect(parseCompletion({ ...completion, error: 'JavaScript ran out of memory' })?.error)
      .toBe('JavaScript ran out of memory')
  })
})

describe('capacity sample statistics', () => {
  test('sorts a copy and uses linearly interpolated sample quartiles', () => {
    const input = [9, 1, 5, 3]
    expect(summarize(input)).toEqual({ count: 4, min: 1, q1: 2.5, median: 4, q3: 6, max: 9 })
    expect(input).toEqual([9, 1, 5, 3])
    expect(summarize([12])).toEqual({ count: 1, min: 12, q1: 12, median: 12, q3: 12, max: 12 })
  })

  test('reports empty observations without inventing zero latency', () => {
    expect(summarize([])).toEqual({ count: 0, min: null, q1: null, median: null, q3: null, max: null })
  })

  test('rejects invalid observations instead of silently changing the sample count', () => {
    expect(() => summarize([1, NaN])).toThrow()
    expect(() => summarize([Infinity])).toThrow()
  })
})

describe('capacity failure classification', () => {
  test.each([
    ['JavaScript execution ran out of memory', 'memory'],
    ['Uncaught Error: Array buffer allocation failed', 'memory'],
    ['Too many bytes read in a single function execution (limit: 16777216 bytes)', 'read-limit'],
    ['Too many documents read in a single function execution', 'read-limit'],
    ['Returned value is too large', 'return-limit'],
    ['Function execution timed out (maximum execution time exceeded)', 'execution-time'],
    ['Uncaught ZodError: invalid_type at createdAt', 'codec'],
    ['Capacity harness: digest mismatch', 'harness'],
    ['Could not find public function for native:run', 'harness'],
    ['fetch failed: connection reset', 'harness'],
    ['Some other application error', 'other'],
  ])('%s → %s', (message, expected) => {
    expect(classifyFailure(message)).toBe(expected)
  })
})

describe('capacity run validity', () => {
  const telemetry: CapacityCompletion = {
    run: 'run', sample: 'sample', limit: 25, identifier: 'native:read',
    executionMs: 12.5, userExecutionMs: 4, cachedResult: false,
    readDocuments: 25, readBytes: 51200, returnBytes: 52000, error: null, raw: {},
  }
  const success = { error: null, completion: telemetry }

  test('accepts complete uncached successful observations without requiring optional user timing', () => {
    expect(assessValidity([success, {
      error: null, completion: { ...telemetry, userExecutionMs: null, executionMs: 0 },
    }], 2, null)).toEqual({ valid: true, reasons: [] })
  })

  test('rejects an incomplete call count and preserves the collector failure reason', () => {
    const result = assessValidity([success], 2, 'collector closed unexpectedly')
    expect(result.valid).toBe(false)
    expect(result.reasons.some(reason => /call count/i.test(reason))).toBe(true)
    expect(result.reasons.some(reason => reason.includes('collector closed unexpectedly'))).toBe(true)
    expect(assessValidity([success, success], 1, null).valid).toBe(false)
  })

  test.each([
    undefined,
    null,
    { ...telemetry, cachedResult: true },
    { ...telemetry, cachedResult: null },
    { ...telemetry, executionMs: null },
    { ...telemetry, executionMs: NaN },
  ])('rejects absent or unusable server telemetry: %j', completion => {
    const result = assessValidity([{ error: null, completion }], 1, null)
    expect(result.valid).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  test.each([
    'JavaScript execution ran out of memory',
    'Function execution timed out',
    'Too many documents read in a single function execution',
    'Returned value is too large',
  ])('accepts a measured query capacity limit: %s', error => {
    expect(assessValidity([{
      error: `Driver propagated: ${error}`,
      completion: { ...telemetry, error }, failureSource: 'query',
    }], 1, null)).toEqual({ valid: true, reasons: [] })
  })

  test.each([
    'ZodError: invalid_type',
    'HARNESS: wrong row count/nonce',
    'Unexpected application exception',
  ])('rejects query failures that are not capacity outcomes: %s', error => {
    const result = assessValidity([{
      error, completion: { ...telemetry, error }, failureSource: 'query',
    }], 1, null)
    expect(result.valid).toBe(false)
    expect(result.reasons.some(reason => /query failure/i.test(reason))).toBe(true)
  })

  test('does not misattribute a driver memory failure to a successful query', () => {
    expect(assessValidity([{
      error: 'JavaScript execution ran out of memory', completion: telemetry, failureSource: 'driver',
    }], 1, null).valid).toBe(false)
    expect(assessValidity([{
      error: 'HARNESS: returned documents differ', completion: telemetry,
    }], 1, null).valid).toBe(false)
  })

  test('rejects unattributed errors even when labeled as query failures without matching evidence', () => {
    for (const observation of [
      { error: 'out of memory', failureSource: 'unknown' as const },
      { error: 'out of memory' },
      { error: 'out of memory', completion: telemetry, failureSource: 'query' as const },
    ]) expect(assessValidity([observation], 1, null).valid).toBe(false)
  })

  test('evaluates an initial failure even when every subsequent call succeeds', () => {
    const observations = [
      { error: 'HARNESS: initial correctness failure', completion: telemetry, failureSource: 'driver' as const },
      success,
      success,
    ]
    expect(assessValidity(observations, 3, null).valid).toBe(false)
  })
})
