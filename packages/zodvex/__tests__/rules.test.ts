import { describe, expect, it } from 'bun:test'
import type {
  CodecRules,
  CodecRulesConfig,
  TableRules,
  WriteEvent,
  ReaderAuditConfig,
  WriterAuditConfig
} from '../src/rules'

describe('rules types', () => {
  it('exports all public types', () => {
    // Type-level assertions — if this compiles, the types are correctly exported.
    // Runtime assertion just confirms the test ran.
    const config: CodecRulesConfig = { defaultPolicy: 'allow', allowCounting: false }
    expect(config.defaultPolicy).toBe('allow')
  })

  it('WriteEvent discriminates by type', () => {
    const event: WriteEvent = { type: 'insert', id: 'test:1' as any, value: { name: 'Alice' } }
    expect(event.type).toBe('insert')
  })
})
