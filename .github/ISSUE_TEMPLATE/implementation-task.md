---
name: Implementation task
about: A fully-specified unit of work an implementer agent can execute end to end
title: ""
---

<!--
The body of this issue IS the implementer's entire brief (docs/workflow.md).
It is written by a senior model; a small model executes it literally.

This template deliberately applies NO label, and an unlabelled issue is not
implementable — it waits for a large model to triage it. Add `agent-ready`
only once every section below is filled and an implementer could follow it
without inferring intent, looking anything up, or choosing between options.
If a section would say "it depends" or rests on an unverified assumption,
leave the label off (or add `needs-spec` and comment on what is missing).
-->

## Read first

<!-- Exact docs (with sections) and files to read before coding. Name them. -->

-

## Verified facts

<!-- Everything already established, stated as fact so it is not re-derived or
guessed: protocol values, existing APIs and where they live, prior findings,
provenance where it matters. -->

-

## Scope

<!-- Numbered, concrete deliverables. Name files, exports, behavior. Write
signatures where shape matters. -->

1.

## Out of scope

<!-- What belongs to other issues. Prevents padding. -->

-

## Decisions already made

<!-- Every fork a reasonable engineer would hit, resolved, with a one-line
why. This is what stops an implementer inventing architecture. -->

-

## Constraints

<!-- Invariants this touches: dependency direction, no new dependencies,
read-only toward the mixer, state-lifecycle rules, module containment. -->

-

## Tests

<!-- Enumerate the cases. A list produces coverage; "add tests" produces
tautologies. -->

-

## Definition of done

- [ ] `pnpm typecheck`, `pnpm test` (and `pnpm build` if the web app is
      touched) pass from the repo root
- [ ] Every test case above exists and asserts real behavior
- [ ] Docs updated: <!-- name them, or "none" -->
- [ ] Committed with a conventional prefix and `Fixes #<this issue>`
