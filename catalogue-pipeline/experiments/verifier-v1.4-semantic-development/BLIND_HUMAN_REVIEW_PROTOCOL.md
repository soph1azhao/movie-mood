# Movie Mood V8.2 — Candidate Verifier v1.4 Review Protocol

- **Protocol Version**: `verifier-blinded-ai-assisted-review-protocol.v1`
- **Workflow Formally Designated**: `VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION`
- **Activity**: `VERIFIER_V14_P2_1_BLIND_REVIEW_INFRASTRUCTURE_FREEZE`
- **Classification**: `RETROSPECTIVE_SEMANTIC_DEVELOPMENT_EVALUATION`
- **Governance State**: `PAUSED_FOR_SEVERE_AUDIT_MISS`
- **Adjudication Standard**: `A_PRIME_PRODUCTION_MATERIALITY_V1` (`sha256:21661892df4d1b009341b6d34de3bf5ad1ae17e3447abbdace15e1c31a5b843c`)
- **Primary Human Adjudicator**: Sophia Zhao
- **Option Selected**: `OPTION_B_FRESH_RETROSPECTIVE_BLIND_HUMAN_REVIEW`

---

## 1. Objective & Epistemic Framework

This protocol governs the retrospective review required to establish authoritative ground-truth labels for the Candidate Verifier v1.4 paired semantic evaluation ($N=60$ target cohort: exactly $30$ CLEAN, exactly $30$ DEFECT_POSITIVE, with $\ge 6$ SEVERE defect cases).

### Explicit Epistemic Designation: `VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION`
This review workflow is **NOT** a fully unassisted, blind human audit.
The human adjudicator (Sophia Zhao) is:
- **Verifier-Blinded**: Has zero visibility into Candidate Verifier predictions, verifier risk levels, past verifier decisions, or repair histories.
- **Quota-Blinded**: Has zero visibility into cohort quota progress, remaining severe case requirements, or current class balances during candidate adjudication.
- **AI-Assisted**: Inspects independent preliminary advisory opinions from Gemini and Claude alongside the source packet before rendering the final human decision.

Claims of fully unassisted human blind review are strictly forbidden; this protocol supports and specifies `VERIFIER_BLINDED_AI_ASSISTED_HUMAN_ADJUDICATION`.

---

## 2. Review Invariants & Isolation Firewalls

1. **Content-Blind Sequence**: Candidates must be evaluated strictly in the deterministic order specified by `blind-review-order.v1.json`. No candidate may be skipped, fast-forwarded, or prioritized based on genre, title, character names, linguistic markers, or predicted severity.
2. **Strict Blinding**: The review packet supplied to adjudicators contains ONLY authorized source facts, overview, accepted semantic classifications, boundary rules, and visible editorial copy (`description`, `whyWatch`, `curiosityHook`, `vibeSummary`).
   - ZERO verifier outputs, risk scores, or historical audit verdicts are included.
   - ZERO prior human decisions or repair histories are included.
   - ZERO quota status or remaining target indicators are shown on the active review packet.
3. **Review Interface Privacy**: During active review, the interface presents one candidate at a time. The adjudicator is not informed how many severe cases remain needed or which decision would satisfy stopping conditions sooner. Aggregate progress may only be viewed after a decision is committed.
4. **Primary Human Authority**: Sophia Zhao's final decision is the authoritative primary ground truth. Model preliminary opinions (Gemini and Claude) are strictly advisory.

---

## 3. Advisory AI Review Workflow

For each candidate in the sequential queue:
1. **Independent Preliminary Generation**:
   - Gemini receives the blind packet and `review-prompts/verifier-v14-gemini-preliminary.v1.md`.
   - Claude receives the blind packet and `review-prompts/verifier-v14-claude-preliminary.v1.md`.
   - Both models generate structured preliminary decisions (`APPROVE` vs `REVISE`), severity (`MINOR` vs `SEVERE`), affected fields, and claim-level evidence conforming to `preliminary-advisory-review.schema.v1.json`.
   - Neither model sees the other's prompt, outputs, or internal reasoning.
   - If a provider is unavailable, `MODEL_REVIEW_UNAVAILABLE` is recorded; candidate status immediately becomes `REVIEW_PAUSED_PENDING_ADVISORY`.
2. **Advisory Availability Rule**:
   - **`BOTH_PRELIMINARY_ADVISORIES_REQUIRED_BEFORE_PRIMARY_HUMAN_ADJUDICATION`**: Both independent preliminary advisory records (Gemini and Claude) must be successfully generated, schema-validated against `preliminary-advisory-review.schema.v1.json`, envelope-validated against `preliminary-advisory-record.schema.v1.json`, and cryptographically bound to the exact blind packet SHA-256 before the candidate may be presented for primary human adjudication.
   - If either advisory is unavailable, malformed, schema-invalid, or packet-binding-invalid, the candidate status immediately becomes:
     ```text
     REVIEW_PAUSED_PENDING_ADVISORY
     ```
   - Sophia Zhao does NOT issue final ground truth under a single advisory. Silent continuation with one advisory is strictly forbidden.

