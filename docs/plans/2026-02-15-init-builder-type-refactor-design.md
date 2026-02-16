# initZodvex Builder Type Refactor Design

## Problem

`createComposableBuilder` uses a `kind: 'query' | 'mutation' | 'action'` string discriminant to determine:
1. Whether to wrap `ctx.db` (action = no)
2. Which wrapper to use (reader vs writer)
3. Whether to attach `.withHooks()` (action = no)

This recreates type information that Convex's builders already carry. The `baseBuilder` parameter is typed as `any`, and `kind` casts (`kind as any`, `const dbKind = kind as 'query' | 'mutation'`) compensate for the type erasure.

## Solution

Replace the single polymorphic `createComposableBuilder` with three separate factory functions, each accepting the correctly-typed Convex builder. Share common handler logic via a private `buildHandler()`.

### Architecture

```
initZodvex(schema, server)
  ├─ createQueryBuilder(server.query, zodTables)      → DbBuilder
  ├─ createMutationBuilder(server.mutation, zodTables) → DbBuilder
  └─ createActionBuilder(server.action, zodTables)     → ZodvexActionBuilder
```

This mirrors convex-helpers' pattern: `customQuery()`, `customMutation()`, `customAction()` are separate functions that delegate to a shared `customFnBuilder()`.

### Type Signatures

```typescript
function createQueryBuilder<DataModel extends GenericDataModel, Visibility extends FunctionVisibility>(
  baseBuilder: QueryBuilder<DataModel, Visibility>,
  zodTables: ZodTables,
  customCtxFn?: CustomCtxFn | null,
  hooks?: DatabaseHooks | null,
): DbBuilder

function createMutationBuilder<DataModel extends GenericDataModel, Visibility extends FunctionVisibility>(
  baseBuilder: MutationBuilder<DataModel, Visibility>,
  zodTables: ZodTables,
  customCtxFn?: CustomCtxFn | null,
  hooks?: DatabaseHooks | null,
): DbBuilder

function createActionBuilder<DataModel extends GenericDataModel, Visibility extends FunctionVisibility>(
  baseBuilder: ActionBuilder<DataModel, Visibility>,
  zodTables: ZodTables,
  customCtxFn?: CustomCtxFn | null,
): ZodvexActionBuilder
```

`createActionBuilder` does not accept `hooks` — enforced at the type level.

### Shared Internal

```typescript
function buildHandler(
  baseBuilder: any,
  customCtxFn: CustomCtxFn | null | undefined,
  wrapDb: ((ctx: any, hooks: DatabaseHooks | undefined) => any) | null,
  hooks: DatabaseHooks | null | undefined,
  config: any,
)
```

The `wrapDb` parameter is the injection point:
- Query: `(ctx, hooks) => createZodDbReader(ctx.db, zodTables, hooks, ctx)`
- Mutation: `(ctx, hooks) => createZodDbWriter(ctx.db, zodTables, hooks, ctx)`
- Action: `null`

`buildHandler` uses `any` internally — same pattern as convex-helpers' `customFnBuilder`. Type safety is enforced by the public function signatures.

### Composability

Each factory's `.withContext()` and `.withHooks()` recurse into itself:

```typescript
// Inside createQueryBuilder:
builder.withContext = (customization) =>
  createQueryBuilder(baseBuilder, zodTables, customization._fn ?? customization, hooks)

builder.withHooks = (newHooks) =>
  createQueryBuilder(baseBuilder, zodTables, customCtxFn, newHooks)
```

No `kind` propagation needed — each function knows what it is.

### What Gets Eliminated

- `BuilderKind` type
- `kind` parameter
- `as any` casts for kind propagation
- Runtime `kind !== 'action'` guard
- Runtime `kind === 'mutation'` check
- Overloads on `createComposableBuilder`

### What Stays

- `ZodvexActionBuilder` type (no `.withHooks()`)
- `DbBuilder` type (has `.withHooks()`)
- `buildHandler()` uses `any` internally (idiomatic overload implementation pattern)
- Public factory functions have Convex generics on their signatures
