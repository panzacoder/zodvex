# Zod 4.5 impact analysis (bundle size, isolate memory, and the perf roadmap)

**Date:** 2026-08-29 · **Zod versions compared:** 4.3.6 (repo pin) / 4.4.3 / 4.5.4 (`latest`)

Zod 4.5.0 shipped 2026-08-28 ([release notes](https://github.com/colinhacks/zod/releases/tag/v4.5.0)).
The headline feature (`z.compile()`) trades bundle bytes for parse speed, which prompted the
question: is 4.5 a net win or loss for the bundle-size/isolate-memory work in PRs #63, #80, #84?

**TL;DR: net strong win, but not because of `z.compile()`.** The compiler is irrelevant inside
Convex (dynamic codegen is hard-disabled in the V8 runtime). What matters is the *other* 4.5
change: per-schema memory dropped ~7.7× and schema construction got ~6.7× faster — and per-schema
eval memory is exactly the resource that has been OOMing the 64 MB Convex isolates. The cost is
real but secondary: the zod library itself grew ~33% in bundle bytes.

All numbers below were measured locally (esbuild 0.25 `--bundle --minify --format=esm`, Node 22,
heap deltas under `--expose-gc`; "model" = a representative 10-field object with optionals, a
3-way literal union, nested object, array, enum, default).

## 1. What Zod 4.5 actually is

- **`z.compile()` / `import "zod/compile"`** — walks a schema once and emits flat, loop-free JS,
  executed via **`new Function()`**. Opt-in: explicit per-schema calls, or a side-effect entry
  (`zod/compile`) that auto-compiles every schema on first parse. 3–9× parse speedups claimed.
- **Method memoization** — schema methods are no longer eagerly bound per instance; allocated on
  first access. This is where the memory reduction comes from (Colin's claim: `z.string()`
  7.53 kB → 784 B; we measure 4.3.6→4.5.4 at 12.9 kB → 850 B, ~15×).
- **`z.validate()`** — boolean fast-path validity check, up to 16× faster than
  `.safeParse().success` on invalid input (skips error/stack construction).
- **Soundness/breaking changes** — string min/max count Unicode code points (not UTF-16 units);
  `z.iso.datetime()` requires seconds (RFC 3339); record-key and intersection semantics aligned
  with TypeScript; `__proto__` always stripped; stricter IPv6/ULID/httpUrl/base64/emoji.
- Cyclical-input support for recursive schemas, 8 new locales, `z.creditCard()`,
  `z.deepPartial()`/`.exactPartial()`, `z.properties()`.

## 2. Bundle size: the cost is real (~+33%), and mini pays it too

| Bundle (esbuild, ESM) | 4.3.6 | 4.4.3 | 4.5.4 | Δ 4.3.6→4.5.4 |
|---|---:|---:|---:|---:|
| `zod` full, minified | 314.0 kB | 330.7 kB | 437.1 kB | **+39%** |
| `zod` full, min+gzip | 63.3 kB | 66.4 kB | 88.8 kB | +40% |
| `zod` full, unminified | 520.2 kB | 545.5 kB | 724.6 kB | **+39%** (Convex pushes unminified) |
| `zod/mini` full, minified | 294.4 kB | 309.7 kB | 414.4 kB | +41% |
| Tree-shaken consumer (3-type object schema), min | 69.5 kB | 72.1 kB | 87.8 kB | **+26%** |
| Tree-shaken mini consumer, min | — | 11.3 kB | 14.4 kB | +28% |

Particulars:

- **The compiler is NOT the main cost.** `v4/core/index.js` re-exports `./compile.js`, but it
  tree-shakes away cleanly when unreferenced (verified: no compiler markers in shaken output).
  Referenced, the compiler subgraph is ~33.6 kB min / 9.6 kB gz. The rest of the growth is core
  itself: memoization plumbing, self-contained strict format validators, code-point length
  handling, cycle support, new APIs.
- **`zod/mini` grew the same ~28–41%** — mini re-exports core, so "use mini" is not an escape
  hatch from the 4.5 size cost (it remains an escape from the classic API surface, not from core).
- For Convex deploys (unminified, bundled): the `zod` stress variant measured 2.49 MB unzipped at
  count=100 in PR #63; the zod portion grows by up to ~200 kB (+8% on that total, less whatever
  tree-shaking drops). Nowhere near Convex's bundle caps; the cost shows up in push bytes and
  cold-start eval, not in any hard limit.

## 3. Memory & construction speed: the win, and it lands exactly on our constraint

| Metric (measured) | zod 4.3.6 | zod 4.5.4 | Δ |
|---|---:|---:|---:|
| Heap per 10-field model, constructed | 306.1 kB | 39.7 kB | **7.7× smaller** |
| Heap per model after first `safeParse` | 306.5 kB | 41.7 kB | 7.4× smaller |
| Heap per bare `z.string()` | 12.9 kB | 850 B | 15× smaller |
| Construction time, 500 models | 550 ms | 82 ms | **6.7× faster** |

The 306 kB/model figure independently reproduces the "~0.2–0.3 MB at eval" constraint stated in
PR #80's design rationale — the number that made per-entrypoint analysis OOM the 64 MB push-time
isolate at ~141 models (PR #63's measured ceiling) and runtime imports OOM at K≈200 models
(PR #84). Naively scaling by 7.7×, the static-import zodvex ceiling moves from ~141 to the
**~700–1100 model range** before touching codegen or compile-away — the same order as the
codegen overhaul's ~800-table TooManyReads wall and compile-away's 2000. Schema eval getting
6.7× faster also directly cuts push-time analysis and isolate cold starts. **These numbers need
re-verification with the real stress sweep** (heap-proxy + one real push, per PR #63's
methodology) — but the direction and rough magnitude are solid.

## 4. `z.compile()` cannot run inside Convex — by design of the Convex runtime

The Convex V8 runtime boots with the flag `--disallow-code-generation-from-strings`
(convex-backend `crates/isolate/src/client.rs`, comment: "Disable `eval` or `new Function()`").
That covers queries, mutations, V8 actions, schema evaluation, and push-time analysis. So:

- `z.compile()` / `import "zod/compile"` **can never speed up Convex functions** (only
  `"use node"` actions could use it).
- It fails **gracefully**: zod probes `new Function` inside try/catch (`allowsEval`), and the
  global-compile shim catches `ZodCompileUnsupportedError` and permanently restores the runtime
  parser per schema. No crash — just zero benefit.
- A user who cargo-cults `import "zod/compile"` into `convex/` pays ~34 kB min of dead compiler
  (side-effect import, not shaken) for nothing. Worth a docs note once we recommend 4.5.
- On the **client** (React/browser), `z.compile()` is usable and real — but CSP-restricted apps
  need `jitless`, and the parse speedups matter less at frontend data volumes. Optional, user's
  call, nothing for zodvex to wire.

## 5. Compatibility: zodvex passes on 4.5.4 today, unchanged

- Full suite: **2174 tests / 154 files pass** against zod 4.5.4 (workspace override, no source
  changes). `bun run type-check` clean.
- Peer range `zod: ^4.3.6` already admits 4.5.x. Examples pin `4.3.6` exact and would need a bump
  to participate in a 4.5 sweep.
- The 4.5 breaking changes are *user-schema-visible*, not mapping-visible: code-point string
  lengths, seconds-required `z.iso.datetime()`, stricter format validators, record-key semantics.
  None affect zod→Convex validator mapping; they change which runtime *values* pass validation in
  consumer apps. Release comms should point users at Zod's own 4.5 changelog.

## 6. What this means for the open perf PRs

- **#84 (dynamic-import isolate-memory validation)** — findings stay valid; the constants shift.
  Runtime per-model cost drops ~0.3 MB → ~40 kB, so the "K models touched per endpoint" ceiling
  moves from ~150–200 to >1000 — even further past anything a real endpoint does.
- **#80 (codegen overhaul / codec-paths descriptors)** — the OOM cliff it was built to avoid
  becomes far less binding (~141 → ~1000 models territory). It still wins on what 4.5 does *not*
  fix: zero zod in the schema isolate, ~bytes-per-table descriptors, deploy bundle bytes, and the
  TooManyReads wall is Convex's, not zod's. But its *urgency* drops for every app under several
  hundred tables. Before investing further, re-run the sweep on 4.5.4 — the before/after gap that
  justified the descriptor architecture needs re-measuring on the new baseline.
- **#63 (zodvex compile / compile-away)** — remains the only lever that removes zod's *bundle
  bytes* from the push (and 4.5 makes raw-zod bundles ~8% bigger, so the byte gap widens in
  compile's favor), but its memory-ceiling advantage (2000 vs 141) shrinks substantially. Its
  strongest remaining pitch is bundle parity + Convex-native output, not OOM avoidance. Note the
  name collision: once users can read "compile" as `z.compile()`, `zodvex compile` docs should
  disambiguate (build-time source transform vs runtime JIT).
- **#51 / #45 (codegen discovery/ergonomics)** — unaffected; orthogonal to the size question.

## 7. Recommended sequence

1. **Bump the dev/example pins to 4.5.4 on a branch and run the full stress sweep** (deploy
   parity gate + manual `sweep` ceilings). This re-baselines every number the perf roadmap is
   built on. Cheap, high information.
2. Widen testing/CI to cover 4.5.x explicitly (peer range already allows it); consider a CI leg
   that runs the suite on both the pin and `latest`.
3. Re-evaluate #80's merge urgency against the new sweep numbers; keep the descriptor design (it
   still owns the >800-table story and codec-args minimality) but the beta-gate calculus changes.
4. Keep #63 framed as a bundle-bytes/parity feature. Skip any integration of `z.compile()`
   server-side (dead by runtime flag); at most a docs warning not to import `zod/compile` in
   `convex/`.
5. `z.validate()` could serve as a cheap fast-path for `returns` validation where we currently
   pay full parse without using the output — worth a look, not urgent.

## Appendix: methodology

- Bundles: `esbuild --bundle [--minify] --format=esm` over entries `export * from 'zod'` (worst
  case ≈ Convex deploy reality), `zod/mini`, and a small tree-shaken consumer. Versions installed
  side by side via npm aliases (`zod44@npm:zod@4.4.3`, etc.).
- Memory: Node 22 `--expose-gc`, double-GC before/after constructing 300 models / 5000 bare
  strings, heap delta ÷ N. Construction time: `performance.now()` over 500 models.
- Convex runtime flag: read from a shallow sparse clone of `get-convex/convex-backend`
  (`crates/isolate/src/client.rs`, V8 init args).
- zodvex suite on 4.5.4: temporary root `overrides: { "zod": "4.5.4" }`, `bun install`,
  `bun run test` + `bun run type-check` (override not committed).
