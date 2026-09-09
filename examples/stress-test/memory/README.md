# Model graph memory benchmark

The primary question is **how much isolate memory an imported model graph occupies,
and how large that graph can become before a query fails**. Model count is a useful
axis when its shape is fixed. The [codec workload benchmark](../capacity/README.md)
answers the separate question of operation overhead as document volume grows.

[Observed results and evidence](../results/memory-2026-09-09/README.md) include an
actual hosted query OOM in Full where the same graph dimensions pass in helpers,
Mini and native Convex. A smaller model shape passes at the same model count.

## Two measurements

1. **Retained graph weight:** run an official local Convex backend with V8 GC
   diagnostics. Measure retained object bytes after graph initialization and one
   tiny codec operation; subtract a matched zero-background-model control.
2. **Hosted capacity bracket:** run the same graph without forced GC, varying only
   graph dimensions. Record repeated successful counts and memory failures, keeping
   module-analysis failures separate from query-execution failures.

Together these measure the graph's memory cost and the capacity it consumes. They
do not expose exact free MiB on the hosted service. Do not subtract local retained
bytes from a nominal 64 MiB limit: construction peaks, GC policy, code, external
allocations and backend version also affect the boundary.

## Fixture contract

`count` is **background models**, plus one fixed probe model. Every field/model
gets distinct schema instances. The same factory function constructs them, so
source-code size stays roughly constant as count grows. This isolates schema
object weight; it does not reproduce the code footprint or module topology of
thousands of separately authored source files.

The default `codec-rich` model cycles through timestamp↔Date, string↔SecretText,
a nested timestamp with optional tag, and an array of string-or-number values.
Width 32 means 32 top-level fields, 48 fields including nested objects, and 24
codec sites per background model. Width 8 is the same pattern at a smaller size.
`fields-only` is a separate string/number/boolean/optional-string control.
SecretText is a small runtime class, not encryption or Hotpot's SensitiveField.

| Variant | Retained graph |
|---|---|
| Native | Convex validators, table/schema objects, native builders |
| Helpers | Full Zod schemas and a helpers query builder |
| Full | `defineZodModel`, `defineZodSchema`, `initZodvex`; default schema helpers enabled |
| Mini | Same Zodvex model contract using Zod Mini |

The graph retains every model and schema, plus optional eager registry entries,
through an independently checked checksum after the operation/GC. The manifest
counts explicit fixture constructors, fields and codecs; it does not pretend to
count the library's internal allocations. Native uses manual codec conversion
and lacks Zod/model guarantees. Native and helpers are matched **eager graph
controls**; ordinary applications using them need not import every unused model.

Every case decodes and re-encodes one fixed four-field value, exercises Date and
SecretText methods, and returns the same tiny result. There are **zero DB reads or
writes**. This intentionally measures graph capacity, without a growing document
workload masking it behind a read limit. The probe parses schemas directly; it
does not benchmark `ctx.db` wrapping or return-codec integration. The separate
workload benchmark covers that pipeline.

## Hosted run

