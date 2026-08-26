# Movie Mood — Codex Instructions

## Repository

Work only in:

```text
/Users/hermes/code/movie-mood
```

At the start of a new Codex conversation, verify the repository and remote before modifying files.

Expected origin:

```text
https://github.com/soph1azhao/movie-mood.git
```

If the current directory is not this repository, stop before making changes.

---

## Sources of Truth

Follow this order:

1. explicit instruction in the current user task
2. current version implementation specification
3. this `AGENTS.md`
4. existing repository conventions

For V3, the product and technical source of truth is:

```text
docs/V3_IMPLEMENTATION_SPEC.md
```

Do not invent features outside the current specification.

Do not repeat the full specification in task responses.

---

## Scope Discipline

Implement the requested phase completely.

Do not implement later phases early.

Preserve working behavior unless the specification explicitly changes it.

Prefer the smallest coherent change that satisfies the acceptance criteria.

Do not redesign unrelated code.

Ask only when a missing decision materially affects:

* product behavior
* architecture
* data integrity
* Git safety

Make reasonable small implementation decisions independently.

---

## Engineering Approach

Keep the project intentionally simple.

Prefer:

* readable TypeScript
* existing React patterns
* small reusable components
* pure utilities for non-UI logic
* native browser features
* minimal dependencies
* deterministic behavior
* code a beginner can follow

Before creating a new helper or abstraction, check whether existing code can be reused.

Do not move working logic merely for stylistic consistency.

---

## Architecture Boundaries

Unless the current version specification explicitly requires otherwise, do not add:

* backend services
* databases
* authentication
* external APIs
* AI features
* routing
* global state libraries
* CSS/component frameworks
* unnecessary dependencies

Do not change GitHub Pages deployment configuration unless the task requires it.

---

## Implementation Tasks

When asked:

```text
Implement V3 Phase X
```

1. read the relevant phase and acceptance criteria in `docs/V3_IMPLEMENTATION_SPEC.md`
2. inspect the existing code affected by that phase
3. implement only that phase
4. verify according to risk
5. fix discovered issues
6. report the result concisely
7. stop before commit or push

Do not stop after producing a plan when implementation was requested.

---

## Risk-Based Verification

Use verification proportional to the change.

### Low risk

Examples:

* documentation
* copy
* isolated CSS
* mechanical metadata

Verify the relevant change and ensure no unrelated files changed.

### Medium risk

Examples:

* React components
* normal state wiring
* contained refactors
* view interactions

Run:

* production build or relevant type check
* focused behavior verification

### High risk

Examples:

* filtering/matching/discovery logic
* persistence
* recommendation cycling
* shared state architecture
* deployment configuration
* logic with multiple edge cases

Run:

* production build
* relevant automated tests
* targeted edge-case/regression checks

Prefer a small automated test when reusable logic has meaningful edge cases.

Do not repeatedly perform heavyweight checks for low-risk changes without a concrete reason.

---

## Testing

Use the existing project test tooling.

If the current specification introduces test tooling, keep it minimal.

Tests should focus on stable reusable behavior, especially:

* filtering
* matching
* discovery ordering
* similarity logic
* persistence parsing
* cycling edge cases

Avoid low-value snapshot coverage.

When fixing a regression in reusable logic, add or update a test when practical.

---

## Git Safety

Never overwrite, revert, restore, stage, or commit unrelated user work.

Before staging:

* inspect working-tree changes
* identify files belonging to the current phase

Stage only approved phase files.

Keep commits phase-scoped.

---

## Phase Completion

When asked:

```text
Complete V3 Phase X
```

1. confirm the phase implementation exists
2. run only the verification still needed for completion
3. stage only phase-related files
4. inspect the staged file list
5. commit with a concise phase-specific message
6. push to `origin/main`
7. confirm the working tree is clean
8. confirm local `main` and `origin/main` are aligned

Do not require a separate push request unless a Git safety issue blocks completion.

Do not amend or rewrite unrelated history.

---

## Reasoning Level

Use **medium reasoning** by default.

Use higher reasoning only when the work genuinely requires it, such as:

* difficult architecture
* nontrivial matching logic
* hard regressions
* subtle state interactions

Do not spend high reasoning effort on routine CSS, documentation, or mechanical edits.

---

## Communication

Keep reports concise.

After implementation, report:

* what was implemented
* verification result
* materially changed files
