# Codec-paths productionization — the path forward (#80 rework)

Status: PHASES 0–3 COMPLETE (2026-06-13, acceptance met cell-for-cell — sweep-codec-paths-{production,final}-2026-06-13.json); Phase 4 docs done, MERGE + beta + hotpot trial pending Jake. Decisions below are Jake's, made 2026-06-12/13.
Supersedes the mechanism in `per-endpoint-model-registration.md` (kept for the
hazard analysis; its registration mechanism is retired).

## Context (proven, not hypothesized)

All real-deploy, codecs-on, full zod, measured 2026-06-12 on
`dev:first-skunk-786` (raw data + writeups in `examples/stress-test/results/`):

- Centralized model graph (main 0.7.5 documented shape AND #80's consolidated
  `server.ts`): **OOM at ~150 models** (~300 mini). Cause: every endpoint
  isolate evaluates all models (~0.25 MB each, zod v4) + registry.
- **Codec-paths spike (`--shape=codec-paths`): clean N=200→750,
  TooManyReads at N=800 — exact pure-convex parity** (same wall, same N,
  same day). Relational probe `decoded: true` with the API unchanged.
  ~0.04 MB/table (loose-zod descriptors); cliff extrapolates to ~N=1,400,
  past Convex's own wall.
- Per-endpoint registration spike: proved the topology hypothesis (≥800).
  Retired — NOT for the silent-miss it showed (that's specific to the
  naive old-`db.get(id)` shape; enforced `db.get(table, id)` + a manifest
  make misses loud, see the 2026-06-15 correction in
  `per-endpoint-model-registration.md` and `relational-codec-miss-…md`).
  Retired because it reaches the SAME N≈800 ceiling as codec-paths while
  costing import discipline + a consumer-migration dependency; codec-paths
  reaches it as a drop-in central map.

## Decided design

Codegen emits one descriptor per codec-bearing table at
`_zodvex/models/<table>.ts` — a **minimal loose zod schema containing only
codec fields** (unknown keys pass through) — plus `_zodvex/models/index.ts`
statically importing them all. The index is the **central tableMap**: the
global decode contract, `db.get(id)`, relational lookups, rules/audit all
keep today's semantics at ~zero weight.

Decisions locked:
- **String table names only** (`db.get('users', id)`), tracking Convex's
  `db.get(table, id)` migration (news.convex.dev/db-table-name). NO
  `db.get(UserModel, id)` overload — types are already precise via literal
  names + `DecodedDocs`; a model arg would re-inflate endpoint graphs.
- Deprecate-then-remove ID-first db ops in zodvex's wrapper, on Convex's
  schedule (their ESLint rule + codemod migrate consumer code).
- Loose-zod descriptors are sufficient (cliff past the platform wall); a
  pure path-walker is a later optimization, not required.
- `consolidated` (all-models static map in `server.ts`) is retired as a
  product shape; legacy `defineZodSchema` explicit path keeps working
  unchanged.

## Phases

### Phase 0 — substrate: SDK bump + latent bug (first rework commits on #80)

1. Bump `convex` 1.32 → 1.41 and `convex-helpers` → ≥0.1.107 across the
   workspace (peer floors too if needed; check `_generated` interplay with
   1.35's ComponentApi codegen change — expected no-op, verify).
2. **Fix `wrapRun` option-dropping** (`internal/actionCtx.ts`): Convex 1.41
   `runQuery`/`runMutation` accept an options arg (`transactionLimits`);
   our wrapper does `fn(ref, wireArgs)` and drops the rest. Forward
   `...rest`, encode only `rest[0]`. Unit test.
3. Harness: one calibration cell per shape post-bump (cache invalidates via
   version stamps automatically). DONE 2026-06-13: all 5 zodvex shapes +
   parity clean at N=20 on 1.41. Healthcheck now returns
   `ctx.meta.getTransactionMetrics()` — CORRECTION vs the original plan:
   this describes the healthcheck's OWN transaction (limit constants +
   runtime usage; e.g. databaseQueries limit 4096 = the TooManyReads
   constant), NOT deploy-time finish_push proximity, which remains
   unmeasurable from inside (tracked as a platform ask).

### Phase 1 — codegen: real descriptor emission

