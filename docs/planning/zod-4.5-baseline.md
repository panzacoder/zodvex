# Zod 4.5.4 baseline

This baseline pins development and example dependencies to **4.5.4**, including the
stress harness deployment manifest. The library peer range remains `^4.3.6`.
The lockfile changes no other resolved package versions. This dependency upgrade
does not add a `zod/compile` import or a `z.compile()` call, or change zodvex's validation policy.

## Reproduce the local proxy

From the repository root, install two exact versions outside the workspace and run:

```sh
baseline_dir=$(mktemp -d)
npm install --prefix "$baseline_dir/old" --ignore-scripts --no-audit --no-fund zod@4.3.6
npm install --prefix "$baseline_dir/new" --ignore-scripts --no-audit --no-fund zod@4.5.4
node examples/stress-test/schemaBaseline.mjs \
  "$baseline_dir/old/node_modules/zod" \
  "$baseline_dir/new/node_modules/zod" > "$baseline_dir/results.json"
```

The script verifies both package versions. It runs five fresh Node processes per
version, alternating execution order. Each process imports Zod, warms 20 schemas,
then constructs and retains 300 independent ten-field object schemas. It records
construction time, double-GC heap snapshots before construction, after construction,
and after one successful parse per schema. The corpus includes optional, nullable,
default, literal union, nested object, array, and enum fields. It uses full Zod,
with no codecs, zodvex models, generated code, or Convex runtime.

Raw samples, runtime/CPU metadata, source commit, dirty state, and the script's
SHA-256 are in
[`schema-baseline-2026-09-07.json`](../../examples/stress-test/results/schema-baseline-2026-09-07.json).
Results were captured after the dependency commit with the benchmark additions
uncommitted; the script hash identifies the exact implementation.

Medians from this run (Node 24.19.0, Linux x64):

| Local metric, 300 retained schemas | Zod 4.3.6 | Zod 4.5.4 |
| --- | ---: | ---: |
| Construction time | 180.07 ms | 23.64 ms |
| Retained heap delta after construction | 59,870,912 bytes | 6,909,304 bytes |
| Retained heap delta after first parse | 60,322,696 bytes | 7,475,336 bytes |

These are diagnostic local proxies. The heap snapshot excludes module import
cost and does not measure peak memory. Construction timing excludes GC and imports;
parse latency is not measured. Host load and Node/V8 version affect results.
**Do not convert these ratios into Convex table capacity or deployment limits.**
They support rerunning realistic deployment experiments before committing to a
memory-driven architectural change. They establish no runtime latency, validation
parity, bundle-size, or Convex economics claim.

The previous analysis on branch `ac486bb` used a different corpus/runtime and
reported estimated Convex capacity. Its local numbers are historical observations;
its capacity extrapolations remain unverified and are not this baseline.

## Compatibility checks and remaining gate

The tested dependency set is Zod 4.5.4, Convex 1.32.0, convex-helpers 0.1.113,
TypeScript 5.9.3, and Vitest 4.1.0, installed with Bun 1.3.9.

For a fresh checkout, build before the test suite because the suite inspects dist
artifacts. If installing with lifecycle scripts disabled, reinstall after building
so Bun creates the workspace CLI link:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun install --frozen-lockfile --ignore-scripts
bun run type-check
bun run test
bun run verify:consumer-declarations
bun run verify:examples
```

Type-check, build, consumer declarations, the full suite (154 files / 2,174 tests),
and local examples passed. The local
example check included stress harness tests (31), task-manager tests (17), mini
example tests (10), typechecks, and both codegen commands.

No Convex deployment ran. All three app `.env.local` files and the stress
harness's `_deploy/.env.local` were absent, with no ambient `CONVEX_DEPLOYMENT`.
The remaining release gate needs the configured development deployments and
network access described in the root validation instructions. Stress regression
resets its pinned deployment: use the dedicated disposable harness target.
Run the existing parity regression before any separate ceiling investigation.
User-defined schema acceptance can change across Zod versions; this test corpus
cannot establish compatibility for every consumer refinement or format validator.
