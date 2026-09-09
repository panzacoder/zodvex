# capacity-baseline-02

**VALID: complete uncached telemetry; no correctness or attribution failures.**

Run e6e121b4-0e13-4a16-a45c-9f7b91080a0f; commit ad4a23241b7a351e2406fe555283f9e81591139a; fixture edd610ac1221e0fbeaddf15e67a9733b9faab0fff55f9efc9f1693dfa6ab6db8.

2026-09-09T18:16:45.824Z; deployment lovable-donkey-430; payload field 640 ASCII bytes; batches 64,256,8192; 7 rounds; order seed 137. Payload is not total document size. Stack: {"convex":"1.32.0","convex-helpers":"0.1.113","zod":"4.5.4","zodvex":"0.7.10"}.

176 calls including initial samples; 0 query capacity failures; 108.932 seconds including setup; 440279968 query read bytes (excludes setup/reference).

All profiles use one model. Lean imports one; models/registry import 32. Registry profiles load 128 additional unused schema entries. Native performs manual codec transformations without full modeled Zod validation.

| Variant | Rows | Verified | Timings / planned | Server ms median [Q1, Q3] | User ms median | Errors |
|---|---:|---:|---:|---|---:|---|
| native | 64 | 7/7 | 7/7 | 15.80 [15.66, 17.83] | 6.25 | none |
| native | 256 | 7/7 | 7/7 | 46.62 [44.39, 47.82] | 18.58 | none |
| native | 8192 | 7/7 | 7/7 | 1087.21 [1082.44, 1110.92] | 311.52 | none |
| helpers | 64 | 7/7 | 7/7 | 25.70 [24.61, 31.50] | 16.30 | none |
| helpers | 256 | 7/7 | 7/7 | 62.31 [61.18, 63.06] | 33.83 | none |
| helpers | 8192 | 7/7 | 7/7 | 1209.74 [1171.14, 1225.57] | 376.17 | none |
| full_lean | 64 | 7/7 | 7/7 | 27.55 [26.57, 30.95] | 17.88 | none |
| full_lean | 256 | 7/7 | 7/7 | 66.46 [62.92, 68.57] | 36.39 | none |
| full_lean | 8192 | 7/7 | 7/7 | 1209.44 [1205.42, 1236.42] | 414.81 | none |
| full_models | 64 | 7/7 | 7/7 | 43.73 [42.38, 47.15] | 34.58 | none |
| full_models | 256 | 7/7 | 7/7 | 80.59 [76.08, 80.89] | 51.00 | none |
| full_models | 8192 | 7/7 | 7/7 | 1225.75 [1219.83, 1265.04] | 431.80 | none |
| full_registry | 64 | 7/7 | 7/7 | 49.45 [48.14, 49.69] | 39.14 | none |
| full_registry | 256 | 7/7 | 7/7 | 82.21 [77.55, 87.57] | 54.92 | none |
| full_registry | 8192 | 7/7 | 7/7 | 1295.82 [1281.02, 1301.13] | 438.87 | none |
| mini_lean | 64 | 7/7 | 7/7 | 28.32 [25.56, 31.71] | 18.94 | none |
| mini_lean | 256 | 7/7 | 7/7 | 63.03 [61.41, 63.28] | 33.99 | none |
| mini_lean | 8192 | 7/7 | 7/7 | 1207.54 [1179.94, 1219.30] | 400.71 | none |
| mini_models | 64 | 7/7 | 7/7 | 40.83 [32.10, 41.14] | 31.28 | none |
| mini_models | 256 | 7/7 | 7/7 | 70.62 [65.76, 74.36] | 43.54 | none |
| mini_models | 8192 | 7/7 | 7/7 | 1202.37 [1200.75, 1224.06] | 423.23 | none |
| mini_registry | 64 | 7/7 | 7/7 | 44.56 [40.39, 45.69] | 33.62 | none |
| mini_registry | 256 | 7/7 | 7/7 | 74.87 [73.53, 77.78] | 46.65 | none |
| mini_registry | 8192 | 7/7 | 7/7 | 1227.66 [1210.34, 1314.67] | 428.34 | none |

Server execution excludes client transport and the verifier action. User time excludes tracked system waits and is not OS CPU time. There is no measured heap or true cold-start claim. Largest successful batches are lower bounds for this fixture. This report was rendered from saved observations after review; original run artifacts are retained in the evidence archive.
