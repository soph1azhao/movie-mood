# Movie Mood V8.2 — Process Retrospective & Master Route

**Status:** ACTIVE — Stage 4 release preparation  
**Current position:** `STAGE_4 — RELEASE PREPARATION`  
**State:** Runtime promotion complete (41 → 180 records); closure evidence complete; `v8.2.0` release pending.  
**Baseline:** V8.1 / Semantic-400  
**Target:** Finalize release preparation, commit intended scope, push, verify deployment, and tag `v8.2.0`.

> Streaming platforms help you find more movies.  
> Movie Mood helps you choose one.

> Movie Mood owns meaning. TMDB owns facts.

---

## 1. Why this document exists

V8.2 accumulated substantial production, semantic-safety, experimental, and governance work.

Most individual decisions were defensible, but the version lacked a sufficiently strong programme-level navigation layer. New risks repeatedly produced new protocols, experiments, repair paths, or closure mechanisms.

The result was:

```text
strong local decisions
+
weak global navigation
=
repeated loops and expanding scope
```

This document provides the missing navigation layer.

It has two purposes:

1. preserve the major lessons from how V8.2 reached its current state;
2. define the finite route from the current checkpoint to `v8.2.0`.

The **Current Master Route** below is the active navigation authority.

Earlier C1–C10 and hybrid-closure routes remain preserved as historical reasoning but are not the current execution map.

---

## 2. What V8.2 actually became

V8.2 began as catalogue promotion:

```text
Semantic-400
→ complete production records
→ validation
→ promotion
→ larger static runtime catalogue
```

In practice it exposed three distinct problems:

### A. Production generation

Can hundreds of complete Movie Mood records be generated reproducibly, economically, and safely?

### B. Semantic safety

Can plausible but unsupported editorial claims be prevented from entering Movie Mood copy?

### C. Production authorization

What evidence is sufficient for a generated record to become an actual runtime record?

These should have been treated as separate workstreams earlier.

Instead they repeatedly became sequential blockers of one another.

That is the principal process lesson of V8.2.

---

## 3. What V8.2 established

Several conclusions are now permanent.

### Structural correctness is not semantic correctness

Valid JSON, schema compliance, deterministic hashes, and successful process exit do not establish that editorial claims remain within their authorized source boundary.

### Model output is evidence, not authority

Writer, Critic, Verifier, or screening output cannot independently authorize production promotion.

### Human review should be risk-directed

Human attention should focus on semantic decisions that actually require judgment.

Mechanical failures should be detected and corrected before reaching the human reviewer.

### Machine can BLOCK; machine cannot ACCEPT

Deterministic tooling should prevent malformed, duplicated, mechanically defective, or contract-invalid work from reaching human review.

A machine block is not a semantic rejection, and a machine pass is not production approval.

Positive semantic authority remains human where the governing production contract requires it.

### Missing judgment must fail closed

No missing, malformed, skipped, or unexecuted semantic judgment may default to approval.

### Repair does not inherit prior approval

A repaired artifact must be approved as the repaired artifact.

Approval of superseded copy does not transfer.

### Retrospective evidence is not prospective validation

Development replay, prospective validation, and production authorization are separate evidence classes.

### Historical failures remain evidence

Failed or superseded artifacts should be preserved with explicit lineage rather than silently overwritten.

---

## 4. Why V8.2 required so much debugging

Some debugging exposed real requirements:

- provider/schema projection compatibility;
- durable dispatch intent;
- raw-response persistence;
- retry accounting;
- ambiguous-dispatch protection;
- restart/resume safety;
- authentication recovery;
- deterministic population accounting;
- post-write provenance.

These are permanent engineering improvements.

Other debugging should not recur:

- credential/environment mismatches investigated as provider failures;
- semantic equality depending on JSON key order;
- process exit 0 without proof that execution occurred;
- implicit semantic APPROVE defaults;
- batch writes without immediate read-back verification;
- preview filename/embedded-ordinal drift;
- repeated governance supersessions caused by late role decisions.

The permanent lesson is not “add more gates.”

It is:

> Design the complete state machine and its invariants before large execution.

---

## 5. Why the large human review happened

The exhaustive human review was not the original plan.

It became necessary after a frozen audit of automatically cleared records found a SEVERE semantic miss.

The subsequent full review showed that a large fraction of the automatically cleared cohort required revision.

Therefore the main lesson is not that all future records should receive exhaustive human review.

It is:

> Automatic semantic clearance must earn trust on a small, strongly reviewed population before being allowed to operate at scale.

Human review was the downstream containment mechanism.

The upstream automation assumption was the actual failure.

---

## 6. Superseded hybrid-closure direction

A later proposal attempted to reduce the second human-review burden using:

```text
repair
→ semantic screening
→ human review of flags
→ deterministic audit of screening PASSes
```

That route is no longer the production-closure path.

Current production authority requires candidate-specific human closure for targeted repairs.

Hybrid semantic screening remains diagnostic/advisory evidence only.

