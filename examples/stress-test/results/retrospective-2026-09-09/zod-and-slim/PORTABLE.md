# Offline verification and local reproduction

Copy this directory outside a Git checkout. `raw-evidence.tar.xz` contains the
final 18 collections, every emitted synthetic bundle, 255 unique resolved input
contents keyed by SHA-256, and the frozen Zodvex JavaScript build. It contains no
admin key or backend database. The earlier completed two-version study is retained
in a separate archive and is not pooled into the final report.

Verify without installing packages, downloading a backend, or accessing a network:

```sh
tar -xJf raw-evidence.tar.xz
node analyze.mjs
```

The verifier checks all 144 calls against the independent graph oracle, matches
saved major-GC excerpts, checks source/input/manifest/call hashes, enforces the
fixed non-experimental contract, recomputes every matched control subtraction,
and regenerates `retrospective.json` and `retrospective.md`. Recorded absolute
input paths are labels; archived content hashes make verification portable.
Use Node 22 or newer. Node's version used for offline arithmetic does not change
the original Bun collector or backend identities saved in the report.

To recollect, install the pinned dependencies in this disposable copy:

```sh
bun install --ignore-scripts
bun install --cwd versions/4.3.6 --frozen-lockfile --ignore-scripts
bun install --cwd versions/4.4.3 --frozen-lockfile --ignore-scripts
bun install --cwd versions/4.5.4 --frozen-lockfile --ignore-scripts
```

The original bundler obtains esbuild 0.27.0 through Convex 1.32.0; check the emitted
manifest before comparing. Use Bun 1.3.9 on macOS ARM64 and the exact backend binary
identified in README.md to reproduce this runtime combination. Start that binary
with `memory/start-local.py`, a private existing development admin-key file and a
new backend data directory on dedicated loopback ports. The launcher does not
create accounts or download binaries.

The portable bundle preserves the exact collected instrumentation. `adapt.py`
records the original transformation of canonical sources; `instrumentation.patch`
is the complete diff. Neither needs to run again. `run-study.mjs` records the
original execution driver and its local backend path; update that explicit path
to the new backend directory before recollecting, and preserve old results first.
Alternatively call `memory/local.mjs` for each cell using the environment
variables and dimensions shown in README.md. The alias explicitly selects one
Zod package root for every bundled import, including dependency imports.

New results have new source input paths and timestamps. They are an independent
reproduction, not byte-identical artifact files. The measured library build and
other fixed contract values must still match. No hosted push is needed.
