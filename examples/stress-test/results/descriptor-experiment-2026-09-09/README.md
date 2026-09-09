# PR #80 descriptor experiment — FAILED compatibility

**Incomplete/nonfunctional as a replacement for current main.** All 25 full-baseline semantic outcomes pass; the descriptor strategy differs on 13. Its smaller retained graph is not an equivalent consumer improvement. This study integrates the historical emitter/table-map mechanism with the merged benchmark and packaged diagnostic foundation without changing production behavior.

Historical source: PR #80, `cfc06b6ac02a1104e0b7e0de7283e510c9abeb06`. Comparison base: merged main `1f415c47fa7659c860a3a813cb371020bde53c94` (#142 and #143 included). Actual resolved dependencies: Zod 4.5.4, Convex SDK 1.32.0, Zodvex 0.7.10; the complete versions and build digest are in `memory/manifest.json`. The official local backend is revision `8bc6aa4645adfd66584034b175dbef96536938b8`, binary SHA-256 `c07e85501038cdf6f969e2f7f8cb81e897a64f25d08d590ebd501342eaa3906c`.

## Retained memory

Eighteen real local Convex query observations passed all evidence checks in 4.165 seconds: two variants, three unused-model counts, three alternating rounds. One probe model is touched in every case. Each unused model has 32 fields and four codec sites; shared custom-codec instances are retained by reference. All descriptor files and zero original models initialize in the descriptor case. The full case initializes all original models. There are zero fallback tables in this memory fixture.

| Unused models | Full median retained bytes | Descriptor median retained bytes | Full paired growth from zero | Descriptor paired growth from zero |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 4,731,416 | 4,554,832 | 0 | 0 |
| 16 | 5,780,344 | 4,979,288 | 1,048,928 | 424,456 |
| 64 | 8,541,384 | 6,139,808 | 3,809,968 | 1,584,904 |

Growth columns are medians of within-round differences, not necessarily differences between independently aggregated medians. `memory/summary.json` retains all three values. The descriptors still initialize a codec graph for every unused model; they do not make unused imports free.

The query runs the public current `ZodvexDatabaseWriter` against a stateful in-memory underlying DB contract. Date/custom-codec insert/get, codec patches, unsets and replace/query operations pass. The current-runtime ordinary patch gap is independently asserted rather than hidden by the passing codec outputs. Memory cells perform no real storage operations; the separate deployed canary below checks those.

These are forced-GC retained V8 object bytes on a fresh-isolate local backend. They exclude external allocations and exact construction peaks. There is no hosted capacity ceiling, latency claim or model-count allowance. Do not rank these bytes against the separate dynamic-import experiment: that fixture has 32 codec sites per model and measures V8 actions with manual schema operations.

## Behavioral findings and deployed storage canary

- PR #80 deliberately removes ordinary modeled-read validation. Types, refinements and transforms therefore differ from current main's full document parse; read defaults also disappear.
- **Confirmed codec bug:** a generated discriminated-union fallback accepts a wire-valid string whose decoded codec output violates its minimum length. The real local storage canary inserted that string through native Convex, observed the full wrapper throw and the descriptor wrapper return raw wire data. All canary rows were deleted.
- **Confirmed default-wrapper loss:** a missing default-wrapped Date codec rejects instead of supplying its default.
- Invalid ordinary insert/replace values reach the mock underlying DB in descriptor mode. This demonstrates changed wrapper-stage validation, not that Convex would store a wrong-type value: native storage still enforces its representable wire validator.
- **Isolated-port integration gap:** ordinary patch fields absent from the descriptor are stripped by the current partial encoder. The original whole PR #80 included a loose-object runtime bridge; this is not a claim that its complete branch had this patch regression. Valid codecs and optional-field unsets succeed in the real deployed canary.

`memory/semantics.json` contains all outcomes and errors. `canary/call.json`, `canary/response.json` and `canary/summary.json` preserve actual deployed mutation results and gates. Local deployment and type checking passed. The experiment still lacks a compatible general consumer contract, fallback-heavy graph measurements, a required-model scaling axis and hosted query/mutation capacity measurements; none is inferred from these cells.

## Packaged CLI exercise

The merged `zodvex inspect-schema` command successfully reported both the genuine full schema and an explicit descriptor table-map diagnostic adapter at 16 unused models plus the probe. Both contain 17 models and 52 unique codec instances. The full census has 758 unique schemas and 1,102 object-field slots; the descriptor census has 258 schemas and 85 slots. This directly identifies the ordinary schema structure removed by the historical mechanism.

Node 25.2.1 import-heap medians were 4,224,856 bytes for full and 3,296,472 bytes for descriptors. These are Node import proxies, separate from Convex retained bytes. The adapter is not a deployable Convex SchemaDefinition. Complete aggregate reports, exact entry hashes and CLI provenance are in `inspect/`.

## Reproduce and verify

See `../../consumer-descriptors/README.md` for fixture semantics and commands. Use fresh directories under `results/local/` for additional runs; this promoted result is immutable. No historical model-count sweep or whole old branch was merged.

`raw-evidence.tar.xz` contains exact generated fixture modules, bundled queries, GC excerpts, canary source project and experiment source snapshot. Readable manifests, calls and summaries remain alongside it. Private `.env.local` and backend credentials are excluded. `artifact-manifest.json` records every archived path/hash; `SHA256SUMS` checks the promoted files.

From this result directory:

```sh
shasum -a 256 -c SHA256SUMS
tar -xJf raw-evidence.tar.xz
bun ../../consumer-descriptors/verify-evidence.mjs .
```

Offline verification rechecks all 18 sources, raw GC records, initialization counts, codec outcomes, call order, nonces and paired deltas. Extraction/verification was also tested in a fresh temporary directory. Focused fixture tests and the experiment's TypeScript check passed. The historical implementation remains unchanged. This experiment used only dedicated local deployments.
