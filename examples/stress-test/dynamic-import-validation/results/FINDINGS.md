# Findings — dynamic-import memory validation

First real run: 2026-06-18, Convex dev deployment `dependable-marmot-958`
(panzacoder), harness git `03fd96a`. Raw JSON: `div-dynamic-750-*.json`,
`div-static-*.json`.

## Result: premise confirmed

| step | result |
|---|---|
| proxy (local Bun) | heap ~0.24 MB/model, tracks K not 750 — deferred eval confirmed |
| dynamic, N=750 deployed | deploy **ok**; `loadSubset` ok ≤ K=150, OOM (64 MB) ≥ K=200 |
| static eager | deploy ok ≤ N=150, OOM (analyzer) at N=200 (cliff) |

**Subset import avoids the unimported-model cost.** 750 models deployed;
K=150 runs comfortably (~1 s), so the ~600 unimported models cost nothing. An
eager build of 750 can't even deploy — the analyzer cliffs at N=200. The OOM
threshold is set by **evaluated-K**, fully decoupled from deployed-N=750. All
high-K OOMs surfaced `JavaScript execution ran out of memory (maximum memory
usage: 64 MB)` and classified cleanly (verified against a real runtime OOM).

## Correction to the original expectation

The README originally expected the static baseline to OOM at a *much lower* N
than the dynamic K-threshold. It does **not** — they coincide (~200). Both hit
the same ~64 MB / ~0.3 MB-per-model per-isolate eval ceiling. This lean action's
ceiling (~200) is slightly *higher* than the historical consolidated-shape cliff
(~150) precisely because it carries no args-registry/schema overhead — which
reinforces that **model evaluation is the dominant term**.

**The real distinction is not a lower ceiling — it's when/whether you pay it:**

- **Static (eager):** evaluates ALL N at analyze time → cannot deploy past ~the
  ceiling. The limit is **total tables in the schema**.
- **Dynamic:** deploys any N (analyzer skips dynamic imports), evaluates only the
  **K** touched at runtime. The limit is **tables touched in one transaction**.

## Implication for the q/m ask

Enabling `import()` in q/m shifts zodvex's ceiling from *app-wide table count*
(deploy-time) to *per-transaction table-touch count* (runtime). Real q/m touch a
handful of tables, so this is a large practical gain — proportional to
(total tables ÷ tables-touched-per-transaction) — but it is **not unbounded**: a
transaction evaluating >~150–200 codec table modules would OOM the runtime
isolate the same way.

## Run notes

- A dedicated probe deployment (`zodvex-deploy-probe` → `dependable-marmot-958`)
  was provisioned since `_deploy/.env.local` did not exist.
- `bun run div:static` etc. are cwd-sensitive — must run from
  `examples/stress-test/` (a background invocation from repo root fails
  "Script not found").

## Data-dependent variant (2026-06-18, git 79d5a2e)

Validates the codec path, not just memory: select a table module by a **runtime
table name** (the FK-follow pattern), `import()` only that module, and decode a
real wire doc through the lazily-imported schema. Corpus stamped from the
task-manager archetypes. See `data-dependent/`.

**Correctness pass — 5/5 (real deploy, 750 deployed).** Each table selected by
runtime name, lazily imported, decoded against its wire fixture:

| archetype | codec checks |
|---|---|
| task | `createdAt`→Date, `estimate`→{hours,minutes} (zDuration) |
| user | `createdAt`→Date, `email.displayValue` (taggedEmail) |
| activity | `createdAt`→Date, `payload.duration`→{hours,minutes} (zDuration nested in union) |
| comment | `createdAt`→Date (slim model, schemaHelpers:false) |
| notification | `createdAt`→Date, `sentAt`→Date (top-level union table) |

The lazy, table-name-selected import path is **functionally identical to a
static import** across all five archetypes — confirmed locally
(`div:datadep:validate`) and end-to-end through the Convex isolate.

**Memory pass — same ceiling, with a real decode workload.** `passed=K,
failed=0` at every OK rung; OOM at K=200, max OK K=150 — identical to the
index-based run despite 750 deployed. Decode adds no surprise cost.
