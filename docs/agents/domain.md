# Domain Docs

This repository uses a single-context domain layout across its packages
and examples.

## Before exploring

- Read root `GLOSSARY.md` for domain terminology.
- Read decisions in `docs/adr/` relevant to the area being explored.

If a glossary or ADR directory is absent, proceed silently.
The domain-modeling skill creates these documents lazily when terms or
decisions are resolved.

## Layout

- `GLOSSARY.md`: shared domain vocabulary.
- `docs/adr/`: architecture decision records, numbered sequentially as
  `0001-slug.md`, `0002-slug.md`, and so on. Existing records retain their
  original dates and decision history.

## Use the glossary's vocabulary

Use defined terms in issue titles, proposals, hypotheses, and test names.
When a needed concept is missing, reconsider whether it belongs to the
project's vocabulary or note the gap for domain-modeling.

## Flag decision conflicts

If a proposal contradicts an existing decision, identify that decision
and explain why it should be reopened.
