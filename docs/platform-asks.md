# Platform asks ledger — what Convex could ship to simplify zodvex

Living document (started 2026-06-13). For each ask: why we want it (what we're
doing that creates the desire), what it might look like from Convex, our
current workaround, and **what dissolves** if they ship it. Channel: the Ian
Macartney thread (see `examples/stress-test/results/ian-draft-2026-06-12.md`,
unsent draft) — the #414 → per-entrypoint-analysis episode shows asks with
measurements attached get acted on.

---

## 1. Dynamic `import()` in the default (V8) runtime

- **Why we want it:** codec decode/encode needs per-table schema info wherever
  `ctx.db` runs; with no runtime loading, "available everywhere" forces static
  imports, which is the root of the entire memory saga
  (`results/where-we-sit-2026-06-12.md`).
- **Convex-side shape:** full `import()` resolving from the deployed module
  set, or a narrower deterministic `loadModule(specifier)` (content-addressed
  within a deployment version, cached after first load). Determinism is
  preserved — module content is immutable per deploy.
- **Workaround today:** codec-paths descriptors (`_zodvex/models/*`,
  ~0.04 MB/table) + lazy full registry confined to actions (Node runtime).
- **Dissolves:** the descriptor minimality requirement (could lazy-load full
  models per table touched); the action/mutation registry split
  (`schedulerRegistry` + args-only `api.args.js`); most of codegen's
  weight-management emission. Descriptors could remain as a perf nicety.

## 2. A build-time transform hook (esbuild plugin / sanctioned source transform)

> **Upgraded 2026-06-15 — this is the biggest ask, not a minor one.** Its
> headline motivation is **compile-away** — the full design sketch lives as a
> comment on PR #63 (the compile-away PR), kept out of the codec-paths branch
> to avoid muddying its scope:
> https://github.com/panzacoder/zodvex/pull/63#issuecomment-4721524273
> Earlier this was tallied as a small "lets tooling do more itself"
> convenience; that undersold it, because against the *shipped* codec-paths
> solution a bundle hook buys little (codec-paths is pure codegen + static
> imports). Against **compile-away** it's the enabling primitive.

- **Why we want it:** the clean version of compile-away runs zodvex's
  zod→(convex-values + pure-JS codec class) transform *inside Convex's own
  bundle step*, so the user keeps authoring normal zodvex code in `convex/`
  and the deployed output is idiomatic Convex with **zero zod at runtime**.
  Without a hook, the only way to deploy a transformed tree is to emit a
  parallel/shadow source tree and point Convex at it — the file-resolution
  hijack that got PR #63 rejected ("changes what zodvex *is*"). The plugin is
  precisely what removes that objection: transform, not hijack.
- **Convex-side shape:** an esbuild plugin hook, or a narrower sanctioned
  "source transform for files matching X" / "validator-compiler" interface in
  `convex.json`. (Narrower is likely more palatable — a full esbuild plugin is
  a bigger API-stability + support-surface + trust commitment for them, and
  the deployed≠authored divergence shows up on *their* dashboard, so source
  maps matter.) Secondary uses: zod→zod/mini as a build alias instead of the
  `zod-to-mini` codemod; injecting codegen output without user import wiring.
- **Workaround today:** codec-paths runtime layer (`_zodvex/models/*`
  descriptors + the wrapped `ctx.db`) — already at pure-convex deploy parity,
  so this is *not* blocking. Plus generated-file wiring conventions,
  bootstrap stubs, and `zodvex migrate` codemods that rewrite user source.
- **Dissolves (maximal — more than any other ask):** the entire runtime zod
  layer. No zod in any isolate ever, double-validation gone (CPU win, not just
  memory), `ZodvexDatabaseReader/Writer` and the descriptor/registry/tableMap
  machinery all become build-time artifacts. Note the convergence: the
  discovery layer (`walkModelCodecPaths`) and the `table → codec` map built
  for codec-paths are the **front half** of compile-away — the same
  information, emitted as pure-JS codec classes instead of consumed by a
  runtime wrapper. Nothing from the codec-paths work is wasted.
