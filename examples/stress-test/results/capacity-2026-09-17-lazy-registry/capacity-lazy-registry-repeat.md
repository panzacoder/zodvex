# Zodvex codec workload benchmark

**VALID: complete observations and attributable capacity outcomes.**



Run bf81be54-263e-46ea-aa67-1062b1b14a07; library commit d4283d2a4e45bacb648f230d9dc0a82e7969e240; fixture f5085c2c9e507f6d15ddd0bb08e1192bc7b3f4bfa29e03f0e96db98ccb91a534.

Started 2026-09-17T04:24:32.814Z; target dutiful-llama-148. Payload field: 640 ASCII bytes; seeded rows: 256; batch sizes: 1, 64, 256; rounds: 7; order seed: 42. Payload is not full document size; actual resource counts are in results.json.

All variants use one model. Native/helpers and lean import one; models/registry import 32. Registry profiles additionally load 128 unused schema entries: _registry as an eager object literal (every entry's schemas built at module evaluation), _registry_lazy in the memoizing-getter shape zodvex generate emits since 0.7.11 (entries build on first access). These counts describe this synthetic fixture, not typical applications.

{"convex":"1.32.0","convex-helpers":"0.1.113","zod":"4.6.5","zodvex":"0.7.11-beta.1"}

One indexed read, modeled decode, domain transform and complete return encoding. Driver correctness checking and client transport are outside query execution time. Native performs manual codec transforms, without full Zod modeled validation. No measured heap or true cold-start claim.

220/220 planned calls recorded, including initial calls. All phases are checked for validity; the table below excludes initial calls. Named query capacity failures are outcomes; correctness, collection and attribution failures invalidate the run.

| Variant | Rows | Verified calls | Timing samples / planned | Missing telemetry | Cache hits | Server ms median [Q1, Q3] | User ms median | Paired native ratio | Errors |
|---|---:|---:|---:|---:|---:|---|---:|---:|---|
| native | 1 | 7/7 | 7/7 | 0 | 0 | 5.46 [5.09, 5.68] | 2.15 | 1.00 | none |
| native | 64 | 7/7 | 7/7 | 0 | 0 | 13.26 [12.69, 13.88] | 5.66 | 1.00 | none |
| native | 256 | 7/7 | 7/7 | 0 | 0 | 37.84 [37.06, 39.16] | 14.60 | 1.00 | none |
| helpers | 1 | 7/7 | 7/7 | 0 | 0 | 13.01 [12.55, 13.21] | 9.73 | 2.58 | none |
| helpers | 64 | 7/7 | 7/7 | 0 | 0 | 23.85 [22.29, 25.89] | 15.49 | 1.84 | none |
| helpers | 256 | 7/7 | 7/7 | 0 | 0 | 56.62 [56.10, 60.67] | 32.41 | 1.55 | none |
| full_lean | 1 | 7/7 | 7/7 | 0 | 0 | 13.79 [13.70, 14.87] | 10.80 | 2.68 | none |
| full_lean | 64 | 7/7 | 7/7 | 0 | 0 | 25.48 [23.39, 28.69] | 16.35 | 1.92 | none |
| full_lean | 256 | 7/7 | 7/7 | 0 | 0 | 61.30 [57.51, 67.45] | 35.60 | 1.54 | none |
| full_models | 1 | 7/7 | 7/7 | 0 | 0 | 30.51 [23.82, 31.35] | 27.30 | 5.45 | none |
| full_models | 64 | 7/7 | 7/7 | 0 | 0 | 39.06 [36.22, 39.74] | 32.03 | 2.93 | none |
| full_models | 256 | 7/7 | 7/7 | 0 | 0 | 70.47 [67.58, 72.32] | 43.67 | 1.75 | none |
| full_registry | 1 | 7/7 | 7/7 | 0 | 0 | 47.77 [47.46, 48.08] | 44.23 | 8.80 | none |
| full_registry | 64 | 7/7 | 7/7 | 0 | 0 | 57.27 [56.20, 57.79] | 49.82 | 4.33 | none |
| full_registry | 256 | 7/7 | 7/7 | 0 | 0 | 95.92 [89.50, 98.75] | 66.38 | 2.44 | none |
| full_registry_lazy | 1 | 7/7 | 7/7 | 0 | 0 | 28.91 [24.05, 30.64] | 25.73 | 5.12 | none |
| full_registry_lazy | 64 | 7/7 | 7/7 | 0 | 0 | 33.43 [32.85, 38.21] | 26.01 | 2.64 | none |
| full_registry_lazy | 256 | 7/7 | 7/7 | 0 | 0 | 65.44 [62.97, 76.51] | 42.02 | 1.70 | none |
| mini_lean | 1 | 7/7 | 7/7 | 0 | 0 | 12.69 [12.47, 14.08] | 8.64 | 2.38 | none |
| mini_lean | 64 | 7/7 | 7/7 | 0 | 0 | 22.92 [21.11, 26.18] | 15.35 | 1.66 | none |
| mini_lean | 256 | 7/7 | 7/7 | 0 | 0 | 54.45 [52.91, 55.58] | 30.23 | 1.38 | none |
| mini_models | 1 | 7/7 | 7/7 | 0 | 0 | 19.42 [18.82, 25.76] | 16.40 | 3.83 | none |
| mini_models | 64 | 7/7 | 7/7 | 0 | 0 | 31.76 [29.26, 33.66] | 21.78 | 2.36 | none |
| mini_models | 256 | 7/7 | 7/7 | 0 | 0 | 62.65 [61.30, 74.17] | 41.04 | 1.62 | none |
| mini_registry | 1 | 7/7 | 7/7 | 0 | 0 | 37.65 [33.34, 40.82] | 34.07 | 7.24 | none |
| mini_registry | 64 | 7/7 | 7/7 | 0 | 0 | 47.10 [39.03, 50.47] | 31.64 | 3.41 | none |
| mini_registry | 256 | 7/7 | 7/7 | 0 | 0 | 78.11 [76.00, 79.06] | 54.41 | 2.06 | none |
| mini_registry_lazy | 1 | 7/7 | 7/7 | 0 | 0 | 19.33 [19.00, 23.29] | 16.06 | 3.74 | none |
| mini_registry_lazy | 64 | 7/7 | 7/7 | 0 | 0 | 33.78 [29.17, 36.49] | 26.16 | 2.42 | none |
| mini_registry_lazy | 256 | 7/7 | 7/7 | 0 | 0 | 64.92 [59.69, 65.74] | 38.59 | 1.59 | none |

The largest tested successful batch is a lower bound under this fixture, not a maximum or a general row/table allowance. Timings describe successful uncached samples only; they do not conceal failed attempts shown alongside them. Full failure text/source, resource counters, optional user-timer sample counts, and exact call order are retained in results.json.
