# Issue: Decouple validators from handlers so codegen never infers codec identity

**Opened:** 2026-06-08
**Status:** Tracking (not in flight)
**Target:** v0.8.0 (convention + ergonomics change)
**Relates-to:** `docs/decisions/2026-06-08-codec-provenance-brands.md` (the near-term mitigation), hotpot 0.7.2-beta smoke-test blocker 2

## Context

Codegen has to find an **importable, frontend-safe** reference for every codec embedded
in a function's `args`/`returns`, because `_zodvex/api.js` is bundled into the client
(`client.js` does `import { zodvexRegistry } from './api.js'`, and `client.js` powers the
React hooks and vanilla client). The registry carries real Zod schemas so the client can
encode args and decode results at the boundary.

Today the codec lives **inline inside the function definition** (`zMutation({ args: { x:
sensitive(...) }, handler })`), welded to the server `handler` and all its server-only
imports (`ctx.db`, internal services, Node APIs). Codegen therefore **cannot** reference
the codec from its definition site — importing the function module would drag the server
handler into the browser bundle (and create a `functions → api → functions` cycle). ESM
can't tree-shake the handler out, because `api.js` would be importing a live object and
reading one property off it.

So codegen instead tries to find a *different* importable instance of the "same" codec —
an exported `const` or a model field — and match the function's instance to it. Factory
codecs (`sensitive(inner)`, `tagged(inner)`) make every call a fresh object, so identity
matching fails and codegen falls back to a **structural fingerprint** — a heuristic for an
undecidable problem (closure equality) that is necessarily approximate and feels
non-deterministic. The provenance-brand decision mitigates this but does not remove it: it
still requires an importable twin to exist, and it still can't reference a codec a function
defines that nothing else does.

## The structural fix

Stop inferring codec identity. Make the **validator (the `args`/`returns` schema, codecs
included) a first-class, frontend-safe artifact defined separately from the handler**, and
have codegen reference it directly. Once the validator lives in a client-safe module,
identity matching is exact and collision-free — no fingerprint, no brands — and it also
handles the case a function's codec has no model/exported twin (today: a hard error).

Shape sketch (exact ergonomics TBD):

```ts
// messages.args.ts — frontend-safe: schemas only, no handler, no server imports
export const sendArgs = { visitId: zx.id('visits'), content: sensitive(z.string().max(N)) }

// messages.ts — server: imports the validator, owns the handler
import { sendArgs } from './messages.args'
export const send = zMutation({ args: sendArgs, handler: async (ctx, a) => { ... } })
```

Codegen references `sendArgs` from `messages.args.js` (frontend-safe) by identity.

## Open questions

1. **Ergonomics / boilerplate.** Forcing a separate `*.args.ts` per function is friction.
   Options: a helper that splits validator from handler at definition time; a lint/codegen
   nudge; or making it opt-in (only functions with codecs need the split). The common case
   (no codecs in args) must stay zero-ceremony.
2. **Enforcement vs convention.** Do we detect "codec defined inline in a handler module"
   and hard-error with a fix-it (current 0.7.2 behavior is already a hard error for the
   no-twin case), or keep it a soft convention backed by brands?
3. **Returns.** Return schemas have the same constraint and are easier to forget — a doc
   decoded on the client still needs the codec.
4. **Interaction with models.** Many codecs already live in models (frontend-safe). The
   gap is purely function-local codecs. Possibly the answer is "function-local codecs must
   be exported or modeled" — which is what the brand + hard-error path already nudges, just
   made structural.
5. **Break the cycle instead?** Alternative framing: keep codecs inline but restructure the
   generated registry so the codec-carrying part is in a module that function files don't
   import back, breaking the cycle so codegen *can* import the function module's schema
   without server code coming along. Unclear this is achievable without separating schema
   from handler anyway — likely converges on the same place.

## Why not now

This is a convention/API-surface change with real ergonomic stakes; it deserves a deliberate
design pass, not a rush into the 0.7.2 bug-fix beta. The brand decision buys precise,
explicit determinism today and is forward-compatible — once validators are decoupled, brands
become redundant for decoupled functions and remain a fallback for inline ones.
