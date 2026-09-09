# capacity-read-limit

**VALID: complete uncached telemetry; no correctness or attribution failures.**

Run abcbfa6a-a6f9-484d-82e6-7844c07b9494; commit ad4a23241b7a351e2406fe555283f9e81591139a; fixture 5092dac18dfb0e21f03d559f7d4deb1c91f0ba60f03423c4db0445b962057acf.

2026-09-09T18:26:04.369Z; deployment lovable-donkey-430; payload field 2048 ASCII bytes; batches 64,8192; 3 rounds; order seed 73. Payload is not total document size. Stack: {"convex":"1.32.0","convex-helpers":"0.1.113","zod":"4.5.4","zodvex":"0.7.10"}.

56 calls including initial samples; 24 query capacity failures; 40.9 seconds including setup; 416628104 query read bytes (excludes setup/reference).

All profiles use one model. Lean imports one; models/registry import 32. Registry profiles load 128 additional unused schema entries. Native performs manual codec transformations without full modeled Zod validation.

| Variant | Rows | Verified | Timings / planned | Server ms median [Q1, Q3] | User ms median | Errors |
|---|---:|---:|---:|---|---:|---|
| native | 64 | 3/3 | 3/3 | 19.67 [18.39, 21.85] | 6.18 | none |
| native | 8192 | 0/3 | 0/3 | unavailable [unavailable, unavailable] | unavailable | read-limit, read-limit, read-limit |
| helpers | 64 | 3/3 | 3/3 | 25.80 [25.63, 29.89] | 14.97 | none |
| helpers | 8192 | 0/3 | 0/3 | unavailable [unavailable, unavailable] | unavailable | read-limit, read-limit, read-limit |
| full_lean | 64 | 3/3 | 3/3 | 30.35 [29.65, 32.89] | 18.22 | none |
| full_lean | 8192 | 0/3 | 0/3 | unavailable [unavailable, unavailable] | unavailable | read-limit, read-limit, read-limit |
| full_models | 64 | 3/3 | 3/3 | 39.59 [38.65, 45.59] | 27.78 | none |
| full_models | 8192 | 0/3 | 0/3 | unavailable [unavailable, unavailable] | unavailable | read-limit, read-limit, read-limit |
| full_registry | 64 | 3/3 | 3/3 | 54.55 [51.93, 54.65] | 41.67 | none |
| full_registry | 8192 | 0/3 | 0/3 | unavailable [unavailable, unavailable] | unavailable | read-limit, read-limit, read-limit |
| mini_lean | 64 | 3/3 | 3/3 | 32.69 [31.25, 35.87] | 19.59 | none |
| mini_lean | 8192 | 0/3 | 0/3 | unavailable [unavailable, unavailable] | unavailable | read-limit, read-limit, read-limit |
| mini_models | 64 | 3/3 | 3/3 | 37.04 [35.98, 42.90] | 24.31 | none |
| mini_models | 8192 | 0/3 | 0/3 | unavailable [unavailable, unavailable] | unavailable | read-limit, read-limit, read-limit |
| mini_registry | 64 | 3/3 | 3/3 | 43.57 [42.88, 44.84] | 33.34 | none |
| mini_registry | 8192 | 0/3 | 0/3 | unavailable [unavailable, unavailable] | unavailable | read-limit, read-limit, read-limit |

Server execution excludes client transport and the verifier action. User time excludes tracked system waits and is not OS CPU time. There is no measured heap or true cold-start claim. Largest successful batches are lower bounds for this fixture. This report was rendered from saved observations after review; original run artifacts are retained in the evidence archive.
