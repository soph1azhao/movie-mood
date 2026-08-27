# Movie Mood — Agent Instructions

## Repository

Work only in:

```text
/Users/hermes/code/movie-mood
```

At the start of a new agent session, verify the repository and remote before modifying files.

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

For versioned implementation work, the product and technical source of truth is:

```text
docs/V<N>_IMPLEMENTATION_SPEC.md
```

where `<N>` is the version named in the current task.

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

- product behavior
- architecture
- data integrity
- Git safety

Make reasonable small implementation decisions independently.

---

## Engineering Approach

Keep the project intentionally simple.

Prefer:

- readable TypeScript
- existing React patterns
- small reusable components
- pure utilities for non-UI logic
- native browser features
- minimal dependencies
- deterministic behavior
- code a beginner can follow

Before creating a new helper or abstraction, check whether existing code can be reused.

Do not move working logic merely for stylistic consistency.

---

## Architecture Boundaries

Unless the current version specification explicitly requires otherwise, do not add:

- backend services
- databases
- authentication
- external APIs
- AI features
- routing
- global state libraries
- CSS/component frameworks
- unnecessary dependencies

Do not change GitHub Pages deployment configuration unless the task requires it.

---

## Phase Execution Convention

When asked:

```text
Execute V<N> Phase X
```

1. Read the relevant phase and acceptance criteria from `docs/V<N>_IMPLEMENTATION_SPEC.md`.
2. Inspect the existing code needed for that phase.
3. Implement only the requested phase.
4. Run risk-appropriate verification and automated tests.
5. Fix issues found during verification.
6. If all required checks pass:
   - inspect the working-tree changes,
   - stage only files belonging to the phase,
   - verify the staged file list contains no unrelated changes,
   - commit with a concise phase-specific message,
   - push to `origin/main`,
   - confirm the working tree is clean,
   - confirm local `main` and `origin/main` are aligned.
7. Report concisely:
   - what was implemented,
   - checks performed and result,
   - commit SHA,
   - any material limitation or assumption.

Stop before commit only if:

- a material product or architecture decision is unresolved,
- required verification cannot be made to pass safely,
- unrelated user changes create Git risk,
- or another genuine blocker requires user input.

Do not require a separate implementation, approval, commit, or push prompt for a normally successful phase.

Do not stop after producing a plan when implementation was requested.

---

## Risk-Based Verification

Use verification proportional to the change.

### Low risk

Examples:

- documentation
- copy
- isolated CSS
- mechanical metadata

Verify the relevant change and ensure no unrelated files changed.

### Medium risk

Examples:

- React components
- normal state wiring
- contained refactors
- view interactions

Run:

- production build or relevant type check
- focused behavior verification

### High risk

Examples:

- filtering/matching/discovery logic
- persistence
- recommendation cycling
- shared state architecture
- deployment configuration
- logic with multiple edge cases

Run:

- production build
- relevant automated tests
- targeted edge-case/regression checks

Prefer a small automated test when reusable logic has meaningful edge cases.

Do not repeatedly perform heavyweight checks for low-risk changes without a concrete reason.

---

## Testing

Use the existing project test tooling.

If the current specification introduces test tooling, keep it minimal.

Tests should focus on stable reusable behavior, especially:

- filtering
- matching
- discovery ordering
- similarity logic
- persistence parsing
- cycling edge cases
- decision-state logic
- URL-state parsing

Avoid low-value snapshot coverage.

When fixing a regression in reusable logic, add or update a test when practical.

---

## Git Safety

Never overwrite, revert, restore, stage, or commit unrelated user work.

Before staging:

- inspect working-tree changes
- identify files belonging to the current phase

Stage only approved phase files.

Keep commits phase-scoped.

Do not amend or rewrite unrelated history.

---

## Reasoning Effort

Use moderate reasoning effort by default.

Use greater reasoning effort only when the work genuinely requires it, such as:

- difficult architecture
- nontrivial matching logic
- hard regressions
- subtle state interactions

Do not spend excessive reasoning effort on routine CSS, documentation, or mechanical edits.

---

## Communication

Keep reports concise.

After implementation, report:

- what was implemented
- verification result
- materially changed files
- important assumption, limitation, or blocker if one exists

Do not narrate routine commands.

Do not restate the full specification.

Do not dump entire files unless explicitly requested.

A normal successful report should be only a short summary plus checks.
