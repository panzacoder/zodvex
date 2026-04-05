# Hotpot upstream audit — 2026-03-17

Consolidated review of all zodvex workarounds remaining in hotpot (`doxyme/hotpot`).

## Outstanding

### 2. `unwrapOnce` not exported (MEDIUM)

**Tracked in:** `hotpot-unwraponce-migration.md`, `hotpot-any-audit.md` §2

Hotpot maintains ~50 lines of local `unwrapOnce` + traversal with 8 `as any` casts. zodvex has the same logic in `src/transform/traverse.ts` but doesn't export it.

**Status:** Deferred — implementations diverged (instanceof vs `_def.type` string matching). Convergence requires aligning detection strategy first.

### 3. `.filter()` codec encoding (LOW)

**Tracked in:** `filter-builder-codec-encoding.md`

`.withIndex()` and `.withSearchIndex()` encode runtime values through codecs, but `.filter()` does not. Lower priority since `.filter()` is rarely used with codec fields.

---

## Resolved

### ~~`zx.codec` generic inference drops fields~~ — FIXED

**Previously:** `zx.codec()` constrained transform callbacks to `z.output<W>` / `z.input<R>`, which collapsed when `W` depended on an unresolved generic (e.g., `sensitive<T>()`). Workaround: `any` casts on callbacks, `as SensitiveCodec<T>` on return.

**Fix:** Decoupled transform inference — `WO`/`RI` type params with defaults to `z.output<W>`/`z.output<R>`. When TS can't resolve the defaults, caller annotations on transform params drive inference instead.

**Hotpot action required:** Can remove `wire: any` cast in `sensitive()` decode callback and annotate transform params with the actual types instead.

### ~~`encodeIndexValue()` only handles ZodObject~~ — FIXED

**Previously:** Union schemas silently skipped encoding in `.withIndex()`. Codec fields like `zx.date()` on union tables would send `Date` where Convex expects `number`.

**Fix:** `encodeIndexValue` now resolves union variants via public Zod v4 API (`instanceof z.ZodUnion`, `.options`, `.shape`), builds a per-field union, and encodes through it.

### ~~Client-safe entry points~~ — FIXED

**Previously:** `zodvex/core` entry point existed but the boundary enforcement test (`exports.test.ts`) was broken due to a path bug after monorepo restructure.

**Fix:** Path resolution in `exports.test.ts` now uses `import.meta.url`. The test verifies `zodvex/core` has no runtime imports from `convex/server` or `convex-helpers/server`. 30/30 export boundary tests pass.

**Hotpot action required:** `defineHotpotModel()` can import from `zodvex/core` — it exports `zx`, `zodvexCodec`, `defineZodModel`, mapping utilities, etc. All client-safe.

### ~~`za.withContext()` ActionCtx type collapse~~ — FIXED

**Previously:** `Overwrite<ActionCtx, Record<string, never>>` collapsed to `{ [k: string]: never }`.

**Fix:** Two commits landed well before beta.50:
- `3b61232` — `NoCodecCtx = {}` type alias (replaces `Record<string, never>`)
- `326dcc5` — guard clause on `Overwrite`: `keyof U extends never ? T : Omit<T, keyof U> & U`

Both paths are covered: `NoCodecCtx` is `{}`, and even if `{}` somehow resolved to `Record<string, never>`, the guard clause prevents collapse.

**Hotpot action required:** Remove stale TODO comment in `convex/hotpot/actions.ts:37-39` and optionally drop the explicit `ActionCtx` annotation (inference now works correctly).

### ~~`ConvexValidatorFromZod` codec handling~~ — FIXED

`z.codec()` types were falling through to `VAny<'required'>`. Fixed in early betas.

### ~~`z.object` vs raw shape inference~~ — FIXED

Type inference regression when passing `z.object()` vs raw shapes to `zodTable`. Fixed.

### ~~`extractCodec()` nullable return type~~ — FIXED in beta.17

Return type changed from `ZodTypeAny | undefined` to `ZodTypeAny` (throws if not found).