It must not produce production acceptance.

---

# 7. CURRENT MASTER ROUTE

The remainder of V8.2 is finite.

No new workstream may be introduced unless it fixes a demonstrated integrity defect or is required to satisfy one of the four stages below.

```text
CURRENT POSITION
        │
        ▼
STAGE 1
ASSISTED HUMAN CLOSURE
& EXCEPTION RESOLUTION
        │
        ▼
STAGE 2
PRODUCTION ASSEMBLY
& DRY-RUN VALIDATION
        │
        ▼
STAGE 3
HUMAN-GATED
RUNTIME PROMOTION
        │
        ▼
STAGE 4
V8.2 CLOSURE
        │
        ▼
v8.2.0
```

No Stage 5 exists.

---

# 8. STAGE 1 — Assisted Human Closure & Exception Resolution

## Historical Stage 1 entry point (completed)

*This section records the Stage 1 roadmap that has now completed; Stage 1 resolved all 150 normal T3 records and closed at 139 accepted films.*

## Population

Normal SCALE_TRANCHE_3:

```text
47 already human-approved clean
93 targeted repairs
 1 direct-review-required
 9 COPY_TOO_LONG quarantined records
────────────────────────────
150 normal T3
```

Separately:

```text
exp100-tmdb-1156593
```

remains outside normal-T3 accounting.

---

## 8.1 Targeted repair closure

The 93 repaired records require candidate-specific human closure.

Before human review:

```text
canonical repaired preview
        ↓
deterministic hygiene preflight
        ↓
mechanically clean?
   │             │
  yes            no
   │             ↓
   │       bounded re-repair
   │         MAXIMUM ONE
   │             ↓
   └──────→ deterministic recheck
                 ↓
             human closure
```

Machine checks may **BLOCK**.

Machine checks may not **ACCEPT** a targeted repair.

Positive production authority remains:

`ACCEPT_REPAIR`

from human closure.

If the one permitted re-repair still cannot satisfy the required constraints, the candidate must not enter an indefinite repair loop.

Use an explicit terminal disposition such as `EXCLUDED` or `DEFERRED` according to the governing contract.

### Batch rule for mechanically blocked repairs

If deterministic hygiene preflight blocks multiple repairs, do not repair them one-by-one interactively.

Instead:

1. collect all blocked candidates into one bounded batch input;
2. include only each candidate's exact machine-detected defects and frozen allowed source material;
3. issue one batch micro-repair task;
4. permit only minimal affected-field edits;
5. preserve unaffected fields byte-for-byte;
6. rerun the deterministic hygiene gate once;
7. send only mechanically clean records to human closure.

The batch operation does **not** increase the per-candidate repair budget: each candidate still receives at most one additional bounded repair.

---

## 8.2 COPY_TOO_LONG population

The nine `COPY_TOO_LONG` records are structural copy-length failures.

They must not be treated as major semantic or plot defects merely because they are quarantined.

Known shape:

- 8 over-length `description` fields;
- 1 over-length `whyWatch` field.

Required strategy:

```text
preserve meaning
+
minimal deterministic trimming
+
satisfy field-length contract
+
schema validation
```

Do not invent new story material.

Do not wholesale rewrite the movie.

Do not route these records through a Critic, Verifier, or semantic-regeneration experiment.

### Preferred implementation

Use a tiny local deterministic script with an **explicit candidate-specific trim map**.

The script may remove only preselected redundant modifiers, duplicated phrases, or nonessential trailing wording.

Do not implement a generic heuristic such as “delete the final phrase” or “remove arbitrary adjectives” across all records; such heuristics can change meaning.

The script must assert:

- only the intended field changed;
- all other editorial fields are byte-identical;
- resulting field length is within the frozen contract;
- schema validation passes.

Then proceed directly to normal reconciliation/required human authority under the production contract.

---

## 8.3 Direct-review record

The one direct-review-required T3 candidate must receive its required explicit disposition independently of the 93-repair population.

---

## 8.4 Deferred candidate

`exp100-tmdb-1156593` remains outside normal-T3 accounting.

Resolve it independently.

Its disposition may be:

- `ELIGIBLE`;
- `REJECTED`;
- `DEFERRED_BEYOND_V8_2`.

Its existence must never alter the normal-150 denominator.

---

## Stage 1 exit

Stage 1 completes only when:

- all 93 targeted repairs have terminal human closure outcomes;
- the direct-review candidate has a terminal disposition;
- all nine COPY_TOO_LONG records have terminal dispositions;
- the separately deferred candidate has an explicit disposition;
- normal T3 reconciles exactly to 150 unique records;
- no unresolved candidate silently disappears.

---

# 9. STAGE 2 — Production Assembly & Dry-Run Validation

Stage 2 begins only after Stage 1 closes.

First perform a production-infrastructure inventory.

Classify required capabilities as:

