import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as z from 'zod';
import schema, { EncodedText } from './schema.mjs';

assert.equal(process.version, 'v22.22.3');
assert.equal(Object.keys(schema.__zodTableMap).length, 12);
let codecRoundTrips = 0;
for (let index = 1; index <= 11; index++) {
  const name = `table${String(index).padStart(2, '0')}`;
  const content = schema.__zodTableMap[name].insert.shape.content;
  const wire = `neutral value ${index}`;
  const decoded = z.decode(content, wire);
  assert(decoded instanceof EncodedText);
  assert.equal(z.encode(content, decoded), wire);
  assert.equal(content.safeParse(42).success, false);
  codecRoundTrips++;
}

const insert = schema.__zodTableMap.table01.insert;
const wire = {
  parentId: 'neutral-reference',
  label: 'Neutral label',
  content: 'Neutral content',
  state: 'ready',
  quantity: 1,
  detail: { priority: 'normal', choice: { kind: 'plain', value: 'Neutral choice' } },
  fallback: null,
};
const decoded = z.decode(insert, wire);
assert(decoded.content instanceof EncodedText);
assert.deepEqual(z.encode(insert, decoded), wire);
assert.equal(insert.safeParse({ ...wire, quantity: -1 }).success, false);
assert.equal(insert.safeParse({ ...wire, state: 'invalid' }).success, false);
assert.equal(insert.safeParse({ ...wire, detail: { ...wire.detail, choice: { kind: 'invalid' } } }).success, false);

const input = JSON.parse(readFileSync(new URL('./sanitized-input-report.json', import.meta.url)));
const actual = JSON.parse(readFileSync(new URL('./report.json', import.meta.url)));
assert.deepEqual(actual.runtime, input.runtime);
assert.deepEqual(actual.versions, input.versions);
assert.equal(actual.census.definitionTraversalComplete, true);
assert.equal(actual.census.codecs, codecRoundTrips);

const rows = [];
function compare(expected, observed, prefix = '') {
  for (const key of Object.keys(expected)) {
    const metric = prefix ? `${prefix}.${key}` : key;
    if (typeof expected[key] === 'number') {
      const delta = observed[key] - expected[key];
      rows.push({ metric, input: expected[key], synthetic: observed[key], delta,
        percentDelta: expected[key] === 0 ? null : Number((100 * delta / expected[key]).toFixed(2)) });
    } else if (expected[key] && typeof expected[key] === 'object') {
      compare(expected[key], observed[key], metric);
    }
  }
}
compare(input.census, actual.census, 'census');
compare(input.localImport, actual.localImport, 'localImport');
writeFileSync(new URL('./comparison.json', import.meta.url), JSON.stringify(rows, null, 2) + '\n');
const verification = {
  passed: true,
  node: process.version,
  models: 12,
  codecRoundTrips,
  invalidCodecInputsRejected: codecRoundTrips,
  representativeDocumentRoundTrip: true,
  representativeInvalidDocumentsRejected: 3,
  runtimeMatchesInput: true,
  reportedVersionsMatchInput: true,
  definitionTraversalComplete: true,
};
writeFileSync(new URL('./verification.json', import.meta.url), JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify(verification));
