import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { generateFixture, here } from './generate'
import { bundleConsumer } from './bundle.mjs'

describe('actual generated consumer import topology', () => {
  it('retains every descriptor without importing its original model modules', async () => {
    const directory = mkdtempSync(join(here, '.fixture-test-'))
    try {
      const manifest = generateFixture(directory, 16)
      expect(manifest.descriptorFiles).toBe(17)
      expect(manifest.fallbacks).toEqual([])
      expect(manifest.insertFallbacks).toEqual([])
      const descriptor = await bundleConsumer(directory, 'descriptor', 16, 'test')
      expect(descriptor.modelInputs).toHaveLength(0)
      expect(descriptor.descriptorInputs).toHaveLength(17)
      const full = await bundleConsumer(directory, 'eager', 16, 'test')
      expect(full.modelInputs).toHaveLength(17)
      expect(full.descriptorInputs).toHaveLength(0)
      const emitted = readFileSync(join(directory, '_zodvex/models/unused0.js'), 'utf8')
      expect(emitted).toContain('secretCodec')
      expect(emitted).not.toContain('f0:')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
