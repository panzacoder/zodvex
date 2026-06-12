# Per-endpoint model registration — letting codecs scale to the floor

Status: PLAN (2026-06-12). Target: post-#80. Owner decision points marked ⚖️.

## Problem and stakes (measured)

Codecs are zodvex's product, and every codec-on consumer shape today
centralizes the model graph into one module every endpoint imports
(`schema.ts` via `defineZodSchema` on main; `_zodvex/server.ts`'s static
tableMap on the overhaul branch). Under Convex's per-entrypoint analysis
(post convex-backend#414), each endpoint's 64 MB isolate therefore
evaluates EVERY model's zod field objects (~0.2–0.3 MB per model, zod v4):

- codec-on ceiling today: **~100–150 models full-zod, ~300 mini**
  (real-deploy, `results/where-we-sit-2026-06-12.md`)
- the same library with no centralized graph (floor shape): **750, ending
  at Convex's own TooManyReads wall — exact pure-convex parity**

The gap is the import topology, not the codec runtime. Fix: each
endpoint's isolate registers only the models it already imports, and the
DB wrapper reads a per-isolate registry instead of a centralized map.

## Mechanism

### 1. Registration at model definition (library)

`defineZodModel(name, fields, …)` registers the model into a per-isolate
global as a side effect of module evaluation:

```ts
const REGISTRY = Symbol.for('zodvex.tableRegistry')   // robust across
                                                      // duplicated module
                                                      // instances/chunks
type TableRegistry = Map<string, AnyZodModelBase>
;(globalThis as any)[REGISTRY] ??= new Map()
```

- Registers the **model reference**, not built schemas — `doc`/`insert`
  build lazily through the existing `zx.doc()` / `zx.base()` WeakMap
  caches on first DB access to that table. Import cost stays what the
  endpoint already pays for its validators.
- Static imports evaluate before any handler runs, so registration order
  is never a problem within an isolate.
- Client-safe: registering on the client is a no-op cost (and potentially
  useful later for client-side codec lookup).
- Test/HMR hygiene: export an internal `__resetTableRegistry()`.

### 2. The DB wrapper reads a live registry view (library)

`initZodvex` (and the generated `server.ts`) passes a tableMap **Proxy**
backed by the registry: `tableMap[name]` resolves at call time, builds
`{doc, insert}` lazily via `zx.doc/zx.base`, and caches per model. The
existing `ZodvexDatabaseReader/Writer` code paths don't change — they
already do `this.tableMap[tableName]` lookups per call.

Precedence in `initZodvex`: `options.tableMap` (explicit) →
`schema.__zodTableMap` (legacy defineZodSchema) → **registry view (new
default)**.

### 3. The semantic key: a static per-table manifest (codegen)

Without more information, a registry miss is ambiguous: "table has no
codecs (passthrough is CORRECT)" vs "table has codecs but this endpoint
never imported its model (decode would be silently SKIPPED — the exact
footgun class we just eliminated elsewhere)". The wrapper can't know
without the model… but **codegen can**, at generate time, with zero zod:

```js
// _zodvex/tables.meta.js (generated — tiny, no zod, no model imports)
export const tableMeta = {
  tasks:   { hasCodecs: true },
  users:   { hasCodecs: true },
  configs: { hasCodecs: false },
  // every table; ~30 bytes each
}
```

`server.ts` imports it statically (negligible) and passes it to
`initZodvex`. Wrapper behavior on registry miss:

| manifest says | behavior |
|---|---|
| `hasCodecs: false` | passthrough (provably correct) |
| `hasCodecs: true` | ⚖️ **throw by default** (configurable `onUnregisteredCodecTable: 'throw' \| 'warn'`), message: "table 'X' has codec fields but its model is not loaded in this isolate — import XModel in this module (a type-only import does not count)" |
| table unknown (dynamic name, no manifest entry) | passthrough + the same configurable warn |
| no manifest at all (legacy/non-codegen init) | current behavior unchanged (silent passthrough) |

`get(id)` table resolution: today `resolveTableName` iterates the
tableMap's names. With a partial registry it must iterate the
**manifest's** name list instead (all tables, names only — no schemas),
so unregistered codec tables are still *detected* on the `get(id)` path.

### 4. `server.ts` v2 (codegen)

Drops the all-models import block and the static `_tableMap` literal.
Keeps: ctx types (type-only — erased, free), the pre-wired `initZodvex`
(now passing the manifest + registry-view defaults), the lazy full
registry (actions) + static args-only registry (mutation scheduler), and
the codec-aware `schema` re-export (backed by the registry view).
`tables.ts` (schema isolate) and `DecodedDocs` are unchanged.

Expected per-endpoint graph afterward: own models + zodvex runtime +
args-only registry — the floor topology plus O(own models), i.e. the
750-parity capacity becomes consumable by the codec-on shape. (The
args-only registry remains O(total functions) ≈ 0.2 MB per endpoint-file
at N=200-scale — fine to a few thousand functions; a later optimization
can restrict it to codec-args functions only.)

## Edge cases

- **Type-only model imports are erased** → not registered → throw (with
  the explicit "type-only import does not count" hint). Diagnosable, and
  rare: endpoints that read table X virtually always use X's model in a
  validator (a value position).
- **Cross-table reads** (get(id) of a table whose model isn't imported):
  detected via manifest-name resolution; throws/warns per config instead
  of silently returning wire data.
- **rules/audit wrappers** (`.withRules()`, `.audit()`): construct from
  `_internals` (db + tableMap) — the Proxy view passes through unchanged.
- **Multiple zodvex copies in one isolate** (pathological bundling):
  `Symbol.for` keys a single registry regardless of module identity.
- **Legacy shapes**: defineZodSchema consumers keep `__zodTableMap`
  (full map, old ceilings, old semantics) — no breaking change; the win
  is opt-in via the codegen shape.

## Phasing

1. **Library**: registry + registration in `defineZodModel`, registry
   view + manifest semantics in `initZodvex`/db wrapper, unit tests
   (registered decode, miss+manifest matrix, get(id) resolution,
   type-only-import failure mode, reset helper).
2. **Codegen**: emit `tables.meta.js`; `server.ts` v2; migrate stub
   writers; determinism tests.
3. **Harness**: new compose shape `registered` (the v2 consumer shape);
   healthcheck gains an unregistered-codec-table assertion (expects the
   throw). Ladder zodvex+mini at 200/400/600/750/800 — **acceptance: the
   codec-on `registered` shape matches the floor (750 ok / TMR 800)**;
   per-axis bench to confirm O(own models).
4. **Examples + docs**: migrate task-manager/task-manager-mini, codegen
   guide, CHANGELOG TL;DR becomes the real product claim.
5. **Gate**: `validate` regression switches its product gate from
   consolidated@100 to registered@600.

## ⚖️ Decisions for Jake

1. **Default on unregistered codec table: throw or warn?** Plan says
   throw (loud beats silent wire-data corruption; warn is one option
   flag away). This is the only real API-feel decision.
2. **Does `defineZodModel` always register, or only server-side?**
   Plan: always (harmless, simpler, no env detection).
3. **Keep `consolidated` (all-models static) as an emitted option** for
   small apps that want zero edge cases, or make `registered` the only
   v2 shape? Plan: registered-only, since the throw semantics make its
   edge loud, and one shape is one story.
4. Naming: `tables.meta.js` / `onUnregisteredCodecTable` placeholders.
