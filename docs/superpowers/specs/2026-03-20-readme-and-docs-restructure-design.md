# README & Documentation Restructure

**Goal:** Make zodvex's adoption story clear by restructuring the README around features (not layers), adding a minimal quickstart example, and preserving all existing deep-dive content in `docs/guide/`.

**Context:** Issue #37 surfaced that a potential adopter was intimidated by the perceived need for codegen/CLI to upgrade to v0.6. The codec-aware database (the primary v0.6 value prop) requires only `initZodvex` — no codegen. The current README doesn't communicate this; it's written entirely against the v0.5 API and reads as reference docs rather than an onboarding guide.

---

## README Structure (~400 lines)

```
# zodvex
Tagline + one-paragraph pitch

## Table of Contents (auto-generated or manual)

## Why zodvex?
  - 3-4 bullet value props, leading with codecs-in-the-schema
  - Condensed comparison vs. convex-helpers
    (keep the table from current README, trimmed to highlight v0.6 differentiators)

## Installation
  - Peer deps: zod@^4.1.0, convex >= 1.27, convex-helpers >= 0.1.104
  - Note: Zod 4.1+ is required (not 4.0) — zodvex uses native codec support added in 4.1
  - Merges current "Compatibility" section into this — no separate compat section

## Quick Start (the recommended path)
  1. Define models with defineZodModel (client-safe)
  2. Build schema with defineZodSchema
  3. Set up builders with initZodvex (returns zq, zm, za, ziq, zim, zia)
  4. Write a function with zx.date() — Date conversion Just Works
  - Examples use zx.id() for typed Convex IDs — contextualize as a typed validator, not a codec
  → Links to examples/quickstart/
  - Update/remove current link to ./examples/queries.ts (stale reference)

## Import Paths (brief — 3 entry points, not a full section)

## Features
  ### Codec-Aware Database
    - Automatic encode/decode on ctx.db reads/writes
    - zx.date() (codec) and zx.codec() (custom codecs)
    - zx.id() — typed Convex ID validator (NOT a codec, no wire transformation)
  ### Codegen & Client-Side Schema Sharing
    - What it gives you: typed hooks, form resolvers, action auto-decode
    - When you need it vs. when you don't
    - Brief setup snippet → links to examples/task-manager/ + docs/guide/codegen.md
  ### Using zodvex Without Codecs
    - zodTable + zQueryBuilder still work without initZodvex
    - Honest callout: this is a stepping-stone, not a recommended feature
    - At this level, zodvex is roughly equivalent to convex-helpers
    - "When you're ready for codecs, see Quick Start above"

## Supported Types (the mapping table — stays in README)

## Upgrading?
  - Brief callout linking to docs/migration/v0.6.md
  - Key message: "The CLI is optional — the Quick Start path needs no codegen"
  - Fix: current README links to ./MIGRATION.md which is the old root migration guide;
    new README links to docs/migration/v0.6.md for current version

## API Reference (brief — links to docs/guide/ for details)

## Roadmap / TODOs
  - Migration tooling: vanilla Convex → zodvex (for new adopters)
  - Migration tooling: pre-0.5 → current
  - Additional example projects / per-feature READMEs in task-manager

## License
```

---

## Content Migration Map

Every section in the current README, where it goes, and what updates are needed.

### Stays in README (rewritten for v0.6)

| Current Section | New Location in README | Changes |
|---|---|---|
| Table of Contents | Table of Contents | Regenerate to match new structure |
| Installation | Installation | Update peer dep floor to zod@^4.1.0; add note that 4.1 is required for native codec support |
| Compatibility | Merged into Installation | Peer dep versions folded in; no separate section |
| Import Paths | Import Paths (trimmed) | Brief mention of 3 entry points, not a full section |
| Quick Start | Quick Start (rewritten) | Lead with initZodvex + defineZodModel; drop zQueryBuilder as primary; update/remove stale `./examples/queries.ts` link |
| Defining Schemas | Folded into Quick Start | defineZodModel replaces plain shapes |
| Table Definitions | Folded into Quick Start | defineZodModel replaces zodTable |
| Building Your Schema | Folded into Quick Start | defineZodSchema replaces defineSchema |
| Defining Functions | Folded into Quick Start | zq/zm from initZodvex |
| Supported Types (table) | Supported Types | No changes |
| zodvex vs convex-helpers | Why zodvex? (condensed) | Reframe around v0.6 features; keep comparison table, trim to highlight differentiators |
| Why zodvex? | Why zodvex? (merged with above) | Lead with codec-aware DB as differentiator |
| Migration Guide link | Upgrading? | Fix broken link: `./MIGRATION.md` → `./docs/migration/v0.6.md` |

