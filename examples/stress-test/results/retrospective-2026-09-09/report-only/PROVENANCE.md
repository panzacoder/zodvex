# Report-only synthetic workload trial

This directory contains an independently hand-authored, neutral schema based only
on the supplied aggregate `zodvex-local-schema-report-v1` JSON and the public
Zodvex diagnostic implementation. No private application source, directories,
history, dependency lockfiles, source bundles, names, values, or function bodies
were accessed or used. The supplied aggregate report is preserved under the
neutral filename `sanitized-input-report.json`.

The public reference files consulted were `customer-diagnostic.md`, `census.mjs`,
`inspect.mjs`, `inspect-worker.mjs`, `profile.mjs`, `bundle.mjs`, census tests,
and public model/schema helper implementations. Their contract was used to
interpret counts and measurement scope. The fixture uses published npm packages,
not a linked checkout build.

## Construction choices and assumptions

- Twelve ordinary object models, each with eight source fields. Document/insert
  schemas and default helper construction come from `defineZodModel` and
  `defineZodSchema` without modifying library internals.
- Modest nested objects, four discriminated unions, simple optional/nullable
  fields, strict nested objects, and scalar unions reproduce the reported mix.
  The report does not identify these arrangements; they are independent choices.
- Eleven string-to-class codecs have tiny, functional encode/decode callbacks.
  One neutral class is shared. No dummy objects, retained byte arrays, artificial
  imports, generated functions, or string padding were added to fit memory/size.
- Ten source ID schemas plus library-generated document IDs are a plausible
  source of custom checks. Other checks validate a few labels and quantities.
  The report does not reveal check categories, codec endpoint kinds, classes,
  closure captures, or how many IDs actually exist.
- The final fixture shares two common text schemas among semantically related
  labels and notes, in addition to automatic doc/insert field sharing. Wrapper
  instances and most other primitives remain independent.
- Exact reported versions are pinned: Convex 1.45.0, Zod 4.4.3, Zodvex 0.7.10.
  Convex resolves esbuild 0.27.0, matching the input. Node 22.22.3, V8, OS, and
  architecture also match. Other transitives were normally resolved by npm and
  locked in `package-lock.json`; their original versions are absent from the
  aggregate report. For example, convex-helpers resolved to 0.1.124 here.

## Trial history

`schema.initial.mjs` and `report.initial.json` preserve the first construction.
Its count of repeated references was 96 versus the input's 138, and it had 112
distinct string schemas versus 78. Inspection showed the purported shared
definitions were each used once, with sharing coming only from document/insert
aliases. One semantic revision introduced reusable common label/note primitives.
This removed 36 distinct string instances and added 36 repeated references.

No further iteration was performed to hit exact census totals, callback counts,
heap bytes, bundle bytes, or module counts. The remaining differences are evidence,
not calibration failures to hide. Neither version incorporates hidden graph data.

## Reproduction and verification

From this directory, use the exact Node 22.22.3 executable (the local npm `node`
development dependency supplies one) and a checkout of the public diagnostic:

```sh
./node_modules/node/bin/node /path/to/zodvex/examples/stress-test/memory/inspect.mjs ./schema.mjs > report.json
./node_modules/node/bin/node ./verify.mjs
```

The actual inspection used Node 22.22.3 and the unmodified public diagnostic in
`examples/stress-test/memory/inspect.mjs`.
The command bundles for Node 22 under Convex/module conditions, imports in three
fresh child processes, samples retained heap after two GCs, then performs census.
It discarded raw bundle output according to the diagnostic contract.

`verify.mjs` separately checks all eleven codec round trips, rejects eleven
invalid codec inputs, round-trips a representative document, rejects three
invalid documents, and verifies exact runtime/reported dependency versions.
These behavior checks run after measurement in a separate process and therefore
do not inflate the report. `verification.json` records their result.

## Outcome

| Metric | Input report | Synthetic | Difference |
| --- | ---: | ---: | ---: |
| Models / schema roots | 12 / 24 | 12 / 24 | exact |
| Unique schemas | 353 | 351 | -0.57% |
| Repeated schema references | 138 | 132 | -4.35% |
| Object field slots | 314 | 312 | -0.64% |
| Codecs | 11 | 11 | exact |
| Unique checks | 49 | 52 | +6.12% |
| Explicit callbacks | 89 | 81 | -8.99% |
| Median retained import heap, bytes | 6,120,856 | 5,299,640 | -13.42% |
| Bundle bytes | 723,610 | 655,051 | -9.47% |
| Bundled modules | 156 | 130 | -16.67% |

Synthetic heap range: 5,298,064–5,304,800 bytes across three imports.
Input heap range: 6,115,048–6,121,360 bytes. External bytes match at 3,446;
ArrayBuffer deltas match at zero. These ranges are measurement variation, not
confidence intervals. External already includes ArrayBuffers.

Ten of fifteen schema-kind counts match exactly: array, boolean, custom, enum,
never, null, object, pipe, union, and unknown. Remaining input → synthetic counts
are literal 21 → 20, nullable 9 → 10, number 36 → 34, optional 55 → 57, and
string 78 → 76. The full numeric
comparison is in `comparison.json`. All schemas are classic Zod; traversal is
complete with zero unresolved lazy schemas, skipped accessors, or unrecognized
kinds. Shape getter counts also match at twelve.

The report is sufficient for a useful first manual triage fixture: it preserves
workload scale, implementation, broad definition mix, sharing, and codec/check
density without disclosing private source. It does not reproduce the original
application, explain its memory gap, establish an OOM cause, or predict hosted
capacity. Despite nearly identical schema totals, the synthetic import retains
821,216 fewer heap bytes. No causal attribution to closures, dependencies, or
topology is possible from these aggregate measurements alone.

The report cannot recover nesting depth, per-model width distribution, sharing
locations/fanout, union arity/placement, codec input/output topology, check kinds
or cost, closure captures, class implementations, module initialization side
effects, reachable helper/registry state, extra dependencies, or function-registry
reachability. The definition census omits objects outside doc/insert roots while
the import measurement can include them. It also supplies no parse workload,
allocation peak, endpoint touch counts, or Convex retained-heap measurement.

Keep this first report format for manual triage. If repeated trials show that
more precision is useful, bounded aggregate histograms of depth/width, reuse
fanout, codec endpoint kinds, and check categories could reduce construction
guesswork without adding names or source. Such additions would still require
independent validation and would not justify an automatic safe/unsafe score.
