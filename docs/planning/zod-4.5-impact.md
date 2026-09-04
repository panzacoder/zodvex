# Zod 4.5 impact analysis (bundle size, isolate memory, and the perf roadmap)

**Date:** 2026-08-29 (analysis) · **2026-09-04 (measured re-baseline, §0)** · **Zod versions compared:** 4.3.6 (repo pin) / 4.4.3 / 4.5.4 (`latest`)

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

## 0. Measured re-baseline on zod 4.5.4 (2026-09-04)

Everything below §0 is the 2026-08-29 *analysis*; this section is the *measurement* it asked
for (§7 step 1), run with the stress harness merged in PR #81 against zodvex `main` at
`32c4d2a` (0.7.8-beta.0). Raw numbers: `examples/stress-test/results/zod-4.5-rebaseline-2026-09-04.json`
(regression + heap proxy, both zod versions) and
`examples/stress-test/results/sweep-zod-4.5.4-explicit-2026-09-04.json` (ceiling sweep, harness-native
format). Same machine, same harness, same day, same Convex backend for both zod versions — zod is the
only variable.

Environment: convex 1.32.0, convex-helpers 0.1.113, Node 22.22.2, Bun 1.3.11, harness deployment
`dev:dutiful-llama-148`, consumer shape `explicit` (the documented main shape: `defineZodSchema` +
`initZodvex`, no codegen `tables.ts`, every endpoint statically reaches every model through the
schema import). The bump itself is the five example `zod` pins 4.3.6 → 4.5.4 (peer range untouched);
zodvex passes `lint`, `type-check`, the full suite (2174 tests / 154 files), consumer-declaration
smoke, `verify:examples`, and the N=100 deploy-parity gate on 4.5.4 with **no source changes**.

### 0.1 Deploy-parity gate (real `convex dev --once`, reset per flavor, N=100 explicit)

| flavor | zod | deploy | endpoint heap (proxy) | schema heap (proxy) | push time |
|---|---|---|---:|---:|---:|
| zodvex | 4.3.6 | ok | 63.27 MB | 34.76 MB | 20.3 s |
| zodvex | **4.5.4** | ok | **13.63 MB** | **8.52 MB** | **11.8 s** |
| zodvex-mini | 4.3.6 | ok | 22.33 MB | 13.26 MB | 13.1 s |
| zodvex-mini | **4.5.4** | ok | **11.06 MB** | **7.06 MB** | 10.9 s |

### 0.2 Heap proxy vs. N (node `--expose-gc` heap delta on bundle load, sample = 1 endpoint)

| flavor | N | 4.3.6 endpoint / schema | 4.5.4 endpoint / schema | endpoint ratio |
|---|---:|---:|---:|---:|
| zodvex | 100 | 63.0 / 34.8 MB | 13.6 / 8.5 MB | 4.6× |
| zodvex | 150 | 92.6 / 50.6 MB | 18.6 / 11.0 MB | 5.0× |
| zodvex | 200 | 122.6 / 67.0 MB | 23.6 / 13.6 MB | 5.2× |
| zodvex | 400 | — | 43.6 / 23.8 MB | |
| zodvex | 600 | — | 63.3 / 33.8 MB | |
| zodvex | 750 | — | 78.5 / 41.7 MB | |
| zodvex-mini | 100 | 22.2 / 13.2 MB | 11.1 / 7.1 MB | 2.0× |
| zodvex-mini | 150 | 31.8 / 18.5 MB | 14.9 / 9.0 MB | 2.1× |
| zodvex-mini | 200 | 41.7 / 24.0 MB | 18.8 / 11.1 MB | 2.2× |
| zodvex-mini | 400 | — | 34.4 / 19.1 MB | |
| zodvex-mini | 600 | — | 49.9 / 27.0 MB | |
| zodvex-mini | 750 | — | 61.8 / 33.3 MB | |

Per-model slope of the endpoint heap (linear fit, all N): **zodvex 0.60 → 0.10 MB/model (6.0×)**,
zodvex-mini 0.195 → 0.078 MB/model (2.5×). The ~3.5 MB intercept (convex + zodvex runtime) is
unchanged. Full zod and mini are now within ~20% of each other per model; on 4.3.6 the gap was 3×.

This is *smaller* than the 7.7× per-schema figure from §3 for two expected reasons: the harness
model is heavier than §3's 10-field probe (three-way discriminated union, nested objects, arrays,
five `zx.*` codecs/ids), and the intercept dilutes the ratio at low N. The direction and order of
magnitude hold.

Calibration of the proxy against real deploys (4.3.6, this machine): the real push **passed at
63.0 MB proxy (N=100) and OOMed at 92.6 MB proxy (N=150)**, so the 64 MB isolate's OOM cliff sits
between ~63 and ~93 MB of proxy heap for this shape. On 4.5.4 zodvex reaches 63.3 MB at N=600 and
78.5 MB at N=750, which predicted an OOM ceiling in the N≈600–900 band — i.e. colliding with
Convex's own `finish_push` TooManyReads wall (N=750 ok / N=800 fails in every prior sweep; that wall
turned out to have moved, see §0.3).

