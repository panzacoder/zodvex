import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertResult, parseGc, retainedBytes } from './oracle.mjs'
import { sha256 } from '../memory/provenance.mjs'

const here = dirname(fileURLToPath(import.meta.url))
function filesBelow(directory, prefix = '') {
  return readdirSync(join(directory, prefix)).sort().flatMap(name => {
    const file = prefix ? `${prefix}/${name}` : name
    return statSync(join(directory, file)).isDirectory() ? filesBelow(directory, file) : [file]
  }).sort()
}
function tar(args) {
  const result = spawnSync('tar', args, {
    encoding: 'utf8', timeout: 30000,
    // macOS metadata sidecars otherwise become extra files when extracted on Linux.
    env: args[0] === '-cJf' ? { ...process.env, COPYFILE_DISABLE: '1' } : process.env,
  })
  assert.equal(result.status, 0, result.error?.message || result.stderr)
  return result.stdout
}
const json = file => JSON.parse(readFileSync(file, 'utf8'))

export function verify(directory) {
  directory = resolve(directory)
  const manifest = json(join(directory, 'manifest.json'))
  const summary = json(join(directory, 'summary.json'))
  const index = json(join(directory, 'raw-evidence-index.json'))
  const archive = join(directory, 'raw-evidence.tar.xz')
  assert.equal(sha256(readFileSync(archive)), index.archiveSha256)
  assert.equal(sha256(readFileSync(join(directory, 'manifest.json'))), summary.manifestSha256)
  assert.equal(sha256(readFileSync(join(directory, 'calls.jsonl'))), summary.callsSha256)
  const members = tar(['-tJf', archive]).trim().split('\n')
  assert.ok(members.every(name => !name.startsWith('/') && !name.split('/').includes('..')))
  const temporary = mkdtempSync(join(tmpdir(), 'zodvex-dynamic-evidence-'))
  try {
    tar(['-xJf', archive, '-C', temporary])
    assert.deepEqual(filesBelow(temporary), Object.keys(index.files).sort())
    for (const [name, expected] of Object.entries(index.files))
      assert.equal(sha256(readFileSync(join(temporary, name))), expected, name)
    for (const [name, expected] of Object.entries(manifest.harnessHashes)) {
      assert.equal(sha256(readFileSync(join(temporary, 'harness', name))), expected, name)
      assert.equal(sha256(readFileSync(join(here, name))), expected, `Current measurement source changed: ${name}`)
    }
    const rows = readFileSync(join(directory, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(rows.length, 56)
    assert.equal(summary.calls, 60)
    assert.equal(summary.valid, true)
    const identities = new Set()
    for (const dimensions of manifest.cases) {
      const caseName = `unused-${dimensions.unused}-touched-${dimensions.touched}`
      const caseDir = join(temporary, caseName)
      const fixture = json(join(caseDir, 'fixture.json'))
      assert.equal(fixture.total, dimensions.unused + dimensions.touched)
      const source = {}
      for (const [file, hash] of Object.entries(fixture.sourceFiles)) {
        source[file] = readFileSync(join(caseDir, 'source', file), 'utf8')
        assert.equal(sha256(source[file]), hash, file)
      }
      assert.equal(sha256(JSON.stringify(source)), fixture.sourceHash)
      const audit = json(join(caseDir, 'bundle-audit.json'))
      assert.ok(Object.values(audit.checks).every(Boolean))
      for (const [file, module] of Object.entries(audit.modules))
        assert.equal(sha256(readFileSync(join(caseDir, 'emitted', file))), module.sha256, file)
      assert.equal(sha256(JSON.stringify(Object.entries(audit.modules).map(([name, row]) => [name, row.sha256]).sort())), audit.moduleSetHash)
      const canary = json(join(caseDir, 'canary.json'))
      assert.equal(canary.raw.status, 'success')
      assert.deepEqual(canary.raw.value, { nonce: canary.raw.value.nonce, ...dimensions, width: 32 })
      for (const row of rows.filter(row => row.caseName === caseName)) {
        assert.equal(row.moduleSetHash, audit.moduleSetHash)
        assert.equal(row.httpStatus, 200)
        assert.equal(row.valid, true)
        if (row.raw.status === 'success') {
          assertResult(row.raw.value, { kind: row.kind, fixture, tables: row.args.tables, nonce: row.id })
          if (row.phase === 'retained-heap') {
            const records = parseGc(readFileSync(join(caseDir, `gc-${row.id}.txt`), 'utf8'))
            assert.deepEqual(records, row.gcRecords)
            assert.equal(retainedBytes(records), row.totalRetainedObjectBytes)
            assert.ok(!identities.has(records[0].identity), 'Fresh isolate required for each measurement')
            identities.add(records[0].identity)
          }
        } else {
          assert.equal(row.kind, 'dynamic')
          assert.equal(row.phase, 'runtime-control')
          assert.equal(row.failure, 'dynamic-import-unsupported')
          assert.match(row.raw.errorMessage, /dynamic module import unsupported/)
        }
      }
    }
    assert.equal(identities.size, 30)
    for (const stat of summary.statistics) {
      const rowsForCase = rows.filter(row => row.phase === 'retained-heap' && row.unused === stat.unused && row.touched === stat.touched && row.kind === stat.kind)
      const values = rowsForCase.map(row => row.totalRetainedObjectBytes).sort((a, b) => a - b)
      assert.equal(values.length, 3)
      assert.deepEqual([stat.minimum, stat.median, stat.maximum], values)
    }
    return { valid: true, calls: 60, observations: rows.length, heapSamples: identities.size, archivedFiles: index.files && Object.keys(index.files).length }
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

export function pack(directory) {
  directory = resolve(directory)
  const manifest = json(join(directory, 'manifest.json'))
  const staging = mkdtempSync(join(tmpdir(), 'zodvex-dynamic-archive-'))
  const cases = manifest.cases.map(row => `unused-${row.unused}-touched-${row.touched}`)
  try {
    for (const name of cases) cpSync(join(directory, name), join(staging, name), { recursive: true })
    mkdirSync(join(staging, 'harness'))
    for (const [name, expected] of Object.entries(manifest.harnessHashes)) {
      assert.equal(sha256(readFileSync(join(here, name))), expected, name)
      cpSync(join(here, name), join(staging, 'harness', name))
    }
    const files = Object.fromEntries(filesBelow(staging).map(name => [name, sha256(readFileSync(join(staging, name)))]))
    const archive = join(directory, 'raw-evidence.tar.xz')
    tar(['-cJf', archive, '-C', staging, 'harness', ...cases])
    writeFileSync(join(directory, 'raw-evidence-index.json'), JSON.stringify({
      format: 'zodvex-dynamic-import-evidence-v1', archiveSha256: sha256(readFileSync(archive)),
      archiveBytes: statSync(archive).size, files,
    }, null, 2))
    const result = verify(directory)
    for (const name of cases) rmSync(join(directory, name), { recursive: true })
    return result
  } finally { rmSync(staging, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory] = process.argv.slice(2)
  if (!directory || !['pack', 'verify'].includes(command)) throw new Error('Usage: node evidence.mjs pack|verify RESULT_DIRECTORY')
  console.log(JSON.stringify(command === 'pack' ? pack(directory) : verify(directory)))
}
