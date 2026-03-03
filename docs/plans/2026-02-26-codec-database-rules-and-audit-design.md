# Codec Database Rules & Audit Design

## Problem

zodvex's `CodecDatabaseReader`/`CodecDatabaseWriter` wrap Convex's raw DB with automatic codec encode/decode. Downstream consumers need to interpose per-document security (RLS/FLS) on decoded documents. convex-helpers' `wrapDatabaseReader` wraps `GenericDatabaseReader`, but `CodecDatabaseReader` doesn't implement that interface (different terminal return types). So a consumer built its own `SecureQueryChainImpl` which redeclares every intermediate chain method with `any` types, destroying all index/filter type inference that `CodecQueryChain` provides.

## Solution

Two independent, composable methods on `CodecDatabaseReader` and `CodecDatabaseWriter`:

- **`.withRules(ctx, rules, config?)`** — per-table, per-operation rules that gate and transform documents at operation boundaries
- **`.audit(config)`** — per-table post-operation observation callbacks for audit logging

Both return the same type they're called on, making them chainable and composable in any order.

## Design Decisions

### Why not mirror convex-helpers' `wrapDatabaseReader` exactly

convex-helpers provides boolean predicates on a `GenericDatabaseReader` interface. zodvex's codec layer changes the equation:

1. **Rich decoded types.** Documents have `CustomField`, `Date`, and other codec-decoded types. Per-document transformation (FLS field decisions) is as important as boolean gating. Boolean predicates can't transform.
2. **No interface to implement.** `CodecDatabaseReader` is a class, not an interface like `GenericDatabaseReader`. Methods on the class are the natural extension point.
3. **Operation-specific context.** convex-helpers groups `patch`/`replace`/`delete` into a single `modify` rule. But these operations have different inputs — `patch` has a partial value, `replace` has a full value, `delete` has nothing. Organizing by actual DB action types gives each rule exactly the context it needs.

### Rules organized by DB action, not by category

convex-helpers uses three categories: `read`, `modify`, `insert`. We use five, matching actual database operations: `read`, `insert`, `patch`, `replace`, `delete`. This eliminates the need for discriminated unions on write rules and naturally solves the two-phase patch problem (the `patch` rule receives both the current doc and the patch value).

### Rules as gates + transforms, not just boolean predicates

Read rules return `Doc | null | boolean` instead of just `boolean`. `true` passes the doc through unchanged, `false`/`null` denies, and returning a `Doc` allows transformation. This handles both RLS (gate) and FLS (transform) in a single rule function, without requiring a separate wrapping layer for transforms. The boolean shorthand keeps the simple case simple — consumers who just want "can this user see this row?" write `(ctx, doc) => allowed` instead of `(ctx, doc) => allowed ? doc : null`.

Write rules return the (possibly transformed) value, or throw to deny.

**Trade-off acknowledged:** Transform-capable rules are a sharper tool than boolean predicates — a buggy rule can corrupt a document. But the alternative is consumers building manual wrappers with `any` types throughout, which has the same corruption risk without type safety.

### Audit as a separate concern from rules

A consumer might want audit without rules (they have their own RLS system) or rules without audit. Forcing audit into the rules config couples unrelated concerns and confuses consumers who don't use zodvex's rules. `.audit()` is an independent method.

### RLS is a safety net, not the primary filter

In practice, handlers use `.withIndex()` for performant scope-based filtering. RLS rules run per-document at terminals as defense-in-depth. Most documents that reach the rule will pass. zodvex's `.withRules()` provides correctness guarantees, not performance guarantees. Index discipline is the handler author's responsibility.

## API Surface

### `.withRules(ctx, rules, config?)`

```ts
class CodecDatabaseReader<DataModel, DecodedDocs> {
  withRules<Ctx>(
    ctx: Ctx,
    rules: CodecRules<Ctx, DataModel, DecodedDocs>,
    config?: CodecRulesConfig,
  ): CodecDatabaseReader<DataModel, DecodedDocs>
}

class CodecDatabaseWriter<DataModel, DecodedDocs> {
  withRules<Ctx>(
    ctx: Ctx,
    rules: CodecRules<Ctx, DataModel, DecodedDocs>,
    config?: CodecRulesConfig,
  ): CodecDatabaseWriter<DataModel, DecodedDocs>
}
```

