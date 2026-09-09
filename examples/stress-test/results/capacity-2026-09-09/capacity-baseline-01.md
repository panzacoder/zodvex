# capacity-baseline-01

**VALID: complete uncached telemetry; no correctness or attribution failures.**

Run f43c6f92-2dea-478b-aa59-39dd55a949f8; commit ad4a23241b7a351e2406fe555283f9e81591139a; fixture edd610ac1221e0fbeaddf15e67a9733b9faab0fff55f9efc9f1693dfa6ab6db8.

2026-09-09T18:13:20.192Z; deployment lovable-donkey-430; payload field 640 ASCII bytes; batches 1,64,256,1024,4096; 7 rounds; order seed 42. Payload is not total document size. Stack: {"convex":"1.32.0","convex-helpers":"0.1.113","zod":"4.5.4","zodvex":"0.7.10"}.

288 calls including initial samples; 0 query capacity failures; 91.573 seconds including setup; 281137088 query read bytes (excludes setup/reference).

All profiles use one model. Lean imports one; models/registry import 32. Registry profiles load 128 additional unused schema entries. Native performs manual codec transformations without full modeled Zod validation.

| Variant | Rows | Verified | Timings / planned | Server ms median [Q1, Q3] | User ms median | Errors |
|---|---:|---:|---:|---|---:|---|
| native | 1 | 7/7 | 7/7 | 6.98 [6.91, 7.89] | 2.16 | none |
| native | 64 | 7/7 | 7/7 | 16.01 [15.24, 17.21] | 5.60 | none |
| native | 256 | 7/7 | 7/7 | 43.61 [43.50, 44.17] | 15.91 | none |
| native | 1024 | 7/7 | 7/7 | 165.66 [149.64, 177.00] | 48.90 | none |
| native | 4096 | 7/7 | 7/7 | 581.99 [569.40, 634.11] | 164.79 | none |
| helpers | 1 | 7/7 | 7/7 | 13.48 [13.14, 13.65] | 8.73 | none |
| helpers | 64 | 7/7 | 7/7 | 26.57 [25.09, 28.99] | 15.31 | none |
| helpers | 256 | 7/7 | 7/7 | 60.53 [59.33, 61.25] | 31.31 | none |
| helpers | 1024 | 7/7 | 7/7 | 182.63 [178.02, 192.59] | 77.90 | none |
| helpers | 4096 | 7/7 | 7/7 | 629.17 [614.62, 635.90] | 215.99 | none |
| full_lean | 1 | 7/7 | 7/7 | 16.63 [15.75, 22.85] | 10.85 | none |
| full_lean | 64 | 7/7 | 7/7 | 25.18 [25.14, 28.73] | 16.19 | none |
| full_lean | 256 | 7/7 | 7/7 | 72.93 [64.00, 77.59] | 40.01 | none |
| full_lean | 1024 | 7/7 | 7/7 | 206.54 [196.18, 213.00] | 87.37 | none |
| full_lean | 4096 | 7/7 | 7/7 | 677.29 [630.69, 686.81] | 237.65 | none |
| full_models | 1 | 7/7 | 7/7 | 35.41 [33.05, 38.11] | 30.49 | none |
| full_models | 64 | 7/7 | 7/7 | 45.24 [41.26, 46.27] | 35.82 | none |
| full_models | 256 | 7/7 | 7/7 | 79.23 [77.44, 81.62] | 50.56 | none |
| full_models | 1024 | 7/7 | 7/7 | 205.55 [203.58, 217.45] | 102.67 | none |
| full_models | 4096 | 7/7 | 7/7 | 646.38 [631.25, 657.66] | 258.45 | none |
| full_registry | 1 | 7/7 | 7/7 | 32.28 [30.65, 35.74] | 26.62 | none |
| full_registry | 64 | 7/7 | 7/7 | 41.63 [39.81, 49.92] | 32.00 | none |
| full_registry | 256 | 7/7 | 7/7 | 85.53 [82.67, 88.40] | 55.56 | none |
| full_registry | 1024 | 7/7 | 7/7 | 224.45 [206.40, 241.74] | 106.98 | none |
| full_registry | 4096 | 7/7 | 7/7 | 684.44 [662.55, 698.35] | 267.15 | none |
| mini_lean | 1 | 7/7 | 7/7 | 14.27 [13.43, 14.88] | 8.53 | none |
| mini_lean | 64 | 7/7 | 7/7 | 24.60 [23.29, 30.21] | 14.19 | none |
| mini_lean | 256 | 7/7 | 7/7 | 65.06 [60.20, 67.44] | 30.30 | none |
| mini_lean | 1024 | 7/7 | 7/7 | 188.36 [177.91, 192.05] | 81.61 | none |
| mini_lean | 4096 | 7/7 | 7/7 | 635.24 [614.65, 666.71] | 230.37 | none |
| mini_models | 1 | 7/7 | 7/7 | 21.98 [21.58, 23.47] | 16.89 | none |
| mini_models | 64 | 7/7 | 7/7 | 32.17 [31.74, 34.86] | 22.35 | none |
| mini_models | 256 | 7/7 | 7/7 | 80.40 [71.57, 88.41] | 46.22 | none |
| mini_models | 1024 | 7/7 | 7/7 | 192.36 [187.56, 195.88] | 85.51 | none |
| mini_models | 4096 | 7/7 | 7/7 | 643.71 [633.57, 668.88] | 246.10 | none |
| mini_registry | 1 | 7/7 | 7/7 | 31.79 [24.59, 34.65] | 19.91 | none |
| mini_registry | 64 | 7/7 | 7/7 | 41.04 [37.65, 42.01] | 31.96 | none |
| mini_registry | 256 | 7/7 | 7/7 | 82.26 [71.37, 85.78] | 50.40 | none |
| mini_registry | 1024 | 7/7 | 7/7 | 199.07 [196.16, 204.68] | 97.22 | none |
| mini_registry | 4096 | 7/7 | 7/7 | 648.92 [641.15, 666.55] | 249.28 | none |

Server execution excludes client transport and the verifier action. User time excludes tracked system waits and is not OS CPU time. There is no measured heap or true cold-start claim. Largest successful batches are lower bounds for this fixture. This report was rendered from saved observations after review; original run artifacts are retained in the evidence archive.
