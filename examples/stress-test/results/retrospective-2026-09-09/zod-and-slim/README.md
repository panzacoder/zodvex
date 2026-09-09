# Retrospective local Convex retained memory — 2026-09-09

At a fixed 16-background-model, 32-field codec-rich graph, Zod 4.5.4 substantially reduces retained growth compared with 4.3.6. The existing schemaHelpers:false option provides a further reduction on this fixture. All 144 observations passed independent graph/output verification and matched forced-GC records.

Each value below is the median of three independent collections of (16-model retained bytes − same-kind zero-background-model retained bytes). Each collection uses fresh isolates. The fixed four-field probe remains in both controls and targets. Ranges are observed minima/maxima, not confidence intervals.

| Zod | Schema helpers | Kind | Matched delta bytes, median [min–max] | Target total, median bytes | Control total, median bytes |
| --- | --- | --- | ---: | ---: | ---: |
| 4.3.6 | ON | native | 162,504 [162,504–162,504] | 1,515,672 | 1,353,168 |
| 4.3.6 | ON | helpers | 20,255,864 [20,239,600–20,257,224] | 22,651,336 | 2,395,472 |
| 4.3.6 | ON | full | 24,981,896 [24,975,944–25,014,440] | 29,289,128 | 4,307,232 |
| 4.3.6 | ON | mini | 9,688,552 [9,649,560–9,726,584] | 13,580,560 | 3,892,008 |
| 4.3.6 | OFF | native | 162,504 [162,504–162,504] | 1,515,672 | 1,353,168 |
| 4.3.6 | OFF | helpers | 20,256,960 [20,239,520–20,293,176] | 22,652,432 | 2,395,472 |
| 4.3.6 | OFF | full | 21,388,376 [21,388,232–21,406,280] | 25,498,408 | 4,110,032 |
| 4.3.6 | OFF | mini | 7,533,176 [7,533,096–7,568,904] | 11,335,936 | 3,802,760 |
| 4.4.3 | ON | native | 162,504 [162,504–162,504] | 1,515,672 | 1,353,168 |
| 4.4.3 | ON | helpers | 12,227,704 [12,207,872–12,270,128] | 14,358,952 | 2,131,248 |
| 4.4.3 | ON | full | 15,663,768 [15,663,296–15,697,656] | 20,120,632 | 4,456,936 |
| 4.4.3 | ON | mini | 9,679,000 [9,653,856–9,682,320] | 13,625,024 | 3,946,024 |
| 4.4.3 | OFF | native | 162,504 [162,504–162,504] | 1,515,672 | 1,353,168 |
| 4.4.3 | OFF | helpers | 12,225,712 [12,225,552–12,243,440] | 14,357,032 | 2,131,320 |
| 4.4.3 | OFF | full | 12,981,136 [12,981,080–12,981,408] | 17,278,248 | 4,297,168 |
| 4.4.3 | OFF | mini | 7,532,600 [7,532,352–7,624,384] | 11,389,496 | 3,856,896 |
| 4.5.4 | ON | native | 162,504 [162,504–162,504] | 1,515,672 | 1,353,168 |
| 4.5.4 | ON | helpers | 2,452,320 [2,452,320–2,452,360] | 5,185,976 | 2,733,656 |
| 4.5.4 | ON | full | 3,432,720 [3,432,720–3,432,720] | 8,320,664 | 4,887,944 |
| 4.5.4 | ON | mini | 2,657,520 [2,657,480–2,657,560] | 7,149,568 | 4,492,048 |
| 4.5.4 | OFF | native | 162,504 [162,504–162,504] | 1,515,672 | 1,353,168 |
| 4.5.4 | OFF | helpers | 2,452,400 [2,452,360–2,452,440] | 5,186,056 | 2,733,656 |
| 4.5.4 | OFF | full | 2,831,232 [2,831,080–2,831,240] | 7,622,864 | 4,791,632 |
| 4.5.4 | OFF | mini | 2,150,520 [2,150,360–2,150,520] | 6,583,584 | 4,433,064 |

| Change | Kind | Before delta bytes | After delta bytes | Change |
| --- | --- | ---: | ---: | ---: |
| Zod 4.3.6 → 4.5.4, helpers ON | native | 162,504 | 162,504 | 0.00% |
| Zod 4.3.6 → 4.5.4, helpers ON | helpers | 20,255,864 | 2,452,320 | -87.89% |
| Zod 4.3.6 → 4.5.4, helpers ON | full | 24,981,896 | 3,432,720 | -86.26% |
| Zod 4.3.6 → 4.5.4, helpers ON | mini | 9,688,552 | 2,657,520 | -72.57% |
| Zod 4.4.3 → 4.5.4, helpers ON | native | 162,504 | 162,504 | 0.00% |
| Zod 4.4.3 → 4.5.4, helpers ON | helpers | 12,227,704 | 2,452,320 | -79.94% |
| Zod 4.4.3 → 4.5.4, helpers ON | full | 15,663,768 | 3,432,720 | -78.08% |
| Zod 4.4.3 → 4.5.4, helpers ON | mini | 9,679,000 | 2,657,520 | -72.54% |
| Zod 4.3.6 → 4.4.3, helpers ON | native | 162,504 | 162,504 | 0.00% |
| Zod 4.3.6 → 4.4.3, helpers ON | helpers | 20,255,864 | 12,227,704 | -39.63% |
| Zod 4.3.6 → 4.4.3, helpers ON | full | 24,981,896 | 15,663,768 | -37.30% |
| Zod 4.3.6 → 4.4.3, helpers ON | mini | 9,688,552 | 9,679,000 | -0.10% |
| Helpers ON → OFF, Zod 4.5.4 | native | 162,504 | 162,504 | 0.00% |
| Helpers ON → OFF, Zod 4.5.4 | helpers | 2,452,320 | 2,452,400 | 0.00% |
| Helpers ON → OFF, Zod 4.5.4 | full | 3,432,720 | 2,831,232 | -17.52% |
| Helpers ON → OFF, Zod 4.5.4 | mini | 2,657,520 | 2,150,520 | -19.08% |

