# Same-build memory repeatability — 2026-09-09

Six complete collections exercised the new before/after protocol using **the same
built library**. The first three are labeled baseline and the last three candidate;
no optimization occurred between them. Each collection used a fresh isolate for
each of eight calls: zero and 128 background models in native, helpers, Full and
Mini, at width 32 with the codec-rich shape and zero registry entries.

The local backend, dependencies, fixture, collector and built JavaScript digest
matched across all six. Every codec oracle, source hash, GC record and completion
check passed. Across these collections, the matched-zero deltas varied by hundreds
of bytes or less while the Zod-based graphs retained roughly 18–25 MiB. The Full
baseline-to-candidate median changed by -24 bytes. This is observed variation from
one host/session, not evidence of an improvement or a universal noise threshold.

[comparison.md](comparison.md) and [comparison.json](comparison.json) hold exact
medians, ranges, deltas and build/backend identities. [evidence.tar.xz](evidence.tar.xz)
contains all six original result directories and the collector/comparator source;
[SHA256SUMS](SHA256SUMS) checks the files. Its inputs are synthetic benchmark graphs,
not customer schemas, and no credentials or environment files are included.

After extraction, recheck with the repository's comparator:

```sh
bun /path/to/zodvex/examples/stress-test/memory/compare.mjs \
  --baseline=baseline-1,baseline-2,baseline-3 \
  --candidate=candidate-1,candidate-2,candidate-3
```

Use the [comparison protocol](../../memory/comparison.md) for later changes. Repeat
small apparent differences and preserve native/helpers controls. An intentional
dependency or backend change is a separate experiment; do not attribute its effect
to Zodvex alone. This protocol measures retained graph bytes. Hosted OOM brackets
and an eager-versus-lazy initialization experiment remain separate questions.