Install the repository's frozen dependencies and build the library. Use normal
Convex CLI account login and the harness's configured dedicated development project
in `_deploy/.env.local` (see the [existing setup instructions](../README.md#setup-the-harnesss-own-deployment)).
Then, from `examples/stress-test`:

```sh
# 24 calls: four variants, two graph sizes, three alternating rounds.
bun run memory --deployment=<dedicated-dev>

# Confirm a known bracket without another broad search.
bun run memory --deployment=<dev> --kinds=full --counts=416,448

# Hold count constant and change weight.
bun run memory --deployment=<dev> --kinds=full --counts=512 --width=8

# Evaluate the normal top-level initialization shape separately.
bun run memory --deployment=<dev> --mode=static --kinds=full --counts=416,448
```

`--mode=handler` constructs the graph inside a query, establishing a runtime
capacity limit. `--mode=static` initializes it at module scope, as imports normally
do. A static OOM during the one-off analyzer is an **analysis** result, not proof
that an already-deployed query failed. Both are useful and must remain labeled.

The runner invokes the installed Convex CLI's `runOneoffQuery` MCP tool with an
explicit deployment name and verifies the returned target URL. It sends a bundled
query without replacing deployed functions/schema or seeding data. Each call still
uploads and analyzes that standalone module. It uses the query execution path;
the backend implementation runs it without query caching. Unique nonces also let
the oracle identify each result. Isolate placement/reuse on hosted Convex is not
controlled. See the backend's [one-off handling](https://github.com/get-convex/convex-backend/blob/bbc3e3c8d03a75296fc00523d7849bf9ce0865c2/crates/application/src/lib.rs#L2693)
and [function runner](https://github.com/get-convex/convex-backend/blob/bbc3e3c8d03a75296fc00523d7849bf9ce0865c2/crates/application/src/application_function_runner/mod.rs#L795).

Calls are sequential, capped at 64, with a three-minute loop budget and 30-second
request timeout. There is no automatic retry. A request/transport/oracle failure
invalidates the run; a classified query memory/time limit remains an observation.
Time failures are not memory ceilings. Mixed pass/fail outcomes stay mixed.

Every new result directory preserves manifests, resolved versions, Git state,
fixture hashes, exact emitted sources, per-call timestamps and raw responses.
Bundle checks reject cross-variant imports (including classic Zod in Mini).
Registry entries default to zero; `--entries` changes a separately named axis.

## Local Convex retained heap

Use an existing official `convex-local-backend` binary and matching instance admin
key. The launcher creates a dedicated local diagnostic process; it does not
download binaries or attach to a consumer app. On macOS, CLI-cached binaries are
under `~/.cache/convex/binaries/`. Matching built-in development credentials are
in the backend source's `crates/keybroker/dev/` at the binary's revision.

```sh
# Terminal 1; use a new directory. Keep it running while collecting.
python3 memory/start-local.py \
  --binary=/absolute/path/to/convex-local-backend \
  --directory=/private/tmp/zodvex-memory-backend \
  --admin-key=/absolute/path/to/matching-admin-key \
  --source-revision=<known-backend-commit>

# Terminal 2, from examples/stress-test: zero plus 128 background models.
bun memory/local.mjs /private/tmp/zodvex-memory-backend 128 32 codec-rich
bun memory/local.mjs /private/tmp/zodvex-memory-backend 128 8 codec-rich
```

Stop the launcher with Ctrl-C when finished. Its directory contains a private
credential and backend log; publish only the collector's result directory.

The launcher binds loopback, sets `REUSE_ISOLATES=false`, and enables
`--expose-gc --trace-gc-nvp`. A PTY makes V8 diagnostics flush. The collector performs
two final explicit GCs while the graph remains live and waits for log quiescence.
It requires matching isolate identity, major-GC records, positive byte readings,
and an independently correct query result. An explicit GC can first complete an
incremental cycle, so event count is not assumed to be exactly two. The last
validated `end_object_size` is the retained V8 object-byte observation.

That field comes from [V8's GC tracer](https://github.com/denoland/v8/blob/708fc9b76e540c03e9a7c5e1d4f768b279517589/src/heap/gc-tracer.cc#L398)
and [`SizeOfObjects`](https://github.com/denoland/v8/blob/708fc9b76e540c03e9a7c5e1d4f768b279517589/src/heap/heap.cc#L1472).
It includes in-heap objects/code, not RSS, external backing stores, allocator
commitment or an exact construction peak. Forced GC changes runtime behavior;
use unforced hosted runs to establish hosted failure brackets.

## What to publish and use as a goal

Publish **shape + versions + retained-byte delta + repeated pass/fail bracket +
failure phase**, accompanied by the raw evidence. All-pass cases establish a lower
bound, not a maximum. Preserve differences between a local backend of known revision
and an unobserved hosted revision. Corroborate important one-off findings with a
small ordinary deployed query, as in the initial results; standalone flattening
and handler construction are not identical to a consumer's static imports.

For optimizations, reduce retained graph bytes at fixed shape, then demonstrate
that the hosted query success bracket moves upward without breaking codec results.
Keep known passing cases as regression checks. Full reaching the helpers bracket
is a useful initial comparative target for this fixture; native is a lower-level
reference with fewer guarantees. These are improvement targets, not promises of
universal table-count parity. Recheck across time before setting a hard release gate.

A consumer's own schema graph should eventually be another named fixture. Document
volume, codec implementation complexity, endpoint registry weight and module/code
size remain independent sources of memory use. This benchmark supplies a measurable
baseline for that work rather than a universal application sizing formula.