### Moves to docs/guide/ (preserved and updated)

All `docs/guide/*.md` files are **net-new** — content is extracted from the current README and rewritten per the "Changes Needed" column. The `docs/guide/` directory does not exist yet.

| Current Section | New File | Changes Needed |
|---|---|---|
| Working with Subsets | `docs/guide/working-with-subsets.md` | Update to defineZodModel + `.fields` |
| Form Validation | `docs/guide/form-validation.md` | Update; mention codegen form resolvers |
| The zx Namespace | `docs/guide/zx-namespace.md` | Clarify: zx.id() is typed ID (not codec), zx.date() and zx.codec() are codecs |
| Builders (API ref) | `docs/guide/builders.md` | Document initZodvex as primary; zQueryBuilder etc. as legacy |
| Mapping Helpers | `docs/guide/mapping-helpers.md` | Minimal changes |
| Codecs (subsection of API Reference) | `docs/guide/custom-codecs.md` | Major rewrite: lead with zx.codec(), decodeDoc/encodeDoc; deprecation note for convexCodec |
| Custom Context Builders | `docs/guide/custom-context.md` | Rewrite around .withContext() pattern from initZodvex builders |
| Hooks and Transforms | Dropped | Removed pre-1.0 (see CLAUDE.md memory: "CustomizationWithHooks, transforms.*, customCtxWithHooks to be removed"). No migration needed — was never in a stable release. |
| onSuccess Hook | `docs/guide/custom-context.md` (subsection) | Minimal changes; note that onSuccess is the only hook point (per convex-helpers Customization) |
| Custom Codecs | `docs/guide/custom-codecs.md` (merged with Codecs above) | Rewrite for v0.6 API |
| Date Handling | `docs/guide/date-handling.md` | Clarify: old mapDateFieldToNumber is gone; requires Zod 4.1+ for native codec support; automatic DB wrapping via initZodvex |
| Return Type Helpers | `docs/guide/return-type-helpers.md` | Minimal changes |
| Large Schemas | `docs/guide/large-schemas.md` | Minimal changes |
| Polymorphic Tables | `docs/guide/polymorphic-tables.md` | Update to defineZodModel |
| AI SDK Compatibility | `docs/guide/ai-sdk.md` | Minimal changes |

### Not migrated (existing separate docs, no changes needed)

| Item | Location | Notes |
|---|---|---|
| examples/task-manager/ README | `examples/task-manager/convex/README.md` | Exists; not updated in this spec. Future work: per-feature READMEs (see Roadmap). |
| Root MIGRATION.md | `./MIGRATION.md` | Covers pre-v0.5 migrations. Stays as-is. README no longer links to it directly (links to `docs/migration/v0.6.md` instead). |

---

## Quickstart Example

`examples/quickstart/` — minimal Convex-only project proving codecs work without codegen.

### Files

```
examples/quickstart/
├── package.json          # convex, zod, zodvex (workspace:*)
├── convex/
│   ├── models.ts         # defineZodModel with zx.date()
│   ├── schema.ts         # defineZodSchema (~3 lines)
│   ├── functions.ts      # initZodvex setup
│   └── events.ts         # Query + mutation — Date Just Works
└── README.md             # What this demonstrates, what it doesn't need
```

### What it demonstrates

- An "events" table with `startDate: zx.date()` — directly mirrors the issue #37 scenario
- A query returning `docArray` (dates come back as Date objects, not numbers)
- A mutation accepting Date args (automatically encoded to timestamps on write)
- No codegen, no CLI, no React — purely Convex server side

### Quickstart README content

Explains: "This example uses zodvex's codec-aware database. Dates, custom codecs, and other transformations work automatically through `initZodvex`. No codegen or CLI required."

Notes the Zod 4.1+ requirement (native codec support) in the prerequisites.

---

## Upgrade Section

A brief callout in the README:

> **Upgrading from a previous version?** Read the [migration guide](./docs/migration/v0.6.md) for what changed and why. Key takeaway: the CLI/codegen is optional — the Quick Start path above needs no codegen.

Links to `docs/migration/v0.6.md` which already covers the mechanical migration. That doc should get a short motivational intro added (why the codec gap existed, why v0.6 closes it) but the README itself doesn't rehash version history.

---

## Roadmap / TODOs (in README)

Transparent list at the bottom of the README:

- Migration tooling: vanilla Convex → zodvex (for new adopters with existing Convex projects)
- Migration tooling: pre-0.5 → current zodvex
- Additional example projects (e.g., full-stack with React, codegen showcase)
- Per-feature READMEs in examples/task-manager/

---

## Out of Scope

- Docs site / hosted documentation (future)
- Changes to the codegen system itself
- New CLI commands
- Changes to the library API