```text
A — IMPLEMENTED_AND_VERIFIED
B — IMPLEMENTED_UNVERIFIED
C — SPECIFIED_ONLY_OR_MISSING
```

Build only Category C capabilities required for promotion.

Expected work includes:

- production-record assembly;
- semantic + editorial + factual provenance joining;
- palette handling;
- promotion authorization binding;
- promotion transaction construction;
- recommendation-at-scale benchmark;
- catalogue completeness validation;
- deterministic dry run;
- identity reconciliation;
- post-write/read-back verification for generated staging artifacts.

Stage 2 must operate against the **actual accepted population**.

It must never assume that all 400 new records survived Stage 1.

Prefer existing native tools, assertions, tests, and Git mechanisms over new governance infrastructure.

---

# 10. STAGE 3 — Human-Gated Runtime Promotion

Runtime mutation occurs only after a successful dry run.

Required sequence:

```text
validated promotion transaction
        ↓
explicit human promotion authorization
        ↓
atomic runtime write
        ↓
immediate read-back verification
        ↓
tests
        ↓
typecheck
        ↓
build
        ↓
runtime/catalogue verification
        ↓
deployment verification
```

Existing 41 records must remain unchanged unless an independently authorized migration explicitly says otherwise.

---

# 11. STAGE 4 — V8.2 Closure

After successful runtime promotion:

- calculate the actual deployed population;
- document accepted / rejected / excluded / deferred counts;
- record provider/model usage and relevant economics;
- record human-review workload;
- finalize the V8.2 retrospective;
- update long-term `PROJECT_RETROSPECTIVE.md`;
- commit only intended V8.2 files;
- push;
- verify `main` and `origin/main`;
- create tag `v8.2.0`;
- publish release.

Then stop V8.2.

---

# 12. ABSOLUTE DO NOT rules for the remainder of V8.2

## DO NOT create new Critic / Verifier research

No new:

- online Critic experiment;
- online Verifier experiment;
- verifier prompt-tuning branch;
- semantic-ablation branch;
- model-comparison study;

unless a newly demonstrated V8.2 release-blocking integrity defect makes one unavoidable.

Improving the verifier further is future work, not normal V8.2 closure work.

---

## DO NOT inflate COPY_TOO_LONG into semantic failure

The nine COPY_TOO_LONG records require bounded trimming.

Do not reinterpret a length failure as evidence that their complete plots or editorial records must be regenerated.

---

## DO NOT force a 441-film result

The maximum planning arithmetic is:

```text
41 existing
+
up to 400 new accepted
=
up to 441
```

`441` is not a quota.

It is not a success criterion.

If a candidate cannot safely converge under its bounded remediation path:

```text
EXCLUDE / REJECT / DEFER
```

as appropriate.

Never lower standards, bypass closure, or invent replacement evidence to preserve a catalogue-count target.

The final runtime count must be derived from actual accepted records.

---

# 13. New-work admission rule

For the rest of V8.2, every proposed substantial task must answer internally:

1. Which current stage does this belong to?
2. Which stage exit criterion does it advance?
3. Does it introduce a new experiment or workstream?
4. Does it change an existing frozen authority?

If it does not advance the active stage or fix a demonstrated release-blocking integrity defect:

`DEFER_TO_LATER_VERSION`.

Do not create a new protocol merely because another artifact might make the process look more complete.

---

# 14. Anti-bureaucracy execution rules

The master route exists to **reduce** process overhead.

Therefore:

- prefer one-line/code-level assertions, unit tests, CI checks, and Git-native operations over new governance ledgers;
- create a persistent protocol/ledger only when reproducibility or an existing production contract genuinely requires it;
- machine checks should block mechanically defective work before human review;
- do not force a human to manually reject something a deterministic tool can safely reject;
- do not repeat the master-route/status template during ordinary within-stage work;
- summarize navigation state only when admitting a new substantial task, changing stages, or resolving a material authority conflict;
- prefer simple native mechanisms over custom governance tools;
- do not turn documentation hygiene into a release blocker unless it affects correctness or traceability.

---

# 15. Stop rule

No Stage 5 exists.

No C11 exists.

No additional research programme should naturally grow out of the V8.2 closure sequence.

After Stage 4:

```text
tag v8.2.0
→ release
→ close V8.2
```

Unresolved improvement ideas become future-version backlog.

---

# 16. Core retrospective lesson

V8.2 did not suffer from insufficient rigor.

It suffered from rigorous local decision-making without an equally rigorous programme-level navigation system.

The lesson is therefore not:

> validate less.

It is:

> decide earlier what validation exists for, where it belongs, and when it is enough.

V8.2 should preserve:

- source authority;
- provenance;
- fail-closed execution;
- bounded remediation;
- human semantic authority where required;
- immutable evidence;
- explicit promotion authorization.

It should stop repeating:

- open-ended experimentation;
- late role changes;
- duplicated governance;
- implicit defaults;
- uncontrolled repair loops;
- target-count-driven exceptions.

**Keep the discipline. Remove the wandering.**