### Rule Types

```ts
type CodecRules<
  Ctx,
  DataModel extends GenericDataModel,
  DecodedDocs extends Record<string, any>,
> = {
  [T in TableNamesInDataModel<DataModel>]?: TableRules<
    Ctx,
    ResolveDecodedDoc<DataModel, DecodedDocs, T>
  >
}

/** Convenience type: insert doc is the decoded doc without system fields. */
type InsertDoc<Doc> = Omit<Doc, '_id' | '_creationTime'>

type TableRules<Ctx, Doc> = {
  /** Gate + transform on every document returned to the handler.
   *  Return true to allow unchanged, false/null to deny, or Doc to transform.
   *  Boolean shorthand keeps simple RLS rules concise. */
  read?: (ctx: Ctx, doc: Doc) => Promise<Doc | null | boolean>

  /** Gate + transform on insert values.
   *  Return the value (possibly transformed) to allow. Throw to deny. */
  insert?: (ctx: Ctx, value: InsertDoc<Doc>) => Promise<InsertDoc<Doc>>

  /** Gate + transform on patch operations.
   *  Receives the current doc and the partial patch value.
   *  Return the patch value (possibly transformed) to allow. Throw to deny. */
  patch?: (ctx: Ctx, doc: Doc, value: Partial<Doc>) => Promise<Partial<Doc>>

  /** Gate + transform on replace operations.
   *  Receives the current doc and the full replacement value.
   *  Return the replacement value (possibly transformed) to allow. Throw to deny. */
  replace?: (ctx: Ctx, doc: Doc, value: Doc) => Promise<Doc>

  /** Gate on delete operations.
   *  Receives the current doc. Throw to deny. */
  delete?: (ctx: Ctx, doc: Doc) => Promise<void>
}

type CodecRulesConfig = {
  /** Default policy for operations without rules. Default: 'allow'. */
  defaultPolicy?: 'allow' | 'deny'
  /** Allow count() when rules are present. Default: false. */
  allowCounting?: boolean
}
```

### `.audit(config)`

```ts
class CodecDatabaseReader<DataModel, DecodedDocs> {
  audit(config: {
    afterRead?: <T extends TableNamesInDataModel<DataModel>>(
      table: T,
      doc: ResolveDecodedDoc<DataModel, DecodedDocs, T>,
    ) => void | Promise<void>
  }): CodecDatabaseReader<DataModel, DecodedDocs>
}

class CodecDatabaseWriter<DataModel, DecodedDocs> {
  audit(config: {
    afterRead?: <T extends TableNamesInDataModel<DataModel>>(
      table: T,
      doc: ResolveDecodedDoc<DataModel, DecodedDocs, T>,
    ) => void | Promise<void>
    afterWrite?: <T extends TableNamesInDataModel<DataModel>>(
      table: T,
      event: WriteEvent<ResolveDecodedDoc<DataModel, DecodedDocs, T>>,
    ) => void | Promise<void>
  }): CodecDatabaseWriter<DataModel, DecodedDocs>
}

type WriteEvent<Doc = any> =
  | { type: 'insert'; id: GenericId<any>; value: InsertDoc<Doc> }
  | { type: 'patch'; id: GenericId<any>; doc: Doc; value: Partial<Doc> }
  | { type: 'replace'; id: GenericId<any>; doc: Doc; value: Doc }
  | { type: 'delete'; id: GenericId<any>; doc: Doc }
```

## Internal Implementation

### `withRules()` — Subclass-Based

`withRules()` returns a new instance of a private `RulesCodecDatabaseReader` (or `Writer`) subclass. The subclass extends the base class and overrides:

**Reader overrides:**

- **`get()`** — delegates to `super.get()`, applies the read rule. Returns `null` if denied.
- **`query()`** — delegates to `super.query()` to get the `CodecQueryChain`, wraps it in a `RulesCodecQueryChain`.

