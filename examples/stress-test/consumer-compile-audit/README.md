# INCOMPLETE EXPERIMENT — PR #63 correctness audit only

**Do not rank this compiler beside codec-preserving memory variants.** This fixture demonstrates lost behavior; it is not a compiler implementation, production feature, platform benchmark, or comprehensive conformance suite.

The audit invokes the real, unmodified `runCompile` from draft [PR #63](https://github.com/panzacoder/zodvex/pull/63), pinned to `0e4ae596420619d86c13534d085526a1662643af`. A fresh process probes seven registered handlers before compilation, the compiler rewrites the fixture on disk, and a fresh process probes the rewritten handlers. An optional third probe runs the original fixture with the current foundation. The fixture disables database wrapping to isolate function arguments and returns.

From a foundation checkout containing this audit, prepare the current package and a pinned, isolated old checkout:

```sh
foundation_checkout="$(git rev-parse --show-toplevel)"
audit_checkout="$(mktemp -d "${TMPDIR:-/tmp}/zodvex-pr63-audit.XXXXXX")"
git worktree add --detach "$audit_checkout" 0e4ae596420619d86c13534d085526a1662643af
bun install --frozen-lockfile --ignore-scripts
bun run build
(cd "$audit_checkout" && bun install --frozen-lockfile --ignore-scripts && bun run build)
```

Run against both packages, keeping each run's output separate:

```sh
bun examples/stress-test/consumer-compile-audit/run.ts "$audit_checkout" "examples/stress-test/results/local/compile-audit-$(date +%s)" "$foundation_checkout"
```

The first argument is the old compiler checkout; the optional third argument is the foundation checkout (the second is the output directory). Without an output argument, it creates a unique run under `results/local/`; existing output directories are always rejected. Promote reviewed results separately. The runner creates isolated fixture directories under each checkout's stress-test workspace for package resolution, then removes only those created directories in `finally`. No source in the old library is patched. Results retain before/after fixture source, compiler logs and counters, observations, dependency versions, commit IDs, collector/template hashes and hashes of the actual built JavaScript. Child processes have a 60-second timeout. Failed child processes stop the audit and preserve logs and available source snapshots; successful compilation is required before any comparison.

The checks use Convex's registered `_handler` seam and its real `convexToJson` serializer, not a fake compiler or hand-written replacement. They do not run native server argument/return validators or deploy to Convex. Inputs have representable wire structure; the refinement case remains a valid native string. Unsupported class/Date returns are observed locally through the native serializer. Default omission is a valid generated optional argument, but the resulting undefined return is invalid for the emitted string return validator.

See the [recorded report](../results/compile-experiment-2026-09-09/README.md). No memory or latency conclusion follows from these checks.
