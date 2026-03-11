# Encode runtime values in .withIndex() / .filter() index range callbacks

## Context

`ZodvexQueryChain.withIndex()` passes the `indexRange` callback straight through to Convex without encoding. The `IndexRangeBuilder` the user receives is Convex's native one, which expects wire-format values.

This means if a handler receives decoded runtime values (e.g., a `Date` or a decoded codec object) and passes them to `.eq()`, `.gt()`, etc., Convex gets the wrong type at runtime.

## Current state

The DB wrapper covers 4 of 6 codec boundaries:

| Boundary | Status | Location |
|----------|--------|----------|
| Read decode (DB → handler) | Done | `ZodvexQueryChain` terminal methods |
| Write encode (handler → DB) | Done | `ZodvexDatabaseWriter.insert/patch/replace` |
| Arg decode (client → handler) | Done | Function wrappers (custom.ts) |
| Return encode (handler → client) | Done | Function wrappers (custom.ts) |
| **Index query encode** | **Missing** | `ZodvexQueryChain.withIndex()` |
| **Search query encode** | **Missing** | `ZodvexQueryChain.withSearchIndex()` |

## Hotpot workaround

Hotpot avoids this by:
1. Indexing on nested wire-format paths: `.index('email', ['email.value'])`
2. Querying with the scalar directly: `q.eq('email.value', emailValue)`
3. Manually extracting values via `.expose()` on `SensitiveField`

This works but requires the consumer to understand wire format internals.

## Proposed fix

### Runtime
Wrap `IndexRangeBuilder` so `.eq()`, `.gt()`, `.gte()`, `.lt()`, `.lte()` encode values through the field's codec before passing to Convex's inner builder. The table's schema (available via `tableMap`) provides the codec for each field path.

Key consideration: dot-notation paths (`email.value`) target scalar subfields and need no encoding. Only top-level codec fields (`email`) need the runtime→wire transform.

### Type level
Create a `ZodvexIndexRangeBuilder` that maps field value types from wire format to decoded/runtime format, so `.eq("email", decodedValue)` typechecks with the runtime type instead of requiring the wire object.

### Same treatment for .filter() and .withSearchIndex()
The `FilterBuilder` and `SearchFilterBuilder` have the same gap — they receive wire-typed callbacks. These should also encode runtime values.

## Priority

Low — hotpot (only consumer) works around this with dot-notation paths. The pattern of indexing on nested scalar paths is arguably better practice anyway. But as a library, zodvex should make the codec boundary fully transparent.

## Related

- `todo/typed-write-methods.md` — similar gap on write method type signatures
- `src/db.ts:69-76` — the passthrough implementation
- Convex's `IndexRangeBuilder` uses `FieldTypeFromFieldPath<Document, FieldName>` to resolve value types
