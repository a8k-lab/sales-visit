# Domain docs

## Before exploring

- Read root `CONTEXT.md`.
- Read relevant decisions in `docs/adr/`.

If these files are absent, proceed silently. Do not suggest creating
them upfront. The domain-modeling skill creates documentation lazily
when terminology or decisions are resolved.

## Layout

This repo uses a single domain context across its workspace apps:

```text
/
├── CONTEXT.md
├── docs/adr/
├── apps/
└── packages/
```

## Use the glossary's vocabulary

Use terms as defined in `CONTEXT.md` in issues, proposals, hypotheses,
and test names. Avoid synonyms the glossary explicitly discourages.

If a concept is missing, reconsider whether it belongs to the domain;
otherwise note the gap for domain-modeling.

## Flag ADR conflicts

Explicitly identify any proposal that contradicts an existing ADR,
rather than silently overriding it.
