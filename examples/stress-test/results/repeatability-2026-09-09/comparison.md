# Local model graph memory comparison

Local Convex retained object-byte deltas after forced GC; descriptive comparison, no performance gate.

128 background models + one probe; width 32; codec-rich; static; zero registry entries.
Each sample subtracts the same collection's zero-model control. Values are bytes; brackets show observed min/max, not confidence intervals.

Baseline: 3 collection(s), Zodvex 0.7.10, built JS SHA-256 b60e3b09b38d07580903af084865baa4e04f1801146a89c1389bb06397d5d7b5.
Candidate: 3 collection(s), Zodvex 0.7.10, built JS SHA-256 b60e3b09b38d07580903af084865baa4e04f1801146a89c1389bb06397d5d7b5.
Backend SHA-256: c07e85501038cdf6f969e2f7f8cb81e897a64f25d08d590ebd501342eaa3906c; dependencies: {"convex":"1.32.0","convex-helpers":"0.1.113","zod":"4.5.4","esbuild":"0.27.0"}.



| Variant | Baseline delta median [min, max] | Candidate delta median [min, max] | Change bytes | Change % | Bytes/model baseline → candidate |
|---|---:|---:|---:|---:|---:|
| native | 1036504 [1036504, 1036504] | 1036504 [1036504, 1036504] | 0 | 0.00% | 8097.69 → 8097.69 |
| helpers | 18690416 [18690416, 18690416] | 18690328 [18690184, 18690336] | -88 | -0.00% | 146018.88 → 146018.19 |
| full | 25817280 [25817256, 25817296] | 25817256 [25817208, 25817280] | -24 | -0.00% | 201697.50 → 201697.31 |
| mini | 19784520 [19784328, 19784560] | 19784456 [19784416, 19784664] | -64 | -0.00% | 154566.56 → 154566.06 |

Negative change means fewer retained bytes. Bytes/model is an average at this count, not a sizing formula. Hosted capacity and construction peaks require separate measurements.
