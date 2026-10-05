# Discovery environment lifetime

Design exploration for [#164](https://github.com/panzacoder/zodvex/issues/164),
2026-10-05. All nine interview decisions are settled and the user has confirmed
the shared understanding. Implementation and local validation are complete.
Compatibility reference: `7e0eb4c`.

## Settled decisions

- Preserve published codegen interfaces and successful generated output while
  fixing temporary-file restoration.
- Include `_generated/api.ts` discovery replacement and `_zodvex/api.js` plus
  `api.d.ts` generation bootstrap replacement under one internal lifetime owner.
  Cover setup, enumeration, imports, generation, and output-write failures. The
  rollback includes all eight generated outputs on failure.
- Retain Node and Bun support, one project per discovery process, and fresh
  subprocesses for watch regeneration. Concurrent discovery and reusable
  multi-project processes are outside scope.
- On output failure, restore all eight outputs to previous bytes or previous
  absence. Remove directories created by the operation only when empty. This
  provides rollback, not atomic visibility to concurrent readers.
- Attempt every restoration even if one fails. Report operation and restoration
  errors together while keeping the original failure identifiable. Cleanup
  failure after otherwise successful discovery is an operation failure.
- Keep Node loader hooks and physical stubs with shared Proxy semantics. Keep
  adapter details internal, preserving alias resolution and import-failure
  policy. Loader registration and module caches remain process-lifetime state.
- Reject discovery for a different project in an already claimed process before
  filesystem mutation, directing callers to a fresh process. Same-project calls
  retain existing module-cache limitations.

## Verification and completion

Test through `discoverModules()` and generation on temporary projects. Verify
byte-for-byte restoration and previous absence on success and on partial setup,
enumeration, strict import, generation, and output-write failures. Cover cleanup
failure reporting and continued restoration of remaining files. Preserve existing
nonempty directories and remove operation-created directories only when empty.
Inject failures at filesystem/enumeration boundaries without mocking internal
modules.

Use real Node and Bun subprocesses for alias resolution, shared Proxy stub
behavior, fresh-process regeneration, and rejecting different-project reuse.
Preserve published signatures, successful output, and the existing import-failure
escape hatch. Neither filesystem restoration nor rejecting project reuse promises
to undo loader registration, imports, or module evaluation side effects.

Completion requires one internal environment owner controlling temporary
replacements and output rollback. Discovery and CLI callers must not manage stub
setup/cleanup closures. Consolidate Proxy stub behavior and remove duplicate alias
test logic only after replacement coverage exercises production resolution.
Preserve alias semantics rather than expanding their supported syntax.

Crash recovery, concurrent generation, atomic visibility to concurrent readers,
and process isolation for module side effects are outside scope. After #164,
rerun the architecture review tracked by
[#165](https://github.com/panzacoder/zodvex/issues/165).

## Verified facts

The current discovery stub is written before enumeration enters its restoring
`try/finally`; stub setup itself can also fail before cleanup is returned. CLI
bootstrap writes happen before its restoring catch, and final output writes happen
after it. Read errors are currently treated as missing originals; restoration
must distinguish absence from failures to read a snapshot before replacing files.
Neither helper removes newly created directories.

Node loader registration captures the first project's aliases for process
lifetime. Physical stubs are installed even when loader registration succeeds.
Watch regeneration already launches a fresh subprocess because imported modules
are cached. These facts motivate separate filesystem and process-lifetime rules.

## Implementation evidence

`discoveryEnvironment.ts` owns process project claims, byte snapshots, temporary
replacement setup, complete restoration attempts, bootstrap setup, and writes of
the eight generated outputs. `discoverModules()` supplies discovery work inside
the environment; the CLI supplies generated content and receives the discovery
result after output completion. Neither caller manages cleanup closures.

Project claims and hook registration use `Symbol.for` state on `globalThis` so
entrypoint bundles share process ownership without class identity checks. A new
project is rejected before bootstrap or discovery writes. The owner does not
unregister loaders or clear import caches.

The Node loader and physical file adapter now consume one Proxy stub source.
Loader alias expansion serializes the existing closure-free `matchAlias` function
instead of maintaining an independent JavaScript copy. Existing alias tests now
cover the function actually used by production; subprocess tests exercise its
loader execution. Alias parsing rules are unchanged.

Public operation tests cover partial stub and bootstrap writes, enumeration
failure, strict and permissive import behavior, schema-generation failure, all
eight output-write failure positions, unreadable snapshots, prior absence,
nonempty directories, continued restoration after failures, and combined error
messages. Newly created empty directories remaining after a failed generation and
combined messages omitting failure details were each observed red before fixes.
Filesystem and third-party enumeration boundaries are mocked; internal modules
are not.

Real built CLI/codegen subprocess tests pass under Node 26.3.0 and Bun 1.3.8,
including full/mini generation, aliases, nested Proxy calls, byte restoration,
fresh-source regeneration, and different-project rejection. Bun's native resolver
requires the fixture's explicit baseUrl and does not support the Node loader's
wildcard-suffix case; that case is verified under Node rather than introducing new
Bun resolution behavior here. Component fixtures now run in a separate test file,
and restoration tests reuse one project path per worker to honor process ownership.

`bun run validate:local` passed, including lint, source guard, typechecking, build,
the full library/codemod suites, consumer declarations, local examples, and
generated-file freshness. Lint retained six existing warnings. Standards and Spec
reviews of the change against `7e0eb4c` both reported zero findings. No network
deployment is needed to establish filesystem restoration or runtime loader
behavior, and no deployment performance claim is made.