1. `generateModelDescriptors(models, modelCodecs)` in
   `public/codegen/generate.ts`: map discovery's `modelCodecs` access paths
   (schema-structure paths) to data paths; build the minimal loose schema
   per table. Handle: optional/nullable wrappers, arrays (`'*'` segments),
   nested objects. Unions: emit the codec at each branch path if
   unambiguous, else fall back (see 3).
2. Codec references: reuse the api.js resolution rules (standalone export /
   branded factory → import; `zx.date()` → construct inline). The
   importable-codec constraint is already enforced for api.js.
3. **Graceful fallback per table**: if a table's codecs can't be expressed
   (inline-only codec, ambiguous union path), that table's descriptor
   imports its model and exports the full `{doc, insert}` — per-table cost,
   never a cliff, with a generate-time note.
4. Emit `_zodvex/models/*.ts` + `index.ts`; add to `writeStubApi`
   bootstrap + stale-file cleanup; determinism (sorted, byte-stable).
5. **Staleness guard**: index embeds a fingerprint of each table's codec
   paths; `initZodvex` (server.ts path) compares against models it CAN see
   cheaply at runtime... (spike the cheap check; if nothing cheap exists,
   `zodvex generate` watch + a CHANGELOG'd "re-run generate" note suffice
   for v1).

### Phase 2 — server.ts v2 + library

1. `generateServerFile`: drop the all-models import block + `_tableMap`
   literal; default `tableMap: () => descriptorIndex` (static import of
   `./models/index.js`). Keep: ctx types, split registry (lazy actions /
   static args-only scheduler), schema re-export backed by the index.
2. Library `initZodvex`: no changes expected (descriptors ARE valid
   `ZodTableSchemas`); verify `encodePartialDoc` + index-range encoding +
   rules/audit against descriptor entries (unit tests: loose-schema
   tableMap through reader/writer/chain).
3. Tests: codegen emission (paths, fallback, determinism), descriptor
   round-trip (decode/encode/partial), staleness fingerprint.

### Phase 3 — acceptance (the spike numbers are the bar)

1. Harness `codec-paths` shape switches from compose-regex descriptors to
   **the real `zodvex generate` output** (delete the spike emitter).
2. Ladder: zodvex + zodvex-mini, N=200,400,600,750,800 — accept iff
   cell-for-cell ≥ the 2026-06-12 spike (clean ≤750, TMR @800) AND the
   relational probe returns `decoded: true` AND healthcheck (decode +
   scheduler) passes every cell.
3. `validate` gate: product gate becomes `regression --shape=codec-paths
   --target=600`; keep floor\@600 as capacity diagnostic; drop
   consolidated\@100.

### Phase 4 — docs, examples, merge

1. Migrate task-manager + task-manager-mini + quickstart; `zodvex migrate`
   rewrites; codegen guide + README + CHANGELOG TL;DR (the product claim
   becomes "codecs at pure-convex parity", with the measurement links).
2. Merge order: **#81 (harness) → reworked #80**. Rebase #80 on main after
   #81; its harness commits collapse. #79 (streams) sequencing per Jake.
3. Send the revised Ian draft (platform asks downgraded to nice-to-haves;
   add `getTransactionMetrics` thanks + the lazy-module ask as future-proofing).

## Backlog (explicitly deferred)

- Maintain `docs/platform-asks.md` — the ledger of Convex-side changes that
  would dissolve our workarounds (dynamic import in V8, bundler plugin
  surface, zod-as-boundary-validator, shared-module memory tier). Update it
  whenever a workaround lands; revise + send the Ian draft off it.

- Pure path-walker descriptors (perf optimization; not needed for parity).
- `getFunctionMetadata()` for richer error messages.
- AsyncLocalStorage for rules/audit context (doesn't thread run* calls).
- `import "server-only"` markers on server entries.
- Harness on local deployments (`npx convex deployment create local`) —
  speed + stops sharing `first-skunk-786` with task-manager.
- Stale March PRs triage (#43/#45/#47 rebase-or-close; #51 RFC; #63 close
  as superseded-with-credit; delete `claude/convex-memory-budget-fctac` +
  local tag `v0.7.1-beta.20`).
- Parked missing-registry warning (worktree `claude/adoring-gagarin-5ef63d`,
  c3f369c) — likely moot once server.ts auto-wires; close out during Phase 4.

## Open items needing Jake

- Phase 1.5 staleness guard: how loud (boot-time throw vs warn) once the
  cheap check is spiked.
- #79 merge order relative to reworked #80.
- Whether quickstart adopts codegen or stays minimal (`registry: false`).
