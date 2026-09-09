# Dynamic-import mechanism on the merged foundation

> **WARNING — ACTION MECHANISM ONLY.** Query and mutation imports fail on the tested backend. Whole-consumer Zodvex integration is unfinished; these results do not describe a production-ready optimization.

Runtime table selection avoided initializing unused model modules in a deployed local Convex V8 action. With one touched model and 64 unused models, the eager action initialized 65 modules and retained a median **23,588,568 bytes**; the dynamic action initialized one and retained **4,817,824 bytes**. These are total observed V8 retained object bytes, not model-only allocations.

Actual query and mutation controls both rejected dynamic imports with `TypeError: dynamic module import unsupported`. All eight dynamic query/mutation controls failed for that reason; all eight corresponding static controls succeeded. Action success is therefore not evidence of query/mutation compatibility.

## Repeated observations

Every cell has three measurements from distinct runtime isolate identities. All codec checks passed, including a numeric wire value outside Date's valid range. Exact minimum/median/maximum values are in [summary.json](summary.json).

| Unused models | Touched models | Eager median bytes | Dynamic median bytes | Required-schema helpers median bytes |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 1 | 4,772,480 | 4,776,352 | 4,671,512 |
| 16 | 1 | 9,532,752 | 4,786,720 | — |
| 64 | 1 | 23,588,568 | 4,817,824 | 4,671,456 |
| 64 | 8 | 25,810,968 | 7,114,576 | — |

The model-module initialization counts were 1/17/65 for the eager one-touch cases and 1/1/1 for dynamic. The eight-touch case initialized 72 eager modules or exactly the eight runtime-selected dynamic modules. Helpers initialized one required schema in both measured cases.

| Fixed one-touch change: unused 0 → 64 | Median retained-byte change | Interpretation |
| --- | ---: | --- |
| Eager central model registry | +18,816,088 | Unused model construction remains in the imported graph |
| Runtime-key dynamic model loader | +41,472 | Small nonzero loader/module overhead remains; unused model initializers did not run |
| Natural helpers required-schema import | −56 | Within repeat variation; the 64-unused range was 4,671,456–4,673,480 bytes |

The helpers control uses the actual `zCustomAction` builder and imports only its required Zod schema. The same deployment also contains the full model modules; the official CLI bundle audit found no Zodvex dependency in the helpers endpoint's static closure. Its static emitted dependency bytes were unchanged (661,506) as unused modules increased.

These totals do not compare equivalent production endpoint contracts. The full-model cases use native action builders and manual `decodeDoc`/`encodeDoc`; helpers additionally validates action arguments/returns through Zod. Forced GC occurs inside the handler, before helpers return-wrapper finalization. The unused-growth slope is stronger evidence than the roughly 0.15 MB total-byte difference between dynamic and helpers at 64 unused models.

## Fixture and evidence

The [fixture documentation](../../consumer-dynamic-import/README.md) defines a neutral 32-field model with Date, custom-class, nested discriminated-union, and primitive-union-array fields. Each model is a separate module with distinct schema instances and default schema helpers enabled. The 8-model request spreads keys across the 72-module graph. There are no DB reads/writes or application rows.

The official Convex CLI exported 1/17/65/72 separate dynamic model targets for the four cases. Every audit required zero model initializer markers in the dynamic endpoint's initial static closure, all models in the eager closure, and every dynamic target outside that initial closure. Runtime before/after initialization markers independently confirm that this was real deferred module initialization rather than a bundler-collapsed function call or a requested-count counter.

Collection completed with 60 local calls: 30 forced-GC action samples, 10 unforced action canaries, 16 query/mutation controls, and four deployed configuration canaries. Each app passed CLI TypeScript validation and local deployment. The collector used the foundation's exposed-GC/fresh-isolate method, retained only validated major-GC observations, and rechecked build/dependency/measurement-source provenance before certifying the run.

| Identity | Recorded value |
| --- | --- |
| Merged foundation | `1f415c47fa7659c860a3a813cb371020bde53c94` |
| Built Zodvex JS digest | `90df46a854e5e255770945d79393018327dfddd2daf43f1107b297930c503b7d` |
| Zod / Zodvex | `4.5.4` / `0.7.10` |
| Convex CLI / helpers / CLI esbuild | `1.32.0` / `0.1.113` / `0.27.0` |
| Driver runtime | Node `22.22.3`, macOS arm64 |
| Official local backend revision | `8bc6aa4645adfd66584034b175dbef96536938b8` |
| Backend binary SHA-256 | `c07e85501038cdf6f969e2f7f8cb81e897a64f25d08d590ebd501342eaa3906c` |
| Backend settings | `REUSE_ISOLATES=false`, `--expose-gc --trace-gc-nvp` |

[manifest.json](manifest.json) identifies the build, fixture, versions, source hashes, and scope. [calls.jsonl](calls.jsonl) preserves individual raw responses, initialization arrays, GC records, failures, and timestamps. [raw-evidence.tar.xz](raw-evidence.tar.xz) contains exact generated sources and emitted bundles, per-case audits, raw GC excerpts, canaries, deployment results, and the measurement-source snapshot. [raw-evidence-index.json](raw-evidence-index.json) hashes the archive and every archived file.

From the repository root, verify the archive, source/bundle hashes, nonce/codec results, independent initialization observations, repeated statistics, and raw GC records without a backend or original temporary directory:

```sh
node examples/stress-test/consumer-dynamic-import/evidence.mjs verify \
  examples/stress-test/results/dynamic-import-experiment-2026-09-09
```

To inspect the raw files manually:

```sh
mkdir /tmp/zodvex-dynamic-evidence
tar -xJf examples/stress-test/results/dynamic-import-experiment-2026-09-09/raw-evidence.tar.xz \
  -C /tmp/zodvex-dynamic-evidence
```

The historical [PR #84](https://github.com/panzacoder/zodvex/pull/84) supplied the experiment idea only. Its 750-model corpus and earlier capacity thresholds are not reproduced or adopted. This run demonstrates a local action module-loading mechanism on a known backend, not hosted capacity, whole-consumer `initZodvex`/`ctx.db` integration, automatic endpoint codecs, database relationship traversal, or reactive/transactional parity. Its separate-module union fixture also differs from the foundation's factory graph; absolute bytes cannot be compared across them.
