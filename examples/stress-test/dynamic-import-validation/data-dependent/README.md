# Data-dependent dynamic-import variant

Where the sibling experiment (`../sweep.ts`) imports models by index to prove the
*memory* premise, this one validates the part that matters for zodvex's codec
path: **selecting a table module by a runtime table name** (the data-dependent
FK-follow pattern) and **decoding a real wire doc through the lazily-imported
schema** — proving a dynamically loaded model decodes identically to a
statically imported one, across varied codecs.

## Why it matters

In a real query/mutation, `ctx.db` doesn't know which tables a transaction will
touch — an FK follow can land in any table. So the table module must be selected
by a runtime value, not a static import. This variant exercises exactly that:
the action receives a touch-set of table names and `import()`s only those.

## Codec coverage (stamped from the task-manager archetypes)

| archetype | codecs exercised |
|---|---|
| task | `zx.date`, `zx.id`, **`zDuration`** (number → `{hours,minutes}`), nullable, optional |
| user | `zx.date`, **`taggedEmail`** (`{value,tag}` → `{value,tag,displayValue}`) |
| activity | **`zDuration` nested inside a discriminated-union field**, `taggedTag[]`, `zx.id` |
| comment | `zx.date`, **slim model** (`schemaHelpers: false`) |
| notification | **top-level discriminated-union table**, `zx.date` in variants |

## Running

Local correctness (no Convex — proves the fixtures/assertions and decode path):

```bash
cd examples/stress-test
bun run div:datadep:validate
# expect: 5 passed, 0 failed
```

Real deploy — correctness pass (one runtime-selected table per archetype) +
memory pass (count ladder):

```bash
bun run div:datadep --models=750
```

## Reading the result

- **Correctness pass:** `passed=5, failed=0` — every archetype decodes correctly
  through a model that was selected by table name and dynamically imported at
  runtime. This is the new evidence: the lazy path is functionally identical to
  the static one, including the hard cases (codec nested in a union, top-level
  union, slim model).
- **Memory pass:** `evaluated` tracks touched-K and OOMs around the same
  ~150–200 ceiling as the index-based experiment — now with a real decode
  workload, confirming decode adds no surprise cost.

Results land in `../results/div-datadep-*.json`.

## What this does NOT cover

The action simulates the selection + decode that `ctx.db` performs, but it is not
`ctx.db` — actions have no database handle. The remaining integration (wiring this
lazy resolver into `ctx.db` inside a real q/m) is blocked until Convex enables
`import()` in queries/mutations, and carries the synchronous index-builder wrinkle
noted in the chat thread (`db.query(...).withIndex(...)` needs the schema
synchronously). That's the only piece that must wait.
