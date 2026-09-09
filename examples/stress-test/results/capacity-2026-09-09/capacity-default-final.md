# capacity-default-final

**VALID: complete uncached telemetry; no correctness or attribution failures.**

Run fd4c96d2-5067-48ee-ae1b-4394c7406aef; commit dc0179e38ff51d8827ddadceb10945253df19362; fixture 5092dac18dfb0e21f03d559f7d4deb1c91f0ba60f03423c4db0445b962057acf.

2026-09-09T18:27:11.610Z; deployment lovable-donkey-430; payload field 640 ASCII bytes; batches 1,64,256; 7 rounds; order seed 42. Payload is not total document size. Stack: {"convex":"1.32.0","convex-helpers":"0.1.113","zod":"4.5.4","zodvex":"0.7.10"}.

176 calls including initial samples; 0 query capacity failures; 27.219 seconds including setup; 16591296 query read bytes (excludes setup/reference).

All profiles use one model. Lean imports one; models/registry import 32. Registry profiles load 128 additional unused schema entries. Native performs manual codec transformations without full modeled Zod validation.

| Variant | Rows | Verified | Timings / planned | Server ms median [Q1, Q3] | User ms median | Errors |
|---|---:|---:|---:|---|---:|---|
| native | 1 | 7/7 | 7/7 | 7.32 [6.93, 8.08] | 1.94 | none |
| native | 64 | 7/7 | 7/7 | 16.05 [15.42, 18.89] | 5.41 | none |
| native | 256 | 7/7 | 7/7 | 45.49 [43.72, 47.16] | 15.06 | none |
| helpers | 1 | 7/7 | 7/7 | 14.52 [13.85, 16.18] | 8.83 | none |
| helpers | 64 | 7/7 | 7/7 | 24.82 [23.30, 25.19] | 14.16 | none |
| helpers | 256 | 7/7 | 7/7 | 58.23 [56.89, 60.72] | 29.27 | none |
| full_lean | 1 | 7/7 | 7/7 | 15.45 [15.15, 16.31] | 10.35 | none |
| full_lean | 64 | 7/7 | 7/7 | 29.42 [26.61, 32.61] | 19.96 | none |
| full_lean | 256 | 7/7 | 7/7 | 67.88 [64.36, 71.33] | 37.11 | none |
| full_models | 1 | 7/7 | 7/7 | 32.27 [25.52, 33.02] | 27.22 | none |
| full_models | 64 | 7/7 | 7/7 | 41.90 [35.40, 42.87] | 26.34 | none |
| full_models | 256 | 7/7 | 7/7 | 77.24 [73.67, 77.32] | 48.36 | none |
| full_registry | 1 | 7/7 | 7/7 | 36.28 [29.14, 37.46] | 31.42 | none |
| full_registry | 64 | 7/7 | 7/7 | 40.95 [39.27, 45.49] | 29.72 | none |
| full_registry | 256 | 7/7 | 7/7 | 82.24 [76.56, 83.59] | 53.31 | none |
| mini_lean | 1 | 7/7 | 7/7 | 17.29 [13.86, 17.64] | 8.15 | none |
| mini_lean | 64 | 7/7 | 7/7 | 24.47 [22.88, 26.69] | 14.03 | none |
| mini_lean | 256 | 7/7 | 7/7 | 58.16 [56.93, 61.20] | 29.14 | none |
| mini_models | 1 | 7/7 | 7/7 | 22.69 [22.07, 27.38] | 16.26 | none |
| mini_models | 64 | 7/7 | 7/7 | 32.51 [32.03, 36.32] | 22.60 | none |
| mini_models | 256 | 7/7 | 7/7 | 71.53 [68.65, 77.03] | 43.22 | none |
| mini_registry | 1 | 7/7 | 7/7 | 28.39 [24.47, 30.69] | 20.74 | none |
| mini_registry | 64 | 7/7 | 7/7 | 34.67 [34.06, 37.94] | 24.83 | none |
| mini_registry | 256 | 7/7 | 7/7 | 75.82 [71.80, 79.97] | 47.07 | none |

Server execution excludes client transport and the verifier action. User time excludes tracked system waits and is not OS CPU time. There is no measured heap or true cold-start claim. Largest successful batches are lower bounds for this fixture. This report was rendered from saved observations after review; original run artifacts are retained in the evidence archive.
