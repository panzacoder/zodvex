# Query terminal processing

Design exploration for [#163](https://github.com/panzacoder/zodvex/issues/163),
2026-10-02, decisions completed 2026-10-05. All nine interview decisions are
settled and the user has confirmed the shared understanding. Implementation and
local validation are complete.
Compatibility reference: commit `02f03c8`.

## Settled decisions

- Preserve current query behavior, including rule-filtered scanning for `first`
  and `take`, native uniqueness checks, shrinking pagination pages with unchanged
  metadata, awaited audit callbacks, and propagated callback failures.
- Preserve the published `ZodvexQueryChain` interface, including its constructor
  and subclass extension points, during this internal refactor.
- A later type/interface migration may be justified by improved developer
  experience. Gather concrete evidence here rather than requiring that the old
  interface prevent implementation before considering migration.
- Complete the internal migration before considering the proposed standalone
  rules/audit functions. Preserve or enforce Convex API boundaries in any future
  public migration. Write behavior is outside this issue.

- Preserve existing callback ordering and failure boundaries, including the
  distinction between complete-layer batch processing and per-document iteration.
  If investigation identifies credible negative effects of the current ordering,
  provide consumer-runnable diagnostics for the relevant throughput, collision,
  correctness, or concurrency scenario. Distinguish deterministic local evidence
  from measurements requiring a Convex deployment; do not presume harm.
- Use one internal query executor with explicit terminal semantics and ordered
  wrapper layers, retaining batch and streaming boundaries.
- Include shared decoding, rules, and audit handling for `get()` where it reduces
  duplication. Keep native lookup and ID/table resolution distinct from query
  execution; do not force lookup through query-specific machinery.

## Verification and completion

Preserve native query filter/index behavior and the unmodeled native-chain fast
path. Modeled reads retain full-document decoding; transformed rule results are
not automatically reparsed. Preserve nested counting restrictions and iterator
cleanup on early exit or failure.

Before removing implementation-facing tests, establish coverage through public
database APIs for terminal results, repeated rules/audit composition, complete
callback event ordering, failure side effects, decoding once, pagination metadata,
and iterator cleanup. Include shared read behavior for `get()` while preserving
its native lookup and ID/table resolution.

Completion requires clear internal ownership of query orchestration and shared
read processing. Callers must not replay wrapper constructors or supply placeholder
schemas. Preserve the published constructor, protected subclass hooks, and
intermediate-method behavior; compatibility checks must pass. Moving existing
duplication into another file alone does not satisfy the design.

## Follow-ups

- Record concrete public type/API migration opportunities, their developer
  experience benefits, compatibility costs, and Convex boundary implications.
- If credible adverse ordering scenarios emerge, supply consumer-runnable
  diagnostics and specify what deployment measurements are needed. Do not infer
  throughput or concurrency harm from callback ordering alone.
- Address [#164](https://github.com/panzacoder/zodvex/issues/164) next, then rerun
  the architecture review tracked by
  [#165](https://github.com/panzacoder/zodvex/issues/165).

## Verified compatibility facts

Current callback ordering depends on terminal choice and wrapper order. Repeated
audit layers process arrays one complete layer at a time for `collect`, `take`,
and `paginate`, but process each document through the layers during iteration.
Rules use iteration for `first`, `take`, and `collect`; pagination processes a
complete incoming page. An outer audit on a rules collection runs after all rules
finish; an outer rules collection can interleave inner audits with rules.

Batch decoding finishes before outer batch callbacks begin. Replacing this with
one per-document pipeline can introduce side effects before a later document's
decode failure. A flattened design must account for these existing boundaries.

Unmodeled base queries return the native chain. Modeled queries parse full
documents at the innermost layer; rule-transformed results are not reparsed.
Counting honors nested rules restrictions without invoking audit callbacks.

These details need public behavior coverage before replacing implementation-facing
chain tests. They are consistent with
[ADR-0007](../adr/0007-boundary-contract.md).

## Implementation and evidence

`internal/readQuery.ts` owns read layers, rule-result normalization, query
decoration, terminal cardinality, and batch/iteration boundaries. Rules and audit
append layers to an internal plan instead of constructing terminal subclasses
with passthrough schemas. The plan uses `Symbol.for` so composition does not depend
on entrypoint bundle class identity. The published query class retains its
constructor and protected hooks and delegates modeled read terminals to the
executor. External/consumer query implementations remain a source boundary, so
their overridden methods are not bypassed when decorating.

`get()` shares document processing while retaining its native lookup and existing
table resolution. Writes, unwrap, system access, and the unmodeled native-query
fast path retain their existing contracts. Callback compatibility is recorded in
[ADR-0011](../adr/0011-read-callback-ordering.md).

The direct internal rules-chain tests now exercise `withRules().query()` instead.
The expanded rules and query-correctness suites passed against the original
`02f03c8` implementation: 200 tests across full and mini projects. Deliberately
reversing audit document order caused all six batch-order cases to fail, and the
mutation was restored. These are characterization and sensitivity checks for a
behavior-preserving refactor, not a new-behavior red/green feature.

A further regression test first failed against the refactor when an unmodeled
audit callback appended to an externally retained native result array. Restoring
the old shallow snapshot before callbacks made it pass; the same test passes the
original implementation. Pagination likewise snapshots metadata before callbacks.
Both review axes rechecked this compatibility fix without findings.

`bun run validate:local` passed on the final source, including lint, source guard,
typechecking, build, library and codemod tests, consumer declaration checks, local
examples, and generated-file freshness. Lint reported six existing warnings.
Standards and Spec code reviews against `02f03c8` both reported zero findings.
Network deployment benchmarks were not run; no deployment performance claims are
made by this refactor.

No throughput, collision, correctness, or concurrency defect has been established.
Consumers can run the local ordering/failure reproductions with
`bun run test -- __tests__/rules.test.ts -t 'public read composition ordering'`
from this repository. They show what effects occur before a failure; they do not
measure deployed throughput, transaction conflicts, or retries. If consumers
report such an effect, reproduce their callback workload and wrapper order on a
configured Convex deployment before proposing an ordering migration.

Concrete public migration evidence: rule/audit reader `query()` methods still
return `any`, while the undecorated query class carries wire table types and decoded
document types separately. A future typed decoration interface could retain typed
filter/index builders and decoded terminal results, improving editor feedback and
catching invalid chains. A standalone-function call form alone does not solve
that type loss. Evaluate this alongside the roadmap proposal, with native query
operations, lookup overloads, pagination metadata, and consumer subclass
compatibility as explicit acceptance criteria. This issue changes no public
call form or deprecation policy.
