# Preserve terminal-specific read callback ordering

Accepted 2026-10-05 for [#163](https://github.com/panzacoder/zodvex/issues/163),
clarifying [ADR-0007](0007-boundary-contract.md). The internal read executor
preserves complete-layer processing for batch terminals and per-document
processing for iteration, including the switch to iteration made by rules-bearing
`first`, `take`, and `collect`. A uniform per-document pipeline would be simpler,
but would change callback side effects before later decoding or callback failures;
any future change requires an explicit compatibility decision and evidence about
consumer effects.
