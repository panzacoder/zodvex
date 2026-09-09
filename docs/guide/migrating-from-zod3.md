# Trialing Zodvex from convex-helpers and Zod 3

The [migration skill](../skills/migrate-convex-helpers-zod3/SKILL.md) helps an agent
assess an existing application, migrate a representative slice, test behavior and
prepare memory evidence. It is also suitable for teams that previously left
Zodvex after a memory-related deployment failure.

Download or copy the entire `docs/skills/migrate-convex-helpers-zod3` directory,
including `references` and `agents`. Install it in your agent's skill directory,
or ask your agent to read the `SKILL.md` and follow its linked references directly.
For Codex, the user skill directory is `~/.codex/skills/`.

A starting request:

> Use $migrate-convex-helpers-zod3 to assess this app and trial a representative
> migration in an isolated checkout. Preserve our stored data, auth and endpoint
> behavior. Report compatibility findings and available memory evidence before
> expanding the trial. Start with local checks.

The skill supports endpoint adoption while keeping native Convex tables, followed
by a separate modeled database trial. It does not assume that every app can
immediately adopt `defineZodSchema`, or that a passing endpoint pilot measures
the full Zodvex model graph.

For memory diagnostics, use a release or maintainer-provided package containing
`inspect-schema`; the released **v0.7.10 does not contain it**. Check the installed
command rather than downloading an unspecified version. The inspector requires
Node 22+ and a `defineZodSchema` export, and produces a local aggregate report.
See [schema diagnostics](schema-diagnostics.md) for scope and interpretation.