3. **Human Adjudication**:
   - Sophia Zhao inspects the blind packet alongside both validated preliminary advisory records.
   - Sophia Zhao makes the authoritative final determination (`APPROVE` or `REVISE`, with `finalSeverity` null or `MINOR`/`SEVERE`).
   - An immutable adjudication record is committed conforming to `human-adjudication-record.schema.v1.json`, cryptographically binding the candidateId, blind packet hash, and both advisory record SHA-256 hashes.

---

## 4. Frozen Adjudication Rubric (`A_PRIME_PRODUCTION_MATERIALITY_V1`)

All preliminary model opinions and final human adjudications must strictly adhere to the verified production materiality standard (`sha256:21661892df4d1b009341b6d34de3bf5ad1ae17e3447abbdace15e1c31a5b843c`):

### Core Principle
> "Editorial inference is acceptable when it does not materially alter a viewer's understanding or expectation of the film. Low-risk figurative language, genre shorthand, atmospheric inference, metaphorical urgency, and minor contextual concretization may be accepted even when not literally stated in the authorized packet, provided they do not function as a meaningful new factual claim. Unsupported additions require intervention when they materially change or falsely specify plot mechanics, identity, relationships, motives, causality, factual attributes, locations, quantities, franchise history, spoiler boundaries, or other decision-relevant viewer expectations."

### Primary Decisions
- **`APPROVE` (CLEAN)**: Copy satisfies source boundaries. Any flourishes represent non-material editorial inference or low-risk figurative phrasing. `finalSeverity` must be `null`, `affectedFields` must be `[]`, and `materialIssues` must be `[]`.
- **`REVISE` (DEFECT_POSITIVE)**: Copy asserts one or more concrete factual propositions unsupported by or contradicted by the authorized packet. `finalSeverity` must be `"MINOR"` or `"SEVERE"`, `affectedFields` must contain $\ge 1$ field, and `materialIssues` must contain $\ge 1$ item.

### Severity Assignment
- **`MINOR`**: A fixable unsupported concrete claim or overstatement that warrants bounded revision but is not a severe material failure.
- **`SEVERE`**: A material contradiction, leak, invention, distortion, or unauthorized concrete detail likely to mislead a viewer or materially alter expectations.

### Eight Standard Violation Categories
1. **Material Source-Boundary Violation**: Factual claim contradictory to or entirely absent from authorized packet.
2. **Harmless Stylistic Variation**: Atmospheric or tonal rhetoric that introduces no actionable factual assertion (Tolerated under `APPROVE`).
3. **Unsupported Factual Concretization**: Narrowing or detailing an unspecified element beyond source authority.
4. **Unsupported Causal/Mechanistic Inference**: Inventing reasons, motives, or mechanisms connecting events.
5. **Alias / Terminology Substitution**: Introducing unverified character names, titles, or technical terms.
6. **Setting / Duration / Quantity Escalation**: Inventing specific rooms, dates, time limits, or numerical quantities.
7. **External-Lore Import**: Introducing real-world, sequel, prequel, or comic lore not present in the packet.
8. **Spoiler / Reveal Boundary Violation**: Leaking late-film twists, resolutions, or protected reveals.

---

## 5. Sequential Review Stopping Rule

Review progresses candidate by candidate in the frozen order. After each completed adjudication, aggregate counts are updated. Review halts if and only if ALL THREE criteria are satisfied:
1. `CLEAN >= 30`
2. `DEFECT_POSITIVE >= 30`
3. `SEVERE_DEFECT_POSITIVE >= 6`

If the pool of eligible unexposed candidates ($N=184$) is exhausted before all three quotas are achieved, the review halts with:
```text
VERIFIER_V14_P2_REVIEW_POOL_INSUFFICIENT
```
Under no circumstances may thresholds be lowered or candidates cherry-picked out of order.

---

## 6. Second-Review QA & Disagreement Resolution

Upon meeting stopping criteria:
1. **QA Sampling**:
   - 100% of all final human-adjudicated `SEVERE` cases are selected for QA.
   - Exactly $\lceil 0.25 \times \text{nonSevereCompletedCount} \rceil$ cases are drawn deterministically using seed `VERIFIER_V14_P2_SECOND_REVIEW_QA|deda014|source-boundary-risk-verifier.v1.4-semantic-development.r1`.
2. **Second Reviewer**:
   - Independent second review (`INDEPENDENT_HUMAN_SECOND_REVIEW` preferred, or explicitly labeled `SECOND_REVIEW_AI_AUDIT`).
   - Conducted blind to Sophia Zhao's original decision and advisory AI opinions.
3. **Disagreement Resolution**:
   - Governed by `adjudication-correction-protocol.v1.json`.
   - Disagreements trigger an audit reconciliation record; no silent label overwrites are permitted.
   - Ground truth updates require explicit, versioned correction records.