Native and convex-helpers do not consume schemaHelpers; their repeated ON/OFF cells are no-op controls. Native retained growth was exactly 162,504 bytes in every collection. Full/Mini library registration and builders remain enabled in every modeled cell. Registry entry count is zero.

This measures V8 retained object bytes after the tiny decode/encode operation and two explicit globalThis.gc calls on one official local Convex backend. The collector requires at least two matching major-GC records and uses the final record; five 4.4.3 helpers observations emitted three records, all from the same isolate, and remain included. It excludes external bytes, peak allocation, allocator/RSS overhead, hosted infrastructure, deployment analysis, populated database wrappers, and request-registry growth. Absolute zero-count retained bytes increased with the newer Zod, while background-graph growth fell. Bundle size, total retained bytes, and matched graph growth remain separate quantities. Three repeats on one backend process are not multiple-host replications.

## Frozen identities

- Zodvex source: a0770cf0545a8477c562e5925c3866b4720dba47, package 0.7.10; checkout was clean.
- Actual built JavaScript digest: b60e3b09b38d07580903af084865baa4e04f1801146a89c1389bb06397d5d7b5 (14 files).
- Backend source: 8bc6aa4645adfd66584034b175dbef96536938b8; binary SHA-256 c07e85501038cdf6f969e2f7f8cb81e897a64f25d08d590ebd501342eaa3906c.
- Collector: Bun 1.3.9, Node compatibility v24.3.0, darwin/arm64.
- Fixed dependencies: Convex 1.32.0, convex-helpers 0.1.113, esbuild 0.27.0.
- Exact Zod package locks are versions/4.3.6/bun.lock, versions/4.4.3/bun.lock and versions/4.5.4/bun.lock.
- Dedicated loopback backend, REUSE_ISOLATES=false; V8 flags --expose-gc --trace-gc-nvp.

## Instrumentation adaptations

Only an isolated copy of the benchmark changed. Canonical source is saved under canonical/, adapted source under memory/, and adapt.py records the transformations. No library/runtime optimization was introduced.

1. The model factory gets the supported third argument {schemaHelpers:false} in OFF cells; ON retains the omitted-option default. The same fields, codec closures, instances, names, dimensions and operation remain unchanged.
2. Slim models omit .schema. After defineZodSchema, both modes retain insert schemas through the existing __zodTableMap aliases. ON therefore retains the same object as canonical model.schema.insert. The later alias checksum is unchanged. The registry doc accessor uses that same map, although registry count is zero in this experiment.
3. The bundler supplies one exact Zod package root via esbuild alias. All resolved input paths and content hashes are saved per observation. Collection and analysis reject mixed Zod versions; Mini rejects classic imports; native/helpers reject Zodvex contamination. The virtual stdin source is hashed separately.
4. Provenance reads the frozen origin metadata rather than the unrelated temporary directory Git state. Zod version, helper mode and round are explicit experimental metadata. The evidence format is distinct from ordinary compatible-build comparisons. Canonical comparison guards were not changed.
5. The collector only adds resolved-input evidence and the retrospective format marker. The request API, forced-GC position, oracle, freshness, response/GC validity requirements and per-kind control subtraction are unchanged.

One preflight attempt stopped before sending any backend request because the input-hash recorder treated esbuild virtual stdin as a disk file. The fix handles virtual stdin explicitly. That incomplete attempt is retained under attempts/ and excluded from all results. No statistical outlier or failed backend observation was discarded.

## Reproduction and files

The study order and dimensions are in run-plan.json. run-study.mjs collected all eighteen cells sequentially; round two reverses version and helper order, and round three rotates versions. The earlier two-version study remains preserved separately and is not pooled into these final samples. Every observed query uses a fresh isolate. Start the same binary with memory/start-local.py and an existing valid local-development admin key on dedicated ports. Key files and backend database are outside this evidence directory.

Use the selected environment variables ZOD_RETRO_VERSION=4.3.6, 4.4.3 or 4.5.4, ZOD_RETRO_HELPERS=on or off, and ZOD_RETRO_ROUND=1/2/3 with:

```sh
bun memory/local.mjs /path/to/dedicated-backend 16 32 codec-rich
bun analyze.mjs
```

Frozen compiled bundles under results/local/*/sources/ can also be sent directly to the same local tester API; their only runtime external import is the Convex system query wrapper. Rebuilding requires the recorded library dist, selected Zod package, and fixed dependency versions; source paths in captured input metadata identify this original run. The portable archive includes each unique resolved input under inputs/<sha256>, allowing analyze.mjs to validate content offline without access to those original paths.

retrospective.json contains all integer samples, medians/ranges, differences, contract identities and collection references. Every collection has manifest.json, summary.json, calls.jsonl, source bundles, resolved-input hashes and raw GC excerpts. The JSON summarizes 18 valid collections, 144 valid calls and 293 matching forced major-GC events. This bounded retrospective supplies evidence for prioritization; it does not establish an application memory ceiling or an automatic release gate.
