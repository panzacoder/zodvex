# Decision: Codec provenance brands for codegen matching

**Date:** 2026-06-08
**Status:** Accepted — landing in 0.7.2
**Context:** Codegen codec resolution; hotpot 0.7.2-beta smoke-test blocker 2
**Relates-to:** `docs/issues/2026-06-08-validator-handler-decoupling.md` (the longer-term structural fix)

---

## Problem

Codegen must map a runtime codec **instance** found in a function's `args`/`returns`
back to an **importable source reference** (an exported `const` or a model field),
so the generated `_zodvex/api.js` can reference it instead of inlining it. Inlining a
codec is never acceptable: `zodToSource` can serialize the wire schema but not the
encode/decode closures, so an inlined codec is a transform-less husk that silently
breaks the client boundary (see the 0.7.2 fix that made this a hard error).

Object identity is the ground truth, but **factory-produced codecs defeat it**: every
`sensitive(inner)` / `tagged(inner)` call returns a fresh instance, so the codec in a
function's args is a different object than the "same" codec in a model. To bridge that
gap codegen falls back to a **structural fingerprint** (wire + runtime + transform
bodies + checks).

Fingerprinting is a heuristic for an undecidable problem (function/closure equality),
and it is **too coarse**: `fingerprintLeaf` serializes the wire schema via `zodToSource`,
which drops nested checks, so every `sensitive(...)` in an app collapses into one
fingerprint bucket regardless of inner type. That ambiguity is what bit hotpot's
`messages.send` — its content codec matched many candidates. The 0.7.2 correctness fix
(deterministic pick among fingerprint-equivalent candidates, never inline) makes that
case *correct*; it does not make it *rare*, and the resolution is still **inferred**
rather than **declared**, which reads as non-determinism to consumers.

## Decision

Let codecs **carry an explicit provenance brand** — a stable string the factory author
attaches at creation — and have codegen match by brand first, fingerprint second.
Identity becomes *declared*, not *inferred*.

### API

```ts
// New optional 4th argument
zx.codec(wire, runtime, transforms, { brand?: string })
```

The brand is stored as a non-enumerable `__zodvexCodecBrand` property on the codec
(same mechanism as `__zodvexMeta`), so it survives `.optional()` / `.nullable()`
wrapping (codegen unwraps to the underlying codec) and never appears in user data.

Factory authors choose the granularity:

```ts
// Coarse — all sensitive codecs are interchangeable (identical transforms),
// so one brand cohort is correct; codegen picks one deterministically.
export function sensitive(inner) {
  return zx.codec(wire(inner), field, transforms, { brand: 'sensitive' })
}

// Precise — discriminate by a stable label the author supplies.
export function tagged(inner, name) {
  return zx.codec(wire(inner), runtime, transforms, { brand: `tagged:${name}` })
}
```

### Codegen matching (generate.ts)

For each function-embedded codec, in order:

1. **Identity** — already in `codecMap`? Use it. (unchanged)
2. **Brand** — if the codec is branded, look up importable codecs (exported + model)
   that share the brand. If ≥1, reference one deterministically (prefer a same-source-file
   candidate, else stable-sorted-first). Brand equality is the author's explicit assertion
   of interchangeability, so this is collision-free by construction, and **namespaced** —
   a `sensitive`-branded codec can never match a `tagged`-branded one even if their wire
   shapes coincide.
3. **Fingerprint** — unbranded codecs (or branded ones with no branded twin) use the
   existing transform-aware fingerprint path. (unchanged)
4. **No reference at all** — hard error. (unchanged, 0.7.2)

Brands are additive: unbranded codecs behave exactly as before. No migration required.

### Why this is frontend-safe

The brand is metadata read at codegen **discovery** time off the live object. It does
**not** change what the generated `api.js` imports — codegen still references only
frontend-safe model and standalone-codec modules, never function (handler) modules.
Branding sharpens *which* already-importable codec is chosen; it does not import anything
new. This is the constraint that rules out the naive form of the structural fix (see the
companion issue): `api.js` is bundled into the client via `client.js`, so it must never
pull a server handler into the browser.

## Scope

**Lands in 0.7.2 (this branch):**

- `zx.codec(..., { brand?: string })` + non-enumerable brand storage and a reader.
- Brand-first codegen matching (brand → fingerprint → hard error).
- `examples/task-manager` updated: `tagged(inner, name)` brands its output, and a function
  inlines a branded factory codec to demonstrate brand resolution (not just shared exports).
- Tests: brand-matched resolution, brand namespacing (no cross-factory match), brand +
  fingerprint fallback, backward-compat for unbranded codecs.

**Deferred (documented, not implemented now):**

- `zx.codecBrand(name, ...schemas)` — a convenience that computes a brand from schema
  structure so schema-parameterized factories (e.g. `sensitive(inner)`) get per-variant
  precision without the author hand-writing a discriminator. Requires a client-safe
  structural-key function shared with codegen; deferred to avoid bloating the client
  bundle until the shape is settled. Until then, authors supply their own discriminator
  string for precision, or a single brand for an interchangeable cohort.

## Consequences

- Determinism becomes author-controlled and explanatory: the generated reference is the
  one whose brand the author declared, not whichever the fingerprint happened to sort first.
- Cross-factory collisions become impossible (brand namespacing).
- It is a *mitigation that scales with adoption*, not a structural cure. The cure is to stop
  inferring codec identity at all by decoupling validators from handlers so identity matching
  always works — tracked separately.
