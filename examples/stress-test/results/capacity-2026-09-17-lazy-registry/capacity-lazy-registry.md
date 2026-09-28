# Zodvex codec workload benchmark

**VALID: complete observations and attributable capacity outcomes.**



Run 741a1a07-f0b2-4e7d-9680-ec4d96178743; library commit 78b4393989160fec91fd4c2d9c329078bb4f83eb; fixture f5085c2c9e507f6d15ddd0bb08e1192bc7b3f4bfa29e03f0e96db98ccb91a534.

Started 2026-09-17T04:26:25.070Z; target dutiful-llama-148. Payload field: 640 ASCII bytes; seeded rows: 256; batch sizes: 1, 64, 256; rounds: 7; order seed: 42. Payload is not full document size; actual resource counts are in results.json.

All variants use one model. Native/helpers and lean import one; models/registry import 32. Registry profiles additionally load 128 unused schema entries: _registry as an eager object literal (every entry's schemas built at module evaluation), _registry_lazy in the memoizing-getter shape zodvex generate emits since 0.7.11 (entries build on first access). These counts describe this synthetic fixture, not typical applications.

{"convex":"1.32.0","convex-helpers":"0.1.113","zod":"4.6.5","zodvex":"0.7.11-beta.1"}

One indexed read, modeled decode, domain transform and complete return encoding. Driver correctness checking and client transport are outside query execution time. Native performs manual codec transforms, without full Zod modeled validation. No measured heap or true cold-start claim.

220/220 planned calls recorded, including initial calls. All phases are checked for validity; the table below excludes initial calls. Named query capacity failures are outcomes; correctness, collection and attribution failures invalidate the run.

| Variant | Rows | Verified calls | Timing samples / planned | Missing telemetry | Cache hits | Server ms median [Q1, Q3] | User ms median | Paired native ratio | Errors |
|---|---:|---:|---:|---:|---:|---|---:|---:|---|
| native | 1 | 7/7 | 7/7 | 0 | 0 | 5.95 [5.19, 7.47] | 2.21 | 1.00 | none |
| native | 64 | 7/7 | 7/7 | 0 | 0 | 13.51 [12.70, 16.46] | 5.65 | 1.00 | none |
| native | 256 | 7/7 | 7/7 | 0 | 0 | 51.88 [41.98, 63.04] | 14.66 | 1.00 | none |
| helpers | 1 | 7/7 | 7/7 | 0 | 0 | 12.51 [12.33, 13.61] | 9.38 | 2.06 | none |
| helpers | 64 | 7/7 | 7/7 | 0 | 0 | 25.73 [23.88, 28.37] | 17.80 | 2.01 | none |
| helpers | 256 | 7/7 | 7/7 | 0 | 0 | 57.08 [54.72, 71.38] | 32.80 | 1.24 | none |
| full_lean | 1 | 7/7 | 7/7 | 0 | 0 | 13.82 [13.54, 17.47] | 10.70 | 2.27 | none |
| full_lean | 64 | 7/7 | 7/7 | 0 | 0 | 25.34 [23.15, 27.65] | 16.39 | 1.89 | none |
| full_lean | 256 | 7/7 | 7/7 | 0 | 0 | 61.69 [60.69, 90.59] | 37.03 | 1.37 | none |
| full_models | 1 | 7/7 | 7/7 | 0 | 0 | 31.78 [27.09, 32.46] | 26.86 | 4.94 | none |
| full_models | 64 | 7/7 | 7/7 | 0 | 0 | 40.47 [39.62, 46.08] | 31.69 | 2.88 | none |
| full_models | 256 | 7/7 | 7/7 | 0 | 0 | 69.59 [63.34, 96.45] | 41.64 | 1.49 | none |
| full_registry | 1 | 7/7 | 7/7 | 0 | 0 | 48.90 [48.02, 52.14] | 44.81 | 8.03 | none |
| full_registry | 64 | 7/7 | 7/7 | 0 | 0 | 56.63 [56.24, 60.61] | 49.27 | 4.40 | none |
| full_registry | 256 | 7/7 | 7/7 | 0 | 0 | 93.07 [88.92, 107.08] | 68.86 | 1.94 | none |
| full_registry_lazy | 1 | 7/7 | 7/7 | 0 | 0 | 31.21 [23.87, 32.16] | 26.46 | 4.60 | none |
| full_registry_lazy | 64 | 7/7 | 7/7 | 0 | 0 | 33.03 [32.62, 36.07] | 25.83 | 2.58 | none |
| full_registry_lazy | 256 | 7/7 | 7/7 | 0 | 0 | 73.25 [67.42, 81.56] | 42.63 | 1.69 | none |
| mini_lean | 1 | 7/7 | 7/7 | 0 | 0 | 12.28 [11.84, 13.81] | 8.44 | 2.06 | none |
| mini_lean | 64 | 7/7 | 7/7 | 0 | 0 | 25.61 [22.10, 29.17] | 15.84 | 1.70 | none |
| mini_lean | 256 | 7/7 | 7/7 | 0 | 0 | 55.65 [52.03, 62.86] | 29.81 | 1.20 | none |
| mini_models | 1 | 7/7 | 7/7 | 0 | 0 | 20.55 [19.11, 22.88] | 16.31 | 3.56 | none |
| mini_models | 64 | 7/7 | 7/7 | 0 | 0 | 28.83 [28.74, 32.94] | 21.66 | 2.13 | none |
| mini_models | 256 | 7/7 | 7/7 | 0 | 0 | 64.50 [63.13, 67.09] | 41.63 | 1.38 | none |
| mini_registry | 1 | 7/7 | 7/7 | 0 | 0 | 38.11 [36.97, 39.98] | 34.16 | 6.02 | none |
| mini_registry | 64 | 7/7 | 7/7 | 0 | 0 | 45.95 [39.57, 52.08] | 33.36 | 3.70 | none |
| mini_registry | 256 | 7/7 | 7/7 | 0 | 0 | 84.32 [77.56, 87.36] | 54.70 | 1.70 | none |
| mini_registry_lazy | 1 | 7/7 | 7/7 | 0 | 0 | 19.93 [18.85, 20.73] | 15.85 | 3.21 | none |
| mini_registry_lazy | 64 | 7/7 | 7/7 | 0 | 0 | 35.44 [30.24, 37.00] | 21.41 | 2.32 | none |
| mini_registry_lazy | 256 | 7/7 | 7/7 | 0 | 0 | 65.42 [61.50, 67.87] | 36.83 | 1.24 | none |

The largest tested successful batch is a lower bound under this fixture, not a maximum or a general row/table allowance. Timings describe successful uncached samples only; they do not conceal failed attempts shown alongside them. Full failure text/source, resource counters, optional user-timer sample counts, and exact call order are retained in results.json.
