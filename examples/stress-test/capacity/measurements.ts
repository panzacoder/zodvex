export type FailureClass = 'memory' | 'execution-time' | 'read-limit' | 'return-limit' | 'codec' | 'harness' | 'other'

export type CapacityCompletion = {
  run: string
  sample: string
  limit: number
  identifier: string
  executionMs: number | null
  userExecutionMs: number | null
  cachedResult: boolean | null
  readDocuments: number | null
  readBytes: number | null
  returnBytes: number | null
  error: string | null
  executionId?: string
  requestId?: string
  raw: unknown
}

export type SampleSummary = {
  count: number
  median: number | null
  q1: number | null
  q3: number | null
  min: number | null
  max: number | null
}

const markerPrefix = 'ZODVEX_CAPACITY '

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonnegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function secondsToMs(value: unknown): number | null {
  const seconds = nonnegativeNumber(value)
  return seconds === null ? null : nonnegativeNumber(seconds * 1000)
}

function parseMarker(message: string): Pick<CapacityCompletion, 'run' | 'sample' | 'limit'> | null {
  let text = message.trim().replace(/^\[(?:LOG|DEBUG|INFO|WARN|ERROR)\]\s+/, '')
  // Legacy console logs can contain an inspected string instead of its raw contents.
  if (text.startsWith('"')) {
    try {
      const unquoted: unknown = JSON.parse(text)
      if (typeof unquoted !== 'string') return null
      text = unquoted
    } catch {
      return null
    }
  } else if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('`') && text.endsWith('`'))) {
    text = text.slice(1, -1)
  }
  if (!text.startsWith(markerPrefix)) return null
  try {
    const marker: unknown = JSON.parse(text.slice(markerPrefix.length))
    if (!isRecord(marker)
      || typeof marker.run !== 'string' || marker.run.length === 0
      || typeof marker.sample !== 'string' || marker.sample.length === 0
      || typeof marker.limit !== 'number' || !Number.isSafeInteger(marker.limit) || marker.limit < 0) return null
    return { run: marker.run, sample: marker.sample, limit: marker.limit }
  } catch {
    return null
  }
}

/** Parse CLI JSONL completions; absent or invalid telemetry remains unavailable. */
export function parseCompletion(record: unknown): CapacityCompletion | null {
  if (!isRecord(record) || record.kind !== 'Completion'
    || typeof record.identifier !== 'string' || record.identifier.length === 0
    || !Array.isArray(record.logLines)) return null

  const messages = record.logLines.flatMap((line: unknown): string[] => {
    if (typeof line === 'string') return [line]
    if (!isRecord(line) || !Array.isArray(line.messages)) return []
    return line.messages.filter((message: unknown): message is string => typeof message === 'string')
  })
  const marker = messages.map(parseMarker).find(value => value !== null)
  if (!marker) return null

  const usage = isRecord(record.usageStats) ? record.usageStats : {}
  return {
    ...marker,
    identifier: record.identifier,
    executionMs: secondsToMs(record.executionTime),
    userExecutionMs: secondsToMs(record.userExecutionTime),
    cachedResult: typeof record.cachedResult === 'boolean' ? record.cachedResult : null,
    readDocuments: nonnegativeNumber(usage.databaseReadDocuments),
    readBytes: nonnegativeNumber(usage.databaseReadBytes),
    returnBytes: nonnegativeNumber(record.returnBytes),
    error: typeof record.error === 'string' ? record.error : null,
    ...(typeof record.executionId === 'string' ? { executionId: record.executionId } : {}),
    ...(typeof record.requestId === 'string' ? { requestId: record.requestId } : {}),
    // memoryUsedMb is the configured isolate allowance, not measured heap usage.
    raw: record,
  }
}

/** Descriptive sample statistics using linear interpolation at (n - 1) * p. */
export function summarize(values: readonly number[]): SampleSummary {
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new TypeError('Sample statistics require finite numeric observations')
  }
  if (values.length === 0) {
    return { count: 0, median: null, q1: null, q3: null, min: null, max: null }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (p: number): number => {
    const index = (sorted.length - 1) * p
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
  }
  return {
    count: sorted.length,
    median: quantile(0.5), q1: quantile(0.25), q3: quantile(0.75),
    min: sorted[0], max: sorted[sorted.length - 1],
  }
}

/** Classify the observed error text, retaining the original text in the sample. */
export function classifyFailure(message: string): FailureClass {
  if (/out[ -]?of[ -]?memory|\boom\b|heap (?:limit|exhaust)|array\s*buffer allocation failed/i.test(message)) return 'memory'
  if (/too many (?:bytes|documents) read|read(?:s|ing)?[^\n]*(?:limit exceeded|exceeds? .*limit)|(?:read|scan)[ -]limit/i.test(message)) return 'read-limit'
  if (/(?:return(?:ed)?|result|response)[^\n]*(?:too large|size limit|exceeds? .*limit)|return[ -]limit/i.test(message)) return 'return-limit'
  if (/(?:function|javascript|js|cpu|execution)[^\n]*(?:timed out|timeout|time limit|time exceeded|took too long)|exceeded[^\n]*(?:cpu|execution time)/i.test(message)) return 'execution-time'
  if (/zoderror|codec|(?:encode|decode|validation)[^\n]*(?:failed|error|invalid)|invalid_type/i.test(message)) return 'codec'
  if (/harness|digest mismatch|wire (?:result|value)[^\n]*mismatch|could not find (?:public |internal )?function|fetch failed|network error|econnreset|econnrefused|enotfound|unauthorized|forbidden/i.test(message)) return 'harness'
  return 'other'
}

/** Assess all dispatched observations, including initial calls, before reporting results. */
export function assessValidity(
  observations: readonly {
    error: string | null
    completion?: CapacityCompletion | null
    failureSource?: 'query' | 'driver' | 'unknown' | null
  }[],
  expectedCalls: number,
  logError: string | null,
): { valid: boolean; reasons: string[] } {
  const reasons = new Set<string>()
  if (observations.length !== expectedCalls) {
    reasons.add(`Call count mismatch: expected ${expectedCalls}, observed ${observations.length}`)
  }
  if (logError !== null) reasons.add(`Collector error: ${logError}`)

  for (const observation of observations) {
    const completion = observation.completion
    if (!completion) {
      reasons.add('Missing server completion telemetry')
    } else {
      if (completion.cachedResult !== false) reasons.add('Cached or unknown query cache status')
      if (nonnegativeNumber(completion.executionMs) === null) reasons.add('Missing or invalid server execution time')
    }

    const queryError = completion?.error ?? null
    if (queryError !== null) {
      const failure = classifyFailure(queryError)
      if (!['memory', 'execution-time', 'read-limit', 'return-limit'].includes(failure)) {
        reasons.add(`Query failure is not a capacity limit (${failure})`)
      }
    }
    if (observation.failureSource === 'driver') {
      reasons.add('Driver or correctness failure')
    } else if (observation.failureSource === 'unknown') {
      reasons.add('Unattributed call failure')
    } else if (observation.error !== null && queryError === null) {
      // A successful query does not make its driver's failure a query capacity limit.
      reasons.add(completion ? 'Driver or correctness failure' : 'Unattributed call failure')
    }
  }
  return { valid: reasons.size === 0, reasons: [...reasons] }
}