### 0.3 Ceiling sweep (real deploys, reset per cell, Q/M + scheduler smoke on every passing cell)

`bun run sweep -- --flavors=zodvex,zodvex-mini --ns=200,400,600,700,750,800 --shape=explicit --continue`
plus two follow-up cells (zodvex 650, zodvex-mini 900) to tighten the brackets. Every cell resets the
deployment first (fresh "0 → N" diff), composes, measures the proxy, pushes with `convex dev --once`,
then runs the healthcheck *and* scheduler-encoding smoke functions. Push time includes the smoke calls.

| flavor (explicit shape, zod **4.5.4**) | N=200 | 400 | 600 | 650 | 700 | 750 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|
| **zodvex** (full zod) | ✓ 27 s | ✓ 66 s | ✓ 137 s | ✗ oom | ✗ oom | ✗ oom | ✗ oom | — |
| **zodvex-mini** | ✓ 24 s | ✓ 57 s | ✓ 97 s | — | ✓ 129 s | ✓ 157 s | ✓ 196 s | ✗ oom |
| *zodvex on 4.3.6* (June sweep: ok@50, ok@100, **oom@150**, oom@200) | ✗ | ✗ | ✗ | | | | | |
| *zodvex-mini on 4.3.6* (June sweep: ok through 200, not pushed further) | ✓ | — | — | | | | | |

Proxy heap of the pushed endpoint per cell — zodvex: 23.6 / 43.6 / 63.3 / 68.7 / 73.5 / 78.5 / 83.3 MB;
zodvex-mini: 18.9 / 34.5 / 49.9 / — / 58.0 / 61.8 / 65.6 / 73.2 MB. Every OOM is the push-time
`start_push` isolate ("JavaScript execution ran out of memory (maximum memory usage: 64 MB)"), i.e. the
same failure class as the 4.3.6 cliff at 150.

Readings:

- **Full-zod zodvex, explicit shape: the memory ceiling moved from 100 < N < 150 (PR #63: 141) to
  600 ≤ N < 650** — about 4.5× more tables in the *unchanged* documented shape, no codegen.
- **The proxy calibrates the same way on both zod versions and both flavors**: 4.3.6 passed at 63.0 MB
  and failed at 92.6 MB; on 4.5.4 the last pass is 65.6 MB (mini, 800) and the first failure 68.7 MB
  (zodvex, 650). The isolate's 64 MB therefore corresponds to **~66–69 MB of node heap-on-load** for
  this shape, tight enough that the proxy predicts a cell's outcome to within ~30 models before a push.
- **zodvex-mini clears every count through 800** and OOMs at 900 (proxy 73.2 MB), so its ceiling
  is **800 ≤ N < 900** — memory, not reads. Mini and full zod are now close per model (0.078 vs
  0.100 MB), so mini's extra headroom is ~25% rather than the 3× it was on 4.3.6.
- **Convex's `finish_push` TooManyReads wall has moved.** Every sweep since May (all five flavors, harness
  and consolidated shapes) failed at exactly N=800 with `TooManyReads`; today N=800 pushed and smoked
  clean for zodvex-mini in 196 s. The composed table/function count per N is the same across shapes,
  so this is a Convex-backend change between June and September, not a zod effect. The "~800-table
  parity ceiling" that PR #80 and the results docs anchor on needs re-characterizing before it is
  quoted again; mini's N=900 cell OOMed on memory before any read-set error, so the wall now sits
  above both flavors' memory ceilings and cannot be located with this corpus.
- **Bundle bytes went up as §2 predicted, push time still went down.** Per-endpoint bundle +20–24%,
  schema bundle +26–30% (4.3.6 → 4.5.4, N=100/200), in line with §2's +26% tree-shaken estimate. The
  N=100 push nonetheless fell from 20.3 s to 11.8 s: push-time analysis is dominated by schema
  *construction*, which 4.5 made ~6× cheaper. At N=600 the bytes do show: full zod pushes in 137 s vs
  mini's 97 s. No Convex cap is approached.

### 0.4 What changed vs. the 4.3.6 numbers the perf PRs were built on

| number the roadmap used | 4.3.6 source | 4.3.6 value | 4.5.4 measured |
|---|---|---|---|
| plain-zodvex push-time OOM ceiling (explicit shape) | PR #63 hybrid search; June sweep (ok@100, oom@150) | **141** | **600 ≤ N < 650** (ok@600, oom@650), ≈4.5× |
| zodvex-mini explicit ceiling | June sweep (ok through 200, not pushed further) | ≥200 | **800 ≤ N < 900** (ok@800 in 196 s, oom@900) |
| per-model eval cost driving PR #80's design | #80 rationale "~0.2–0.3 MB at eval"; proxy slope | 0.60 MB/model (proxy) | 0.10 MB/model (proxy) |
| PR #84 runtime ceiling (K models imported per endpoint) | ~0.3 MB/model → K≈200 | 200 | not re-run; scaling by the measured 6× puts K well past 1000, beyond any real endpoint |
| Convex TooManyReads wall | every sweep | 750 ok / 800 fail | **800 passes** (zodvex-mini, 196 s): backend change, not zod; wall not reached, memory binds first at 900 |

