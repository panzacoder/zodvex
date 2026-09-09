/** Portable fixture shared by the generated Convex functions and local runner. */
export type WireRow = {
  seq: number
  createdAt: number
  secret: string
  payload: string
  tags: string[]
  checkpoints: Array<{ at: number; value: number }>
  reviewedAt?: number | null
}
export type DomainRow = Omit<WireRow, 'createdAt' | 'secret' | 'checkpoints' | 'reviewedAt'> & {
  createdAt: Date
  secret: SecretText
  checkpoints: Array<{ at: Date; value: number }>
  reviewedAt?: Date | null
}

/** A type codec fixture, NOT encryption, redaction, or access control. */
export class SecretText {
  constructor(private readonly value: string) {
    if (typeof value !== 'string') throw new TypeError('SecretText requires a string')
  }

  expose(): string { return this.value }
  uppercase(): SecretText { return new SecretText(this.value.toUpperCase()) }
  toWire(): string { return this.value }
}

type CodecKeys = 'createdAt' | 'secret' | 'checkpoints' | 'reviewedAt'
const UINT32 = 0x100000000

/** payloadBytes is the ASCII payload length, not the complete document size. */
export function makeWireRow(seq: number, payloadBytes: number): WireRow {
  if (!Number.isSafeInteger(seq) || seq < 0) throw new RangeError('seq must be a nonnegative safe integer')
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0) {
    throw new RangeError('payloadBytes must be a nonnegative safe integer')
  }
  const createdAt = 1700000000000 + seq * 60000
  decodeDate(createdAt)
  const pattern = `${seq.toString(36).padStart(6, '0')}:capacity:abcdefghijklmnopqrstuvwxyz0123456789|`
  return {
    seq,
    createdAt,
    secret: `case-${seq.toString(36).padStart(6, '0')}`,
    payload: pattern.repeat(Math.ceil(payloadBytes / pattern.length)).slice(0, payloadBytes),
    tags: [`group-${seq % 7}`, seq % 2 === 0 ? 'open' : 'closed'],
    checkpoints: [
      { at: createdAt - 30000, value: seq % 101 },
      { at: createdAt - 10000, value: (seq * 7) % 101 },
    ],
    ...(seq % 3 === 0 ? {} : { reviewedAt: seq % 3 === 1 ? null : createdAt - 5000 }),
  }
}

function decodeDate(value: number): Date {
  if (typeof value !== 'number') throw new TypeError('Expected a timestamp')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid timestamp')
  return date
}

function encodeDate(value: Date): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Expected a valid Date')
  }
  return value.getTime()
}

/** These manual helpers validate codec leaves, not the complete modeled schema. */
export function decodeRow<T extends WireRow>(row: T): Omit<T, CodecKeys> & DomainRow {
  const { createdAt, secret, checkpoints, reviewedAt, ...rest } = row
  return {
    ...rest,
    createdAt: decodeDate(createdAt),
    secret: new SecretText(secret),
    checkpoints: checkpoints.map(point => ({ ...point, at: decodeDate(point.at) })),
    ...(reviewedAt === undefined ? {} : { reviewedAt: reviewedAt === null ? null : decodeDate(reviewedAt) }),
  }
}

export function encodeRow<T extends DomainRow>(row: T): Omit<T, CodecKeys> & WireRow {
  if (!(row.secret instanceof SecretText)) throw new TypeError('Expected a SecretText instance')
  const { createdAt, secret, checkpoints, reviewedAt, ...rest } = row
  return {
    ...rest,
    createdAt: encodeDate(createdAt),
    secret: secret.toWire(),
    checkpoints: checkpoints.map(point => ({ ...point, at: encodeDate(point.at) })),
    ...(reviewedAt === undefined ? {} : { reviewedAt: reviewedAt === null ? null : encodeDate(reviewedAt) }),
  }
}

// Small noncryptographic checksum. Large timestamps contribute both 32-bit words.
// Payload contents are verified outside timing; only their length is used here.
function numberScore(value: number): number {
  return ((value % UINT32) + Math.floor(value / UINT32)) >>> 0
}

function textScore(value: string): number {
  let result = 0
  for (let i = 0; i < value.length; i++) {
    result = (result + Math.imul(i + 1, value.charCodeAt(i))) >>> 0
  }
  return result
}

function commonScore(row: Pick<WireRow, 'seq' | 'payload' | 'tags'>, secret: string): number {
  let result = (numberScore(row.seq) + textScore(secret) + row.payload.length + row.tags.length) >>> 0
  for (let i = 0; i < row.tags.length; i++) {
    result = (result + Math.imul(i + 1, textScore(row.tags[i]))) >>> 0
  }
  return result
}

