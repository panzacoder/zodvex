# INCOMPLETE EXPERIMENT — park PR #63 compile-away

**Decision: exclude this implementation from codec-preserving memory rankings. Do not port the compiler as a production feature.** Its real output removes supported function-boundary behavior. A future compiler would need to preserve those boundaries or reliably leave unsupported endpoints unchanged before performance comparisons are meaningful.

On 2026-09-09, the unmodified compiler at `0e4ae596420619d86c13534d085526a1662643af` rewrote this seven-endpoint fixture: **2 files changed, 8 calls transformed (7 endpoints and 1 schema), 0 skipped**. Its source header says codec/refinement endpoints are left intact, but the tested implementation did not do so. `resolveFunctionToConvexSource` maps args/returns to native validators (compile.ts lines 566–609); endpoint rewriting replaces the Zodvex builder with a native builder (lines 826–831), without retaining parsing/encoding.

| Probe | Original PR #63 runtime | Compiled PR #63 output | Foundation 1f415c4 |
| --- | --- | --- | --- |
| Plain string control | `control` | `control` | `control` |
| Date argument `1000` | Handler sees Date | Handler sees number | Handler sees Date |
| Ticket class argument | Handler sees Ticket | Handler sees string | Handler sees Ticket |
| Date return | Encoded number `1000` | Date; native serializer rejects | Encoded number `1000` |
| Ticket return | Encoded `ticket-1` | Ticket; native serializer rejects | Encoded `ticket-1` |
| Invalid refined string | Throws args validation error | Returns `invalid` | Throws args validation error |
| Missing defaulted argument | Supplies `filled` | Handler receives undefined | Supplies `filled` |

**14/14 audit assertions passed:** seven assertions establish the original/compiled observations (one control plus six behavior losses), and seven verify that foundation observations agree with the old runtime's precompile behavior. These are negative characterization checks, not 14 compiler conformance passes. There were 21 handler invocations across the three probes. No production tests or hosted deployment ran.

The [current boundary contract](../../../../docs/decisions/2026-09-07-boundary-contract.md) distinguishes native wire validation from Zod parsing, codec decoding/encoding, refinements and defaults. Replacing the latter with native validators changes that contract. The third probe establishes agreement for these seven cases only; it does not certify the entire old runtime as equivalent to current Zodvex.

## Versions and limits

- Compiler/library: old draft PR #63, Zodvex package version `0.7.1-beta.20`, Zod `4.3.6`, Convex `1.32.0`, convex-helpers `0.1.113`.
- Foundation: `1f415c47fa7659c860a3a813cb371020bde53c94`, Zod `4.5.4`, Convex `1.32.0`, convex-helpers `0.1.113` resolved in this stress-test workspace.
- Runtime: Bun `1.3.9`, macOS arm64. Both frozen-lockfile installations and full package builds completed successfully. The compiler was imported from its actual source, using its installed dependencies; fixtures used built package exports.
- The old lockfile and runtime were deliberately retained. This is a behavior audit, not a matched-version performance experiment. Current guarantees come from the foundation contract, not assumptions about the old library.
- No modeled DB reads/writes, rules, audit callbacks, custom contexts, registry calls, async schemas, union/default combinations, partial patches, mini schemas, compiler safety classification, bundle size, heap or deployment behavior were tested. No old stress harness was revived.
- `_handler` calls bypass native server validators. Native value serialization was checked separately with `convexToJson`. In particular, no deployed server error text or platform-capacity claim is asserted.

Raw evidence: `before.json`, `after.json`, `current-foundation.json`, `compiler-result.json`, `compiler.log`, `summary.json`, and `before-source/` / `after-source/`. `summary.json` records compiler, serializer, lockfile, collector/template and actual built JavaScript SHA-256 values. Fixture source and the reproducible runner live in `../../consumer-compile-audit/`.