`normalizeId` and `system` are inherited unchanged.

**Read rule normalization:** At runtime, read rule results are normalized — `true` becomes the original doc (pass-through), `false` becomes `null` (deny), and `Doc` values are used as-is (transform). This happens once at each terminal, not in the type system.

**`RulesCodecQueryChain` extends `CodecQueryChain`** — it does NOT wrap it. To enable this:

1. `CodecQueryChain.inner` and `schema` change from `private` to `protected`
2. A new `protected createChain(inner)` factory method is added to `CodecQueryChain`
3. All intermediate methods (`withIndex`, `filter`, `order`, etc.) use `this.createChain()` instead of `new CodecQueryChain()`
4. `RulesCodecQueryChain` overrides `createChain()` to return a `RulesCodecQueryChain` and overrides only terminal methods

This eliminates intermediate method re-delegation entirely — intermediate methods are inherited from the base class and automatically return the correct subclass type via the factory method. No type erasure, no re-wrapping.

Terminal method overrides:

| Terminal | Behavior |
|---|---|
| `first()` | Iterate via `for await`, return first allowed doc |
| `take(n)` | Iterate via `for await`, collect until `n` allowed docs |
| `collect()` | Iterate via `for await`, collect all allowed docs |
| `unique()` | Delegate to inner, apply rule, return `null` if denied |
| `paginate(opts)` | Delegate to inner, post-filter page (page may shrink) |
| `count()` | If `allowCounting` → delegate. Otherwise throw. |
| `[Symbol.asyncIterator]` | Yield only docs that pass the read rule |

The same `createChain` pattern applies to `AuditCodecQueryChain`.

**Writer overrides:**

- **Read methods** — delegate to an internal `RulesCodecDatabaseReader`.
- **`insert(table, value)`** — if insert rule exists, call it (returns transformed value or throws). If no rule + `defaultPolicy: 'deny'`, throw. Otherwise delegate to `super.insert()` with the (possibly transformed) value.
- **`patch(id, value)`** — fetch current doc via `this.get()` (applies read rule). If `null`, throw `"no read access or doc does not exist"`. If patch rule exists, call it with `(ctx, doc, value)` (returns transformed value or throws). If no rule + `defaultPolicy: 'deny'`, throw. Delegate to `super.patch()` with the (possibly transformed) value.
- **`replace(id, value)`** — same pattern as patch. Fetch current doc, apply replace rule, delegate.
- **`delete(id)`** — fetch current doc via `this.get()`. If `null`, throw. If delete rule exists, call it with `(ctx, doc)` (throws to deny). If no rule + `defaultPolicy: 'deny'`, throw. Delegate to `super.delete()`.

### `audit()` — Subclass-Based

`audit()` returns a new instance of a private `AuditCodecDatabaseReader` (or `Writer`) subclass. The subclass overrides terminal methods to call the audit callback after the operation succeeds.

**Reader:** `afterRead` fires per-document on `get()` (if non-null) and on each document yielded by query chain terminals.

**Writer:** `afterWrite` fires after each successful `insert`, `patch`, `replace`, `delete` call, with a `WriteEvent` describing the operation.

### Chaining Semantics

Both `.withRules()` and `.audit()` return the same type, enabling natural composition:

```ts
// Any order works
ctx.db.withRules(ctx1, rules).audit(auditConfig)
ctx.db.audit(auditConfig).withRules(ctx1, rules)
ctx.db.withRules(ctx1, rules1).withRules(ctx2, rules2)
```

Each call wraps the previous, creating a pipeline:

- **Reads:** inside-out. Inner codec decodes → first rules layer processes → second rules layer processes → audit observes.
- **Writes:** outside-in. Outermost rules layer runs first → delegates to inner rules → delegates to codec writer.
- **Audit placement** determines observation point: before `.withRules()` sees raw decoded docs, after `.withRules()` sees rules-processed docs.

### Default Policy

Operations without a rule follow `defaultPolicy` (default: `'allow'`).

