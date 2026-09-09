# Memory history inventory — 2026-09-09

This source inventory preceded the new experiments in the
[retrospective](README.md). Main was verified at
`ad4a23241b7a351e2406fe555283f9e81591139a` (2026-09-09, package 0.7.10).
The inventory itself made no historical backend runs; the retrospective records
the subsequently completed pre/post-fix binary experiment and Zod/slim study.

## Original report and platform change

- [Zodvex issue 49](https://github.com/panzacoder/zodvex/issues/49) opened
  **2026-03-24 18:42:43 UTC**. It reports a production deployment blocked by
  Zod-v4 OOM and asks about Zod 3; it does not identify the customer's exact
  Zodvex version or deployed backend revision. Its author later reported moving
  off Zodvex and simplifying schemas for Zod 3. Do not equate today's customer
  schema with that original graph without an archived revision.
- [Convex issue 414](https://github.com/get-convex/convex-backend/issues/414)
  opened March 23. The original upstream reporter identified Convex **1.34.0**,
  helpers **0.1.114**, Zod **4.2.1 failing / 3.25.76 passing**. This is a
  separate reporter's dependency set, not an exact version manifest for issue 49.
- On [April 2](https://github.com/get-convex/convex-backend/issues/414#issuecomment-4175086650),
  a Convex maintainer confirmed that deployment analysis loaded all modules
  together under the ordinary 64-MiB function limit.
- The exact code change is
  [`a79bb12d7b51f2d7b92ac2792698a6aa212cf8cd`](https://github.com/get-convex/convex-backend/commit/a79bb12d7b51f2d7b92ac2792698a6aa212cf8cd),
  **April 24 22:52:51 UTC**, “Analyze one user module at a time.” Its parent is
  `a3b7db028a7eaf83a4311bb69a5c2cc68592e184`. The patch replaces the one
  Analyze request iterating all user modules with one request per module, with
  `ANALYZE_CONCURRENCY=4`. The heap limit remains 64 MiB. Schema evaluation is
  not the operation changed by this patch.
- The maintainer [announced the rollout April 27](https://github.com/get-convex/convex-backend/issues/414#issuecomment-4331171568),
  explicitly allowing several days for deployment everywhere and noting that
  one large entrypoint can still exceed memory. Thus public commit date is not
  proof of the backend revision serving a particular customer on that date.

## Shipped Zodvex changes and exact checkpoints

All four merged changes below are ancestors of current main, verified locally.

| Change | Exact before → after | Status and interpretation |
|---|---|---|
| Mini support, codemod, source reorganization ([#52](https://github.com/panzacoder/zodvex/pull/52), merged April 8) | `4fc60f2784db3482f22b100a78f6a891432306ba` → `561336c69654176bbb36370be2ed1d37556830af` | Already on main. The parent is the earlier 0.7.0/Mini release (#54), so this merge is not a clean “no Mini → Mini” causal experiment. Compare Full/Mini under one fixed build instead. Historical ~155/~365 endpoint numbers belong to older fixtures/deployment behavior. |
| Convex-validator WeakMap memoization ([#55](https://github.com/panzacoder/zodvex/pull/55), merged April 9) | `561336c69654176bbb36370be2ed1d37556830af` → `1b567bf64af48f3357c2a3b63629a2b414259d54` | Already on main. The historical experiment reported no measurable OOM-ceiling change. Shared-schema versus independent-schema fixture matters. A separate investigated lazy-getter implementation was net-negative and was not the adopted solution. |
| True slim models, reduced table map, shared cached helpers ([#57](https://github.com/panzacoder/zodvex/pull/57), merged April 21) | `1b567bf64af48f3357c2a3b63629a2b414259d54` → `99e4675e4079c55da860e203202e780ca3f5c858` | Already on main; package 0.7.1-beta.16 → beta.18. Opt-in `schemaHelpers:false` avoids the full eager helper bundle; map reduced from six fields to doc/insert; zx helpers use stable shared WeakMap caches. These are multiple changes, so merge A/B measures the combined package change. |
| Zod 4.5.4 baseline ([#121](https://github.com/panzacoder/zodvex/pull/121), merged September 8 UTC) | `4738e84bc902e425bb04066f139d95fd4c371660` → `de99ed249f9eeea2881add2b21a5d46ed33d130d` | Already on main. Same Zodvex version 0.7.8-beta.0; lock changes Zod 4.3.6 → 4.5.4 only. Existing local Node corpus measured construction/retained memory, not Convex capacity or codec-heavy model memory. No `z.compile` behavior was added. |

The lockfiles at #52/#55/#57 and v0.7.1/v0.7.5 all resolve Convex **1.32.0**,
helpers **0.1.113**, and Zod **4.3.6**. Current main resolves the same
Convex/helpers with Zod **4.5.4**. Package version alone is inadequate for
same-version branch builds; preserve the built-JavaScript digest.

The #57 internal changes also have recoverable anchors:

- `2d9dab114b858b6a77a60e717da8078311e31cb2` →
  [`c6a081236a2e9c41bb757940524f668dd09c81c8`](https://github.com/panzacoder/zodvex/commit/c6a081236a2e9c41bb757940524f668dd09c81c8)
  changes **both** true slim shape and table-map construction. It is not a
  table-map-only experiment.
- `760c0b9a2c5c3a5b560705d938706873c19dfb4d` →
  [`d63458c72d84ad7e589cd8c118641e38d045b4ce`](https://github.com/panzacoder/zodvex/commit/d63458c72d84ad7e589cd8c118641e38d045b4ce)
  isolates the zx runtime file's stable cache keys/full-model reuse, but bundles
  two cache changes. A fixture must actually repeat helper access and chain model
  methods to exercise the claimed benefit.
- `d653214df9b8df195352715f63f93a543730be48` →
  [`addd20c4662623a678c442e3866b99d42df5bbb4`](https://github.com/panzacoder/zodvex/commit/addd20c4662623a678c442e3866b99d42df5bbb4)
  introduces cross-bundle cache sharing. A single flattened bundle is an
  inadequate test of a duplication bug between multiple runtime bundles.

## Parked experiments: do not treat them as main

- [#60](https://github.com/panzacoder/zodvex/pull/60), opened April 24, closed
  **unmerged May 19**, head `98c53d2394937650f11e3d2b8ec3439c21b5e6ed`:
  proposed per-request argument ZodObjects, deferred table-map entries and async
  registry thunks. Some archived writeups incorrectly say the async registry
  behavior was already merged. Current main accepts synchronous
  `registry?: () => AnyRegistry` and directly calls it; it eagerly populates
  doc/insert at `defineZodSchema`, including cached zx.doc/base for slim models.
  Main's #57 “lazy table map” label means fewer derived schemas, not fully lazy
  per-table initialization.
- [#80](https://github.com/panzacoder/zodvex/pull/80), opened June 12,
  **open/unmerged**, current head `cfc06b6ac02a1104e0b7e0de7283e510c9abeb06`:
  pure-Convex generated tables, minimal codec-path model descriptors, split
  registries, migration and subsequent semantics fixes. Package 0.8.0-beta.0;
  its lock resolves **Convex 1.41.0 / helpers 0.1.119 / Zod 4.3.6**. Comparing
  this branch against main without controlling dependencies and semantics would
  confound many changes. June experiments were rebased in August; distinguish
  authored dates from commit dates and use immutable hashes.
- [#81](https://github.com/panzacoder/zodvex/pull/81), opened June 12, merged
  **August 13** as `1b1245191491c5478616a3d6f74e6d8b7810de11`: the old
  shape-aware deployment harness, not the descriptor architecture. Its final
  head was `c4a303927acb85739fff561e9d8ffdd18ba34e68`. Historical outputs remain
  evidence even as PR142 retires the old executable harness.
- [#84](https://github.com/panzacoder/zodvex/pull/84), opened June 19,
  **open/unmerged**, head `284e1e54af73c6932b01041b4c4f0850bac431b8`:
  dynamic-import experiments on V8 **actions**, standing in for queries and
  mutations. This is not evidence that Q/M dynamic import is supported. Its
  branch includes substantial #80 ancestry, not one isolated runtime change.
- [#63](https://github.com/panzacoder/zodvex/pull/63), opened April 26,
  **open draft**, head `0e4ae596420619d86c13534d085526a1662643af`: endpoint
  compile-away. Keep parked while measuring the current behavior.

## Historical results that need explicit caveats

1. April's “ceiling” reports include Node heap-budget proxies, and the later
   harness changed its generated corpus and model/endpoint relationship. They
   are not interchangeable with repeated actual Convex failures.
2. May 13's inference that aggregate module analysis persisted was later
   corrected: heavy generated api.js/client.js files were analyzed as their own
   entrypoints. The multi-dot filename experiment and later convex.config marker
   changed discovery/import topology.
3. The May 14 runtime finding explicitly invalidated deploy-only “success” for
   dynamic table-map imports: query/mutation codec calls failed at runtime.
4. June 12 identified a further confound: the favorable harness used
   `wrapDb:false`, a stub map and no registry, bypassing the all-model consumer
   server module. It did not establish usable codec-enabled scale.
5. Zod's [4.5 release](https://github.com/colinhacks/zod/releases/tag/v4.5.0)
   (August 28; [4.5.4](https://github.com/colinhacks/zod/releases/tag/v4.5.4)
   August 29) changed allocation of bound methods. Upstream's memory comparison
   used **4.4.3**, whereas the repository's controlled baseline used **4.3.6**.
   Both are useful exact versions; neither substitutes for the original 4.2.1
   report or proves arbitrary schema compatibility.

Relevant archived documents in the PR81 snapshot:
[multi-dot correction](https://github.com/panzacoder/zodvex/blob/1b1245191491c5478616a3d6f74e6d8b7810de11/examples/stress-test/results/archive/multi-dot-rename-2026-05-13.md),
[dynamic-import runtime failure](https://github.com/panzacoder/zodvex/blob/1b1245191491c5478616a3d6f74e6d8b7810de11/examples/stress-test/results/dynamic-import-runtime-finding-2026-05-14.md),
[consumer-shape correction](https://github.com/panzacoder/zodvex/blob/1b1245191491c5478616a3d6f74e6d8b7810de11/examples/stress-test/results/server-ts-shape-findings-2026-06-12.md).

## Bounded comparison order

| Priority | Hold fixed | Change | What it answers |
|---|---|---|---|
| 1 | Current built Zodvex; same actual local Convex binary/flags; same codec-rich count/width and zero control; three independent collections | Zod 4.3.6 vs 4.5.4 | Dependency effect on real retained model-graph bytes |
| 2 | The same design, same dependencies per cell | schemaHelpers on/off in an explicitly named copied fixture | Remaining value of already-shipped slim models, and interaction with Zod's reduction |
| 3, only if still useful | Same dependencies/backend and semantic fixture | #57 parent vs merge | Combined historical slim/map/cache effect; label as combined, not table-map-only |
| 4, separate deployment experiment | One fixed multi-module application/CLI/dependency set | Pre/post Convex analyzer change | Original aggregate-analysis failure versus per-entrypoint behavior |

Start priority 1/2 at count 16 or 32, not 128: old Zod may exhaust memory before
producing retained readings. Preserve Full/Mini and native/helpers controls,
zero/target matching, three repetitions, raw integer bytes and exact bundle/build
digests. Do not weaken the existing same-dependency comparator to turn an
intentional dependency experiment into an ordinary library regression result.

## Older Convex is practically available

An official [March 24 release](https://github.com/get-convex/convex-backend/releases/tag/precompiled-2026-03-24-8106a69)
exists, source `8106a69abeecfe8acb1c3199d9164a363e727264`, published
17:35:53 UTC, about an hour before issue49. It offers macOS ARM64/x64 and Linux
ARM64/x64 binaries. The macOS ARM64 zip is 46,529,261 bytes, SHA-256
`30f6ee537231f65884911302d7ce9dd2435f96185f673929728a61c2efaea073`.
This is a plausible period backend, not proof it was serving the customer's app.

There is also a [pre-fix binary at the exact parent](https://github.com/get-convex/convex-backend/releases/tag/precompiled-2026-04-24-a3b7db0),
and a [post-fix April 27 binary](https://github.com/get-convex/convex-backend/releases/tag/precompiled-2026-04-27-b603022)
at `b603022073aefa3eb8ec96802e8bf0ae5c8d7527`, verified to descend from the fix
by 12 commits. Both offer macOS ARM64 binaries. The post-fix binary therefore
includes other intervening changes; exact-parent/exact-fix source builds would
isolate the patch more closely but are unnecessary for initial reproduction.

The March source already exposes `/api/run_test_function`, fresh-isolate and
64-MiB heap knobs. Its [build instructions](https://github.com/get-convex/convex-backend/blob/8106a69abeecfe8acb1c3199d9164a363e727264/BUILD.md)
pin Rust/Node tooling and support a local backend. Binary/API/GC-diagnostic
compatibility has not been tested. Reproduce the aggregate deployment bug through
the actual multi-module push/analyze path; a single flattened one-off graph does
not exercise the changed analysis scheduling. Use distinct fresh backend data
directories and the historical CLI where required. No old binary was downloaded
and no historical Rust build was attempted for this inventory.
