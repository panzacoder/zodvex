import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('describes date-bound warnings as manual migration rather than unavailable Mini features', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zod-to-mini-cli-'))
  try {
    const input = join(directory, 'dates.ts')
    const source = `import { z } from 'zod';
const earliest = z.date().min(new Date(0));
const latest = z.date().max(new Date(2));`
    writeFileSync(input, source)
    const output = execFileSync('bun', [
      fileURLToPath(new URL('./cli.ts', import.meta.url)), input, '--dry-run',
    ], { encoding: 'utf8' })

    expect(output).toContain('.min() — not converted automatically; needs manual fix')
    expect(output).toContain('.max() — not converted automatically; needs manual fix')
    expect(output).toContain('2 warning(s) — manual migration required')
    expect(output).not.toContain('no mini equivalent')
    expect(readFileSync(input, 'utf8')).toBe(source)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
