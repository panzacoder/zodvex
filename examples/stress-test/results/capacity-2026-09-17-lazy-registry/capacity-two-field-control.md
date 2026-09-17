# Zodvex codec workload benchmark

**VALID: complete observations and attributable capacity outcomes.**



Run dc015ae3-85a5-42ba-8bb3-8d61d9c87553; library commit 59dda9a24abc6a002efa49e8465ae29e551437b0; fixture 4007eaeb8165ebc1eb9763446b95a844b6c52f6aacf3fff1803e457ea09795ee.

Started 2026-09-17T04:22:25.149Z; target dutiful-llama-148. Payload field: 640 ASCII bytes; seeded rows: 256; batch sizes: 1, 64, 256; rounds: 7; order seed: 42. Payload is not full document size; actual resource counts are in results.json.

All variants use one model. Native/helpers and lean import one; models/registry import 32. Registry profiles additionally load 128 unused schema entries: _registry as an eager object literal (every entry's schemas built at module evaluation), _registry_lazy in the memoizing-getter shape zodvex generate emits since 0.7.11 (entries build on first access). These counts describe this synthetic fixture, not typical applications.

{"convex":"1.32.0","convex-helpers":"0.1.113","zod":"4.6.5","zodvex":"0.7.11-beta.1"}

One indexed read, modeled decode, domain transform and complete return encoding. Driver correctness checking and client transport are outside query execution time. Native performs manual codec transforms, without full Zod modeled validation. No measured heap or true cold-start claim.

220/220 planned calls recorded, including initial calls. All phases are checked for validity; the table below excludes initial calls. Named query capacity failures are outcomes; correctness, collection and attribution failures invalidate the run.

| Variant | Rows | Verified calls | Timing samples / planned | Missing telemetry | Cache hits | Server ms median [Q1, Q3] | User ms median | Paired native ratio | Errors |
|---|---:|---:|---:|---:|---:|---|---:|---:|---|
| native | 1 | 7/7 | 7/7 | 0 | 0 | 5.19 [5.03, 5.40] | 2.11 | 1.00 | none |
| native | 64 | 7/7 | 7/7 | 0 | 0 | 12.96 [12.72, 15.17] | 5.77 | 1.00 | none |
| native | 256 | 7/7 | 7/7 | 0 | 0 | 38.22 [36.45, 43.06] | 14.68 | 1.00 | none |
| helpers | 1 | 7/7 | 7/7 | 0 | 0 | 13.14 [12.76, 14.70] | 9.45 | 2.67 | none |
| helpers | 64 | 7/7 | 7/7 | 0 | 0 | 25.81 [22.73, 26.02] | 18.32 | 1.80 | none |
| helpers | 256 | 7/7 | 7/7 | 0 | 0 | 55.85 [55.12, 56.59] | 32.57 | 1.44 | none |
| full_lean | 1 | 7/7 | 7/7 | 0 | 0 | 14.08 [13.78, 16.32] | 11.12 | 2.79 | none |
| full_lean | 64 | 7/7 | 7/7 | 0 | 0 | 27.04 [23.86, 29.19] | 16.79 | 1.94 | none |
| full_lean | 256 | 7/7 | 7/7 | 0 | 0 | 59.64 [57.08, 63.25] | 36.59 | 1.51 | none |
| full_models | 1 | 7/7 | 7/7 | 0 | 0 | 29.57 [23.56, 30.09] | 26.53 | 4.94 | none |
| full_models | 64 | 7/7 | 7/7 | 0 | 0 | 40.21 [37.20, 42.37] | 31.42 | 3.19 | none |
| full_models | 256 | 7/7 | 7/7 | 0 | 0 | 71.01 [63.99, 71.87] | 42.51 | 1.72 | none |
| full_registry | 1 | 7/7 | 7/7 | 0 | 0 | 29.92 [26.40, 34.85] | 23.52 | 5.36 | none |
| full_registry | 64 | 7/7 | 7/7 | 0 | 0 | 36.07 [36.03, 42.95] | 29.06 | 2.78 | none |
| full_registry | 256 | 7/7 | 7/7 | 0 | 0 | 71.78 [68.22, 74.26] | 50.05 | 1.89 | none |
| full_registry_lazy | 1 | 7/7 | 7/7 | 0 | 0 | 30.77 [30.17, 32.16] | 27.11 | 6.01 | none |
| full_registry_lazy | 64 | 7/7 | 7/7 | 0 | 0 | 34.25 [33.06, 37.12] | 26.89 | 2.65 | none |
| full_registry_lazy | 256 | 7/7 | 7/7 | 0 | 0 | 62.89 [62.58, 70.06] | 41.55 | 1.73 | none |
| mini_lean | 1 | 7/7 | 7/7 | 0 | 0 | 12.35 [11.47, 12.95] | 8.45 | 2.33 | none |
| mini_lean | 64 | 7/7 | 7/7 | 0 | 0 | 21.16 [20.92, 24.63] | 13.87 | 1.62 | none |
| mini_lean | 256 | 7/7 | 7/7 | 0 | 0 | 52.02 [50.50, 54.31] | 29.07 | 1.38 | none |
| mini_models | 1 | 7/7 | 7/7 | 0 | 0 | 19.28 [19.16, 22.12] | 16.18 | 3.79 | none |
| mini_models | 64 | 7/7 | 7/7 | 0 | 0 | 34.92 [31.31, 35.85] | 26.67 | 2.25 | none |
| mini_models | 256 | 7/7 | 7/7 | 0 | 0 | 64.76 [62.42, 69.82] | 42.43 | 1.64 | none |
| mini_registry | 1 | 7/7 | 7/7 | 0 | 0 | 27.81 [24.35, 28.39] | 23.87 | 5.13 | none |
| mini_registry | 64 | 7/7 | 7/7 | 0 | 0 | 37.52 [33.50, 38.27] | 30.36 | 2.42 | none |
| mini_registry | 256 | 7/7 | 7/7 | 0 | 0 | 65.06 [60.47, 65.95] | 39.17 | 1.66 | none |
| mini_registry_lazy | 1 | 7/7 | 7/7 | 0 | 0 | 24.69 [19.64, 25.66] | 21.47 | 4.70 | none |
| mini_registry_lazy | 64 | 7/7 | 7/7 | 0 | 0 | 33.60 [31.09, 35.00] | 26.09 | 2.58 | none |
| mini_registry_lazy | 256 | 7/7 | 7/7 | 0 | 0 | 62.03 [61.08, 65.69] | 38.40 | 1.62 | none |

The largest tested successful batch is a lower bound under this fixture, not a maximum or a general row/table allowance. Timings describe successful uncached samples only; they do not conceal failed attempts shown alongside them. Full failure text/source, resource counters, optional user-timer sample counts, and exact call order are retained in results.json.
