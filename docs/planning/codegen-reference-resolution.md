# Codegen reference resolution

Design exploration for [#162](https://github.com/panzacoder/zodvex/issues/162),
2026-09-30. All seven interview decisions are settled and the user has confirmed
the shared understanding. Implementation and local validation are complete.
Pre-refactor reference: commit `2e65466`.

## Agreed scope

Deepen an internal reference-resolution module so generation receives resolved
function schema expressions, required imports, and helper declarations together.
The module owns matching, reference expressions, and import coordination;
generation owns file formatting, memoizing registry getters, and declarations.
Mutation may exist inside the implementation. The caller must not manage an
import ledger or know when its contents become complete.

Preserve emitted output byte-for-byte in full and mini modes. Preserve the
published `generateApiFile`, `zodToSource`, `CodecRef`, and
`ZodToSourceContext` contracts. A deprecation or migration is possible only with
strong evidence that preserving the interface prevents the desired depth; the
current production caller does not establish that need.

Land this refactor before [#157](https://github.com/panzacoder/zodvex/issues/157).
Emitter fidelity and validator-handler decoupling remain separate work.

## Responsibilities and constraints

- Return the complete resolution result instead of requiring the caller to
  resolve schemas and then read accumulated imports.
- Concentrate model identity, optional/nullable and partial matching, codec
  provenance brands, fingerprints, model codec extraction, and used-import
  selection behind the internal seam.
- Preserve exported-codec precedence over model extraction, same-source-file
  candidate preference, sorted tie breaking, and deterministic import/helper
  ordering.
- Keep schema references client-safe and preserve matching and unresolved
  function-codec rejection under [ADR-0005](../adr/0005-codec-provenance-brands.md).
- Preserve registry construction and declarations under
  [ADR-0008](../adr/0008-lazy-registry-getters.md), and the form-binding direction
  under [ADR-0009](../adr/0009-library-agnostic-form-binding.md).
- Keep fingerprint serialization independent of emitted-schema improvements
  according to [ADR-0010](../adr/0010-codec-fingerprints-independent-of-emission.md).
- Preserve current warnings, errors, and the published serializer's unresolved
  codec fallback and accumulated diagnostics behavior. Internal generation may
  hide those mechanisms without changing the exported context contract.

## Verification and completion

Generation should format a complete resolution result without managing identity
maps, import accumulation, codec sentinels, or reference lookup. Moving code to
another file while retaining those obligations in generation does not complete
the refactor.

Verify through the generation interface:

- Byte-identical output against the pre-refactor implementation, including both
  example registries and representative full/mini matching fixtures.
- Real codec transforms and per-entry memoized identity survive evaluation of
  generated output.
- Shuffled discovery collections retain deterministic output and reference
  selection, including same-file preference and sorted ambiguity fallback.
- Focused regression coverage establishes today's fingerprint behavior and
  proves changes to emitted-schema serialization cannot change it indirectly.
- Existing published serializer behavior remains covered, including context
  import accumulation and unresolved codec fallback.

Retain existing generation and evaluation tests. Replace tests of private
coordination only when equivalent observable coverage exists; exported context
behavior is part of the published interface, not merely a private detail.
Use the repository's local validation gate, which builds before checks consuming
`dist` and regenerates the examples. Generated-file freshness must remain clean.

## Implementation evidence

- `schemaReferences.ts` owns resolution and returns complete entries, imports,
  and codec declarations; `generate.ts` formats those values.
- `schemaShapeSource.ts` retains the original recursive shape policy.
  `codecFingerprint.ts` uses it directly, while the published `zodToSource`
  function remains the emission seam with its original context contract.
- Full/mini output fixtures were captured using the pre-refactor generator.
  Generation tests compare against them and evaluate codec transforms and lazy
  entry identity.
- A reversible experiment made the public emitter reject calls without an
  emission context. All 22 generation, determinism, and fingerprint tests still
  passed; the temporary change was restored before final validation. This
  verifies that matching no longer depends on that emission path.
- `bun run validate:local` passed: 2,442 library tests, 137 codemod tests, 126
  example tests, typechecks, build, consumer declarations, and unchanged generated
  files for both task-manager examples.
- Independent Standards and Spec reviews returned zero findings.

## Suggested follow-ups

These are retained exploration candidates, not changes authorized within #162.

### Serializer fallback and generation strictness

The standalone `zodToSource` serializer can return a wire-shape expression with
a transforms-lost comment for an unresolved codec. Generation separately rejects
unresolved function codecs detected by its preflight collection. Explore whether
an explicit strict mode or a future unified policy would make these differences
clearer. Any change must account for standalone consumers and the existing
fallback contract; it needs its own compatibility decision and tests.

### Diagnostics ownership and usefulness

`ZodToSourceContext.undiscoverableCodecs` is accumulated by serialization but has
no reader in generation today, and its entries carry an `unknown` field path.
Coordinate improvements with #157's proposed fidelity diagnostics: useful
function/field attribution, a complete returned diagnostic result, and a clear
distinction between codec failures and fidelity losses. Preserve the published
context until a separately justified migration is agreed.

### Published generation interface

The positional `generateApiFile` interface accepts five discovery collections,
which callers can forward incompletely. The production CLI currently forwards
all of them correctly. Revisit an additive complete-discovery entry point or
deprecation only if concrete caller mistakes or remaining coordination costs
justify the additional published surface and migration burden.

### Validator-handler decoupling

The existing [proposal](../issues/2026-06-08-validator-handler-decoupling.md)
could make schema references exact and reduce the need for inferred codec
matching. Keep that as a separate ergonomics and compatibility discussion;
this refactor preserves the current heuristic and its limitations.