- **Dependency reality:** 100% gated on Convex shipping the hook — not
  shippable library-side, unlike codec-paths. Endgame bet, not near-term.

## 3. Replace convex-values validation with zod at runtime

- **Why we want it:** today every boundary validates twice — zodvex runs the
  zod pipeline (decode + validation), then Convex re-validates against the
  pushed `v.*` validators (args, returns, schema-on-write). The whole
  `zodToConvex` mapping layer exists to keep two validator systems in sync.
- **Convex-side shape:** realistically a deep API — a pluggable
  function-boundary validator interface, or accepting a precompiled validator
  IR. Honest scoping: Convex's validators are also a *backend* security/schema
  enforcement concept (they run server-side against untrusted input and gate
  DB writes); zod could plausibly replace the **function-boundary
  re-validation** in the isolate, but schema enforcement at the storage layer
  stays Convex's. Jake's note: this is fork-or-deep-API territory — a whole
  different thing. Parked, but tallied.
- **Workaround today:** `zodvex compile`-style thinking is dead; we ship the
  mapping layer (`mapping/`, `zodToConvex`), wire-validator emission in
  codegen (`tables.ts`, `api.js`), and eat the double validation cost.
- **Dissolves:** the mapping layer and its optional/nullable semantics
  preservation machinery; double validation CPU; the entire class of
  "wire validator drift" bugs; much of `zodToSource`.

## 4. A declared "shared module" tier with its own memory budget

- **Why we want it:** the unified schema/registry is logically
  once-per-deployment data, but the per-entrypoint analysis model charges it
  to every endpoint's 64 MB isolate — the 150-model cliff.
- **Convex-side shape:** tag a module (or chunk) as shared: evaluated once per
  deployment (or given a separate budget), its exports importable from any
  entrypoint without counting against per-entry analysis. A close variant
  that's purely an implementation change: **evaluate identical `_deps` chunks
  once across entrypoint isolates** — the model graph is byte-identical in
  every endpoint bundle.
- **Workaround today:** make the shared thing weigh nothing — `tables.ts`
  (zod-free schema isolate) + codec-paths descriptors (bytes/table) + args-only
  scheduler registry.
- **Dissolves:** codec-paths' reason to exist (full-fidelity central registry
  becomes affordable again); the args-only registry split; the loose-zod vs
  path-walker tradeoff.

## 5. Smaller / already-shipped (tracking that the channel works)

- **Per-entrypoint analysis** (shipped ~Apr 2026, closed #414): removed the
  whole-app OOM class. Created the per-endpoint multiplier this ledger is
  mostly about — worth saying both halves to Convex.
- **`ctx.meta.getTransactionMetrics()`** (1.36): adopting in harness Phase 0 —
  turns the TooManyReads wall into a measured gradient. Ask variant: expose
  the same at push/analysis time (per-entry memory headroom in `--verbose`
  output) so libraries can see how close to the 64 MB cap they run without
  OOM-bisecting.
- **`db.get(table, id)` migration + BYO-ID direction**: enables our
  string-first API decision; our ask is only that ID-first deprecation
  timelines stay loud, since our wrapper tracks them.
- **AsyncLocalStorage in the V8 runtime** (1.39): potential future carrier for
  rules/audit context — limited by not threading through `ctx.run*` calls;
  an ask variant is ALS propagation across those boundaries.
- **Function manifest without execution**: zodvex discovery dynamic-imports
  user modules to read function metadata (fragile — RFC #51); a supported
  build-time manifest (a richer `function-spec` that runs pre-deploy and
  includes module → export → validator JSON) would let discovery stop
  executing user code. Workaround: runtime discovery + bootstrap stubs.

---

**Maintenance:** when an ask ships, move it to §5 with the adoption note and
delete the workaround it dissolves. When we add a workaround anywhere in
zodvex, add its ask here first — the ledger is also our map of what we can
delete later.