- `defaultPolicy: 'allow'` — all operations on all tables pass through unless explicitly denied by a rule. Good for incremental adoption.
- `defaultPolicy: 'deny'` — all operations on ALL tables are denied by default, including tables not mentioned in the rules object. You must explicitly add rules to grant access. Good for lockdown posture.

This means `defaultPolicy: 'deny'` is a true lockdown — adding a new table to the schema without adding rules will deny all access to it. No silent gaps.

### Error Semantics

| Scenario | Behavior |
|---|---|
| Read denied by rule | Silent `null` (filtered from results) |
| Write without read access | Throw: `"no read access or doc does not exist"` |
| Write rule throws | Exception propagates (custom message from consumer) |
| Operation denied by `defaultPolicy: 'deny'` | Throw: `"{operation} not allowed on {table}"` |
| `count()` when `allowCounting: false` | Throw: `"count is not allowed with rules"` |

## Consumer Usage

### Consumer blessed function (target state)

```ts
export const consumerQuery = zq.withContext({
  input: async (ctx) => {
    const securityCtx = await resolveContext(ctx)
    return {
      ctx: {
        db: ctx.db
          .withRules(securityCtx, rules)
          .audit({
            afterWrite: (table, event) => {
              if (isSecurityContext(securityCtx)) {
                const fields = 'value' in event ? Object.keys(event.value) : []
                produceWriteAuditLog(securityCtx, event.type, table, event.id, fields)
              }
            },
          }),
        securityCtx,
      },
    }
  },
})
```

### Consumer rules definition

```ts
const rules = {
  patients: {
    read: async (ctx, doc) => {
      // RLS gate
      if (doc.clinicId !== ctx.scope.clinicId) return null
      // FLS transform
      return applyFlsRuntime(doc, patientsSchema, ctx, resolver)
    },
    insert: async (ctx, value) => {
      if (!checkScope(ctx, value)) throw new Error('insert denied')
      const wrapped = await applyFlsWriteRuntime(value, patientsSchema, ctx, resolver)
      return { ...wrapped, expiresAt: calculateExpiresAt() }
    },
    patch: async (ctx, doc, value) => {
      // Two-phase RLS
      if (doc.clinicId !== ctx.scope.clinicId) throw new Error('modify denied')
      const merged = { ...doc, ...value }
      if (merged.clinicId !== ctx.scope.clinicId) throw new Error('scope escape denied')
      // FLS write validation
      return applyFlsWriteRuntime(value, patientsSchema, ctx, resolver)
    },
    delete: async (ctx, doc) => {
      if (doc.clinicId !== ctx.scope.clinicId) throw new Error('delete denied')
    },
  },
}
```

### What the consumer deletes

- `SecureQueryChainImpl` (~170 lines)
- `SecureQueryChain` type (~30 lines)
- `SecurityReader` / `SecurityWriter` types (~40 lines)
- `createSecurityReader` / `createSecurityWriter` (~200 lines)

Replaced by rule definitions + `.withRules().audit()` composition in the blessed function (~10 lines of setup).

## Modified Files

- **`packages/zodvex/src/db.ts`** — `CodecQueryChain` changes: `inner`/`schema` become `protected`, add `protected createChain()` factory, intermediate methods use `this.createChain()`. `CodecDatabaseReader`/`Writer` get `.withRules()` and `.audit()` methods.

## New File

`packages/zodvex/src/rules.ts` — contains `RulesCodecDatabaseReader`, `RulesCodecDatabaseWriter`, `RulesCodecQueryChain` (extends `CodecQueryChain`), `AuditCodecDatabaseReader`, `AuditCodecDatabaseWriter`, `AuditCodecQueryChain` (extends `CodecQueryChain`), and all supporting types.

## Exports

From `zodvex/server`:
- `CodecRules` type
- `CodecRulesConfig` type
- `WriteEvent` type
- `TableRules` type

The `.withRules()` and `.audit()` methods are on the existing `CodecDatabaseReader`/`CodecDatabaseWriter` classes — no new imports needed to use them.
