# Convex module-analysis retrospective

With the same CLI, Zod version and application, deployment analysis failed with
an OOM on the pre-fix backend **3/3 times**, then passed on the post-fix backend
**3/3 times**. Each successful push also passed two endpoint execution checks.
The six measured local pushes took about eight seconds combined. No application
data, hosted deployment or customer code was involved.

| Fixed input | Value |
| --- | --- |
| Runtime / CLI / Zod | Node 22.22.3 / Convex 1.32.0 / Zod 4.3.6 |
| Application | 256 independent query modules; one 32-string-field Zod object per module |
| Operation | Parse a fixed object and return the module index plus run number |
| Backend policy | Fresh isolates; `--expose-gc --trace-gc-nvp` on both binaries |
| Failure stage | `/api/deploy2/evaluate_push`, loading pushed modules, 64 MB OOM |

The pre-fix official binary is
[`precompiled-2026-04-24-a3b7db0`](https://github.com/get-convex/convex-backend/releases/tag/precompiled-2026-04-24-a3b7db0),
the exact parent of the
[per-module analysis change](https://github.com/get-convex/convex-backend/commit/a79bb12d7b51f2d7b92ac2792698a6aa212cf8cd).
The post-fix binary is
[`precompiled-2026-04-27-b603022`](https://github.com/get-convex/convex-backend/releases/tag/precompiled-2026-04-27-b603022),
12 commits after that change. This is a release-binary comparison corroborating
the documented fix; those additional commits prevent attributing every possible
backend difference to that one patch. It is not a reproduction of the original
issue reporter's undisclosed schema or exact hosted backend.

Initial exploratory pushes used 128 modules (pre-fix success) and 256 modules
(pre-fix OOM, post-fix success). Those round-0 reports are preserved. They selected
one useful failing case; no maximum module count or table ceiling was sought.
The measured rounds are **1–3**. Only the round number changes between repeats,
forcing fresh module analysis and letting query checks reject a stale deployment.
Pre/post source hashes match within every round. There are no database tables,
reads or writes. This isolates the historical *many-entrypoint analysis* problem;
it says nothing about the capacity of one endpoint importing the whole graph.

## Reproduce locally

Copy this directory outside the repository before installing dependencies. Use
its frozen lockfile and Node 22.22.3. Download the two official macOS ARM64 assets
from the releases above. Verified ZIP SHA-256 values:

```text
pre:  3a6d2db8a3d95360ae97c28f60e1df65ad5dd40b1b48ef93627077b8e08807c9
post: b0eeecbaac5d8db9e0c52a3e9c91883bdb19870c28dd8c9679ca571098e65518
```

Start each binary in a distinct fresh data directory using
[`memory/start-local.py`](../../../memory/start-local.py), with its matching
existing development admin-key file and separate loopback ports. The launcher
records binary digests, source revision and flags in `metadata.json`. The runner
only accepts a loopback backend; it reads the key from the backend directory and
passes it privately through the CLI environment.

```sh
bun install --frozen-lockfile --ignore-scripts
node run.mjs /path/to/pre-backend pre 256 1
node run.mjs /path/to/post-backend post 256 1
# Repeat the pair with run numbers 2 and 3.
```

`run.mjs` generates the modules and uses the actual push/analyze path. Each result
records input hashes, dependency/runtime versions, binary identity, CLI status,
sanitized output and query checks. An expected OOM is recorded as `status: 1` in
the JSON; the experiment driver itself completes so both outcomes can be compared.
Use these recorded fields, rather than the driver's exit status, to judge a push.
Stop both diagnostic backends afterwards.
