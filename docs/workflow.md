# Workflow: issues in, implementations out

The initial build ran off a linear checklist ([plan.md](plan.md), now closed).
Ongoing work runs off **GitHub issues** at
<https://github.com/anbergem/x32-physical/issues>.

The division of labour is deliberate and cost-driven:

| Role | Model | Job |
|---|---|---|
| **Author / orchestrator** | large (Opus/Fable-class) | Decides *what* and *how*. Writes the issue in full detail, verifies protocol facts, makes design decisions, reviews the result. |
| **Implementer** | small (Sonnet) | Executes one fully-specified issue. Does not design, does not choose between approaches, does not re-derive facts. |

Everything follows from one rule: **the issue body is the implementer's entire
brief.** A small model reading it should never need to infer intent, weigh
alternatives, or look up an external fact. If an issue leaves a decision open,
the issue is not finished — do not assign it.

## Authoring an implementation issue

Use the `implementation-task` template. It encodes the structure that worked
throughout the initial build; the sections are not optional.

1. **Read first** — the exact docs and files (with sections) the implementer
   must read before coding. Never "read the docs"; name them.
2. **Verified facts** — everything already established, stated as fact so it
   is not re-derived or guessed: protocol values, existing APIs and their
   locations, prior findings. Include the *verified* provenance where it
   matters (e.g. "per docs/x32-protocol.md, checked against the Maillot doc").
3. **Scope** — numbered, concrete deliverables. Name files, exports, and
   behavior. If the shape of a function matters, write its signature.
4. **Out of scope** — what belongs to other issues. Small models pad; this
   prevents it.
5. **Decisions already made** — where a reasonable engineer would face a
   fork, state the choice and (briefly) why. This is the section that most
   reliably prevents a small model from inventing architecture.
6. **Constraints** — the invariants this touches (dependency direction, no
   new dependencies, read-only toward the mixer, state-lifecycle rules).
7. **Tests** — enumerate the cases. "Add tests" produces tautologies;
   a list produces coverage.
8. **Definition of done** — gates (`pnpm typecheck`, `pnpm test`,
   `pnpm build`), docs to update, and the commit convention
   (`feat:`/`fix:`/… plus `Fixes #N`).

**Detail is proportional to readiness, not to importance.** An issue that is
blocked on an unverified fact (a protocol semantic, a physical measurement)
gets scope and blockers only, plus a `needs-spec` label. Expand it into a full
brief *after* the blocker clears and *before* assigning it. Writing a
confident, detailed brief on top of an unverified foundation is worse than
writing nothing — the implementer will follow it precisely off a cliff.

## Executing an issue

Either path works and both follow
[.claude/agents/implementer.md](../.claude/agents/implementer.md):

- **Delegated**: spawn the `implementer` agent with the issue number. It runs
  `gh issue view <N>`, refuses the job unless the issue carries
  `agent-ready`, and treats the body as its specification.
- **Direct session**: `gh issue view <N>`, then implement per the same rules.

The implementer commits with `Fixes #N` in the body so merging closes the
issue. It must **stop and report instead of improvising** when the issue is
ambiguous, contradicts a contract document, or turns out to rest on a wrong
fact — that report is a signal to the author, not a failure.

## Labels — `agent-ready` is a gate, and its absence is the safe default

**An unlabelled issue is not implementable.** No label means nobody has
verified that the issue is detailed enough, so it needs a large model to read
it, expand it to the standard above, and only then stamp it. This is
deliberate: forgetting to label something can never cause a small model to
start work on a vague brief. The failure mode of this design is a wasted
triage pass; the failure mode of the inverse is a confident, wrong
implementation.

- **`agent-ready`** — the gate. A large model has read this issue and
  confirmed it meets the authoring standard. **Only these may be handed to an
  implementer.** Anyone (you, a tech, a passing thought) can file an issue
  without one; it simply waits for triage.
- `needs-spec` — optional, and stronger than "unlabelled": a large model
  *has* looked and found specific gaps. Say what is missing in a comment.
- `blocked` — waiting on hardware, a CI run, or an external fact. Can coexist
  with `agent-ready` (specified, but not yet actionable).
- `venue` — requires physical presence at the venue; a human task, not an
  agent task.
- `protocol` — touches X32 OSC semantics. Verify against documentation, never
  memory; prefer a large model even for the implementation.

### Triage (large model)

Given an unlabelled issue: read it, fill in the template's sections, verify
any factual claims it rests on, resolve every open decision, enumerate the
tests — then add `agent-ready`. If it cannot be made ready (a fact is
unverified, a decision needs the owner), add `needs-spec` or `blocked` and
comment with exactly what is missing.

## Reviewing

Routine work is verified by the orchestrator (run the gates, check the
diff, exercise the UI in the browser). Reserve the `reviewer` agent
(Opus, read-only, see [.claude/agents/reviewer.md](../.claude/agents/reviewer.md))
for high-stakes changes — anything touching OSC index arithmetic, the routing
resolver, or the installer.