/** Shared domain work: new Date and SecretText values; the inputs stay unchanged. */
export function processRows<T extends DomainRow>(rows: readonly T[]): { rows: T[]; digest: number } {
  let digest = rows.length >>> 0
  const result = rows.map((row, index) => {
    const next = {
      ...row,
      createdAt: new Date(row.createdAt.getTime() + 1000),
      secret: row.secret.uppercase(),
    }
    let score = (commonScore(next, next.secret.expose()) + numberScore(next.createdAt.getTime()) + next.checkpoints.length) >>> 0
    for (const point of next.checkpoints) {
      score = (score + numberScore(point.at.getTime()) + numberScore(point.value)) >>> 0
    }
    score = (score + (next.reviewedAt === undefined ? 1 : next.reviewedAt === null ? 2 : 3 + numberScore(next.reviewedAt.getTime()))) >>> 0
    digest = (digest + Math.imul(index + 1, score)) >>> 0
    return next
  })
  return { rows: result, digest }
}

/** Native floor: equivalent wire output, without constructing runtime codec values. */
export function processWireRows<T extends WireRow>(rows: readonly T[]): { rows: T[]; digest: number } {
  let digest = rows.length >>> 0
  const result = rows.map((row, index) => {
    const next = { ...row, createdAt: row.createdAt + 1000, secret: row.secret.toUpperCase() }
    let score = (commonScore(next, next.secret) + numberScore(next.createdAt) + next.checkpoints.length) >>> 0
    for (const point of next.checkpoints) {
      score = (score + numberScore(point.at) + numberScore(point.value)) >>> 0
    }
    score = (score + (next.reviewedAt === undefined ? 1 : next.reviewedAt === null ? 2 : 3 + numberScore(next.reviewedAt))) >>> 0
    digest = (digest + Math.imul(index + 1, score)) >>> 0
    return next
  })
  return { rows: result, digest }
}

/** Untimed wire oracle. Does not call either workload, codec helper, or scoring helper. */
export function expectedWireResult<T extends WireRow>(rows: readonly T[]): { rows: T[]; digest: number } {
  const expected = rows.map(row => ({
    ...row,
    createdAt: row.createdAt + 1000,
    secret: row.secret.toUpperCase(),
  }))
  const digest = expected.reduce((sum, row, rowIndex) => {
    const numbers = [row.seq, row.createdAt, row.payload.length, row.tags.length, row.checkpoints.length]
    for (const [tagIndex, tag] of [row.secret, ...row.tags].entries()) {
      for (let charIndex = 0; charIndex < tag.length; charIndex++) {
        // Secret and the first tag each have weight 1; subsequent tags increase.
        numbers.push(tag.charCodeAt(charIndex) * (charIndex + 1) * Math.max(1, tagIndex))
      }
    }
    for (const point of row.checkpoints) numbers.push(point.at, point.value)
    if (row.reviewedAt === undefined) numbers.push(1)
    else if (row.reviewedAt === null) numbers.push(2)
    else numbers.push(3, row.reviewedAt)
    const score = numbers.reduce((total, value) =>
      (total + value % 4294967296 + Math.floor(value / 4294967296)) >>> 0, 0)
    return (sum + Math.imul(rowIndex + 1, score)) >>> 0
  }, rows.length >>> 0)
  return { rows: expected, digest }
}

/** Full structural/value comparison, including metadata and payload, outside timing. */
export function assertWireResult(source: readonly WireRow[], result: unknown): void {
  compareWire(expectedWireResult(source), result, 'result')
}

function compareWire(expected: unknown, actual: unknown, path: string): void {
  if (Object.is(expected, actual)) return
  if (typeof expected !== 'object' || expected === null || typeof actual !== 'object' || actual === null) {
    throw new Error(`Capacity correctness mismatch at ${path}`)
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      throw new Error(`Capacity correctness mismatch at ${path}.length`)
    }
    expected.forEach((item, index) => compareWire(item, actual[index], `${path}[${index}]`))
    return
  }
  if (Array.isArray(actual) || Object.getPrototypeOf(actual) !== Object.prototype) {
    throw new Error(`Capacity correctness mismatch at ${path}`)
  }
  const expectedKeys = Object.keys(expected).sort()
  const actualKeys = Object.keys(actual).sort()
  if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index])) {
    throw new Error(`Capacity correctness mismatch at ${path} keys`)
  }
  for (const key of expectedKeys) {
    compareWire((expected as Record<string, unknown>)[key], (actual as Record<string, unknown>)[key], `${path}.${key}`)
  }
}
