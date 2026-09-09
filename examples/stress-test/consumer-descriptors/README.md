# Historical descriptor consumer experiment

**FAILED current boundary compatibility. Incomplete experiment; not a production feature or an equivalent consumer performance improvement.**

This inventories PR #80 at immutable commit `cfc06b6ac02a1104e0b7e0de7283e510c9abeb06` against the current installed library and Zod 4.5.4. `historical-emitter.ts` and `historical-zod-to-source.ts` are pinned audit copies, not a second supported code generator. `source-origin.json` identifies the exact source files, extracted algorithm, and limited import/header adaptations. Historical claims inside copied comments are not conclusions of this experiment. No production code, CLI defaults, dependency versions or example apps are changed.

## Consumer fixture

The full case uses `defineZodModel` and `defineZodSchema`, with one statically imported probe model plus 0, 16 or 64 unused background models. Each background model has 32 fields: 28 primitive fields, a Date codec, a shared string-to-SecretText codec, an optional Date codec, and a nested object containing a Date array and an ordinary note. This is four codec sites per background model. SecretText is a deterministic test class, not encryption or Hotpot's SensitiveField.

The descriptor case runs the actual extracted emitter during fixture generation. Its generated central table map statically imports one loose descriptor per model. It imports the standalone custom codec module, never original model modules in this supported fixture. Codecs remain present for every background model; ordinary fields are removed. Build-time fallback counts, bundle input paths, and runtime model/descriptor initialization names verify the distinction. Every table-map entry remains reachable after the operation and the final GC.

One fixed probe model exercises the current public `ZodvexDatabaseWriter`: insert, get, codec plus ordinary patch, get, optional-field unset, get, replace, and query `.take(1)`. Operations use a small stateful in-memory implementation of the underlying DB contract. They run **inside a real local Convex query**, but make **zero deployed database reads or writes**. This measures generated import cost and wrapper/codec functionality, not a complete application, registered Zod function boundaries, Convex storage enforcement, network latency or query/mutation capacity. No new compiler or deferred-schema architecture is introduced.

## Correctness comes first

The semantic matrix checks 25 outcomes before collection. Every full-baseline check must pass. Thirteen descriptor mismatches are currently characterized, and the result status is derived from those observations:

- **Intentional historical contract change:** ordinary modeled-read types, refinements and transforms are no longer parsed. Read defaults also disappear. This differs from current main's full document parsing.
- **Actual codec failure:** a discriminated-union descriptor ends in an unrestricted loose-object branch. A wire-valid string whose decoded codec output fails a minimum-length check falls through and returns raw wire data. Valid union codecs still work. The matrix also records an invalid-wire example, but the wire-valid case demonstrates the problem independently of Convex structural validation.
- **Default-wrapper loss:** a missing default-wrapped Date codec rejects instead of supplying the model's default.
- **Changed write-stage checks:** ordinary invalid/missing insert and replace values reach the mock underlying DB. Real Convex still validates representable wire shape at storage; this is not evidence that wrong-type data could be stored in a correctly configured Convex table. Serializable write refinements and custom-refinement fallback remain enforced in the characterized cases.
- **Port integration gap:** current main's partial encoder reconstructs a stripping object. Ordinary patch fields absent from a descriptor are dropped. PR #80 also changed that encoder to use a loose object; this experiment intentionally ports only the emitter/table-map strategy and records the missing runtime bridge. Date patches, unsets, insert/get and replace/query codecs pass.

The synthetic semantic loader injects referenced codec/model objects to inspect historical fallback behavior. The memory fixture instead imports emitted files through real bundle/module resolution and has zero fallback tables. The measurements do not estimate an application whose custom codec or refinement imports pull in a larger source module graph.

## Run locally

Install frozen dependencies and build the library. Use the benchmark foundation's `memory/start-local.py` with a dedicated backend directory, matching private admin-key file, `REUSE_ISOLATES=false` and V8 `--expose-gc --trace-gc-nvp`. Do not publish the backend directory or its credential.

From `examples/stress-test`:

```sh
bun run test consumer-descriptors/semantic.test.ts consumer-descriptors/generated.test.ts
bunx tsc -p consumer-descriptors/tsconfig.json
bun consumer-descriptors/run.ts /private/tmp/dedicated-backend results/local/descriptor-new-run
bun consumer-descriptors/canary.ts /private/tmp/dedicated-backend results/local/descriptor-canary
bun consumer-descriptors/inspect.ts results/local/descriptor-new-run/fixtures/16 results/local/descriptor-inspect
```

The collector schedules 18 sequential calls: two variants × three background counts × three alternating rounds, capped at one minute. It reuses the foundation provenance/build digest and fresh-isolate GC procedure. At least two testing major-GC records, matching isolate identity, positive retained bytes, log quiescence, initialization counts, table checksum and exact characterized operation outcomes are required. It checks build/dependency/source identity again after collection. A valid measurement is distinct from passing compatibility.

Raw emitted modules, bundled query sources, timestamps, bundle imports/hashes, responses, GC excerpts and per-round zero-model deltas are retained. A smaller retained-byte delta is evidence about this incompatible strategy's graph weight only. It is not a production recommendation, exact free heap, hosted capacity claim or universal model-count limit.

The generated `diagnostic-full.ts` entry exports the genuine full schema. `diagnostic-descriptor.ts` is an explicit `{ __zodTableMap }` adapter for the packaged `inspect-schema` census, not a Convex schema. Those local Node import/heap reports must stay separate from Convex retained-memory results.

The optional canary is deliberately pinned to a dedicated loopback backend on port 3240. It deploys one probe table and one union table, exercises both table maps in a bounded internal mutation, and deletes its own rows. It confirms that the wire-valid union failure survives actual Convex storage validation. The canary's ordinary patch result remains a limitation of this isolated port: the original whole PR contained the loose-patch bridge.