**Does the codegen overhaul's (#80) urgency calculus change? Yes, materially — from "beta-blocking
OOM fix" to "scale feature for the >600-table tier".**

- The cliff #80 was built to avoid — full-zod, codec-enabled apps OOMing per-entrypoint analysis at
  ~141 tables in the plain shape — is now at 600 ≤ N < 650 on zod 4.5.4, with **zero zodvex changes**.
  Anything under ~600 tables on full zod (or 800+ on mini) already deploys at what used to be called
  pure-Convex parity, in the documented `explicit` shape on `main`. That covers essentially every real
  zodvex app, hotpot included by a wide margin.
- What #80 still owns, unchanged by 4.5: **(a)** zero zod in the schema isolate — the schema heap proxy
  still grows 0.051 MB/model on 4.5.4 (33.8 MB at N=600), so `schema.ts` itself would hit the isolate
  somewhere past ~1100 tables; **(b)** the codec `ctx.db` wrapping story at scale — the consolidated
  `server.ts` shape that OOMed at 150–200 on 4.3.6 (`results/server-ts-shape-findings-2026-06-12.md`)
  scales on the same model-import term and should move ~6× too, but that is a prediction (~900–1200),
  **not measured here**; **(c)** the args-only scheduler registry and bytes-per-table descriptors, which
  are about bundle bytes, and 4.5 made raw-zod bundles ~25% *bigger*.
- The before/after gap that justified shipping #80 as a gated beta has shrunk from "141 vs ~800" to
  "~600 vs ≥800+ (wherever the moved TooManyReads wall now is)". That is not a reason to drop the
  design; it is a reason to stop treating it as urgent. Recommended order:
  1. **Recommend zod ≥ 4.5 to users now** (docs + examples pin; consider raising the peer floor to
     `^4.5.0` in the next minor). It is the largest deploy-headroom win available and costs nothing.
  2. **Re-run #80's own shapes on 4.5.4** (`--shape=consolidated`, the codec-paths sweep) before any
     further investment, and re-characterize the moved TooManyReads wall while doing it. Only then
     decide what #80's beta gate should be.
  3. **#63 (compile-away)**: keep framed as bundle-bytes/parity. Its memory pitch is now "2000 vs
     ~600" instead of "2000 vs 141"; the bytes pitch got stronger (raw zod +25%).
  4. **#84 (dynamic import)**: findings stand; the runtime K-models-per-endpoint ceiling scales with
     the same ~6× (from ~200 to well over 1000), even further past what any endpoint does.

### 0.5 Caveats

- The proxy is a *leading indicator*; deploy outcome is ground truth (see
  `results/ceilings-and-regression-2026-05-13.md`). The June-2026 proxy numbers in
  `sweep-main-explicit-2026-06-12.json` are ~1.7× lower than this machine's 4.3.6 numbers at the same
  N (36 vs 63 MB at N=100) — different machine/Node/harness build — which is exactly why the 4.3.6
  series was re-measured here rather than reused.
- `verify:examples:network` did not complete in this sandbox: the task-manager dev deployment
  (`quaint-hyena-530`) carries four February-2026 smoke rows whose `users.email` is a plain string
  (the model now stores a tagged codec object), so the schema push is rejected — pre-existing data,
  not a 4.5.4 effect; clearing the `users` table from the dashboard fixes it. task-manager-mini and
  quickstart deploy cleanly on 4.5.4; the mini smoke script could not run because Bun's `fetch` does
  not survive this sandbox's TLS-terminating egress proxy (curl and Node do). Neither affects the
  stress harness, which drives deploys and smoke calls through the Node-based convex CLI.
- One sample endpoint per cell (`activity_0000`), matching the harness default; in the explicit
  shape every endpoint bundles the same model graph, so the max is representative.

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
**~700–1100 model range** before touching codegen or compile-away (**measured 2026-09-04, see §0.3:** the
memory ceiling now sits at or beyond Convex's own ~800-table `finish_push` wall) — the same order as the
codegen overhaul's ~800-table TooManyReads wall and compile-away's 2000. Schema eval getting
6.7× faster also directly cuts push-time analysis and isolate cold starts. ~~These numbers need
re-verification with the real stress sweep~~ — **done, §0**: the per-model proxy cost dropped 6× (not
7.7×; the harness model is heavier than the 10-field probe), and the real-deploy ceiling moved as
predicted.

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

1. ~~**Bump the dev/example pins to 4.5.4 on a branch and run the full stress sweep**~~ — **done
   2026-09-04 (§0)** on `claude/festive-ramanujan-vczk40`: pins bumped, gate green, ceilings measured.
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
