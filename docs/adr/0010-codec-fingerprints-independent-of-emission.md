# Keep codec fingerprints independent of schema emission

Date: 2026-09-30

Status: accepted; implemented for [#162](https://github.com/panzacoder/zodvex/issues/162).

Codec fingerprints participate in choosing an importable codec reference, so changes to emitted schema fidelity must not implicitly change fingerprint equivalence. The reference-resolution refactor will preserve the current fingerprint behavior independently of schema emission, allowing [#157](https://github.com/panzacoder/zodvex/issues/157) to improve emitted schemas without changing matching as a side effect. Fingerprints retain their existing limitations; this decision preserves [ADR-0005](./0005-codec-provenance-brands.md) and leaves validator-handler decoupling as separate work.
