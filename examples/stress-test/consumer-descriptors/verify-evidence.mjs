import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { sha256 } from '../memory/provenance.mjs';

const out = resolve(process.argv[2] ?? '.');
const memory = join(out, 'memory');
const load = name => JSON.parse(readFileSync(join(memory, name), 'utf8'));
const manifest = load('manifest.json'), summary = load('summary.json'), semantics = load('semantics.json');
const callsText = readFileSync(join(memory, 'calls.jsonl'), 'utf8');
const calls = callsText.trim().split('\n').map(line => JSON.parse(line));
const assert = (value, message) => { if (!value) throw new Error(message); };
assert(summary.validMeasurement && calls.length === 18 && manifest.plannedCalls === 18, 'Incomplete memory observation set');
assert(summary.manifestSha256 === sha256(readFileSync(join(memory, 'manifest.json'))), 'Manifest hash mismatch');
assert(summary.callsSha256 === sha256(callsText), 'Calls hash mismatch');
assert(semantics.baselinePasses && semantics.rows.every(row => row.full.passes), 'Baseline correctness failed');
const mismatches = semantics.rows.filter(row => row.full.passes !== row.descriptor.passes).map(row => row.name);
assert(isDeepStrictEqual(mismatches, semantics.mismatches), 'Semantic mismatches disagree');
const status = mismatches.length ? 'FAILED' : 'PASSED';
assert(semantics.contractStatus === status && manifest.contractStatus === status && summary.contractStatus === status, 'Compatibility status mismatch');
assert(new Set(calls.map(row => row.id)).size === 18, 'Duplicate call id');
for (let round = 0; round < 3; round++) {
  const planned = [0, 16, 64].flatMap(count => ['eager', 'descriptor'].map(kind => `${kind}:${count}`));
  const actual = calls.filter(row => row.round === round).map(row => `${row.kind}:${row.count}`);
  assert(isDeepStrictEqual(actual, round % 2 ? planned.reverse() : planned), 'Call order mismatch');
}
for (const row of calls) {
  const source = readFileSync(join(memory, 'sources', `${row.id}.js`));
  assert(row.bundleHash === sha256(source) && row.bundleBytes === source.length, 'Bundle artifact mismatch');
  assert(row.valid && Object.values(row.checks).every(Boolean), 'Invalid observation');
  const value = row.raw.value;
  const names = ['probe', ...Array.from({length:row.count}, (_, i) => `unused${i}`)].sort();
  assert(row.raw.status === 'success' && value.nonce === row.id && value.kind === row.kind && value.count === row.count, 'Query identity mismatch');
  assert(isDeepStrictEqual(value.tables, names) && value.checksum === names.reduce((n, name) => n + name.length, 0), 'Retained map mismatch');
  assert(isDeepStrictEqual([...value.models].sort(), row.kind === 'eager' ? names : []), 'Model initialization mismatch');
  assert(isDeepStrictEqual([...value.descriptors].sort(), row.kind === 'descriptor' ? names : []), 'Descriptor initialization mismatch');
  assert(isDeepStrictEqual(value.operation, semantics.operations[row.kind === 'eager' ? 'full' : 'descriptor']), 'Operation result mismatch');
  const parsed = readFileSync(join(memory, `gc-${row.id}.log`), 'utf8').split('\n').flatMap(line => {
    const at = line.indexOf('GC: {'); if (at < 0) return [];
    try { const gc = JSON.parse(line.slice(at + 4).trim()); return gc.reason === 'testing' ? [{identity:line.slice(0, at).match(/^\[[^\]]+\]/)?.[0], ...gc}] : []; } catch { return []; }
  });
  assert(isDeepStrictEqual(parsed, row.gc), 'Raw GC log differs from recorded events');
  assert(parsed.length >= 2 && new Set(parsed.map(gc => gc.identity)).size === 1 && parsed.every(gc => gc.identity && gc.gc === 'mc' && gc.end_object_size > 0), 'Invalid forced GC records');
  assert(row.totalRetainedObjectBytes === parsed.at(-1).end_object_size, 'Retained byte mismatch');
}
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
for (const cell of summary.cells) {
  const rows = calls.filter(row => row.kind === cell.kind && row.count === cell.count);
  const values = rows.map(row => row.totalRetainedObjectBytes);
  const deltas = rows.map(row => row.totalRetainedObjectBytes - calls.find(control => control.kind === row.kind && control.count === 0 && control.round === row.round).totalRetainedObjectBytes);
  assert(rows.length === 3 && isDeepStrictEqual(values, cell.retainedBytes) && median(values) === cell.medianRetainedBytes, 'Summary retained bytes mismatch');
  assert(isDeepStrictEqual(deltas, cell.deltaBytesFromPairedZero) && median(deltas) === cell.medianDeltaBytes, 'Summary paired delta mismatch');
}
console.log(`Verified 18 memory observations and raw sources/GC; compatibility ${status}.`);
