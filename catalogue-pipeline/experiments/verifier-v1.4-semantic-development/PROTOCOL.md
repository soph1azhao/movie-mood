# Candidate Verifier v1.4 Semantic Intervention Paired Development Protocol

- **Protocol ID**: `source-boundary-risk-verifier.v1.4-semantic-development.r1`
- **Activity**: `VERIFIER_V1_4_SEMANTIC_INTERVENTION_PAIRED_DEVELOPMENT`
- **Classification**: `RETROSPECTIVE_SEMANTIC_DEVELOPMENT_EVALUATION`
- **Dataset**: `INDEPENDENT_RETROSPECTIVE_DEVELOPMENT_SET`
- **Current Governance State**: `PAUSED_FOR_SEVERE_AUDIT_MISS`
- **Status**: `PREREGISTERED_PHASE_P1`

---

## 1. Executive Summary & Estimand

### Estimand
> "The incremental semantic effect of Candidate Verifier v1.4 source-boundary instructions relative to v1.3 instructions, conditional on Gemini 3.8 Flash operating with thinkingLevel=low."

Low thinking is a fixed engineering baseline established by the technical ablation. This study does **NOT** estimate the independent effect of thinking level.

### Governance Boundary
This study is a retrospective semantic development evaluation only. It is **NOT**:
- prospective validation
- confirmation
- production validation
- production readiness
- promotion authorization

The strongest possible future advancement consequence of this development study is:
```text
ELIGIBLE_TO_PREREGISTER_PROSPECTIVE_SEMANTIC_VALIDATION
```
Governance remains strictly `PAUSED_FOR_SEVERE_AUDIT_MISS` even if all development advancement gates pass.

---

## 2. Lineage & Source Evidence Bindings

| Artifact / Evidence | Path | Commit / Byte SHA-256 |
| :--- | :--- | :--- |
| **v1.3 Execution Evidence** | Git commit | `4fb22ef` |
| **v1.3 Retrospective Reconciliation** | Git commit | `196b08089e0faa02b4841a6ef4f2ebc4ed13da31` |
| **Low-Thinking Technical Reconciliation** | Git commit | `eade852` |
| **Semantic FN Taxonomy** | `catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/semantic-false-negative-taxonomy.v1.json` | `3e7c803` (`sha256:b551f5b7aff4ebb8552308858af832e2fc216d5d7eb7d3afc748ad2113e4bf8a`) |
| **v1.3 Candidate Prompt** | `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md` | `sha256:93c9a185620012609998ad8e58e4c68c9c945fd100820f2cc93c64385cdd402b` |
| **v1.3 Output Schema** | `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json` | `sha256:aa73ad6463e47c835186f8f2705f5c46167cd053ec43c1a0d72014ccc68c26dc` |
| **v1.3 Contract Validator** | `catalogue-pipeline/scripts/validateVerifierV13Contract.mjs` | `sha256:258c1520779fd147bf9c4aaa1c31c385d1da1fbd0f4835d381e30f767efab5b6` |
| **v1.4 Candidate Prompt** | `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md` | `sha256:a2fe3ef32f5b417544276401d5b520274fc77ef97753da61c253032b3f1e0d7f` |
| **Development Exposure Policy** | `catalogue-pipeline/experiments/verifier-v1.4-semantic-development/development-exposure-policy.v1.json` | `sha256:b5e9b655644bb0af931bd151b99b9bada8e21f0a8add2a9d8a52ad826b7bb04b` |
| **Prompt Exposure Lint** | `catalogue-pipeline/experiments/verifier-v1.4-semantic-development/prompt-exposure-lint.v1.json` | `sha256:5b5eb8c2075b9dab8c8591a12d7055ef82f3a0bc194a029f451c5a8ef926a055` |

---

## 3. Experimental Design

Three near-contemporaneous calls are planned per future evaluation candidate:

- **Arm A (Baseline)**: Fresh concurrent v1.3 semantic prompt with `thinkingLevel=low`.
- **Arm A' (Repeatability Control)**: Byte-identical v1.3 semantic prompt with `thinkingLevel=low`.
- **Arm B (Intervention)**: v1.4 semantic prompt with `thinkingLevel=low`.

### Controlled Variables
- **Provider**: Google Gemini Developer API
- **Model**: `gemini-3.8-flash`
- **Thinking Level**: `low` across Arm A, Arm A', and Arm B
- **Temperature**: `0.0`
- **Max Output Tokens**: `6144`
- **Timeout**: `30000 ms`
- **Schema**: Unchanged v1.3 schema (`source-boundary-risk-verifier.v1.3.schema.json`)
- **Validator**: Unchanged v1.3 contract validator (`validateVerifierV13Contract.mjs`)
- **Few-Shot Examples**: None
- **Automatic Retries**: `0` (strictly forbidden)

### Target Future Cohort Quota
- **Total Candidates ($N$)**: `60`
- **Defect-Positive Records**: `30`
- **Clean Records**: `30`
- **Minimum Severe Defect-Positive Records**: `6`
- **Planned Primary Calls**: $60 \times 3 = 180$ calls.
- **Phase P1 Status**: Candidates are **NOT** selected or inspected in Phase P1. P1 freezes protocol, prompt, firewall, and lint only.

---

## 4. Candidate Verifier v1.4 Semantic Rules

The v1.4 prompt introduces seven general decision rules without changing schema contracts or using candidate-specific heuristics:

1. **Rule 1 — Packet Authority**: A claim is grounded only when the supplied packet authorizes it. Plausibility, external familiarity, genre convention, cultural knowledge, or factual truth about the underlying movie does not establish packet authorization. The verifier must judge packet fidelity, not real-world truth.
2. **Rule 2 — Editorial Form Does Not Reduce Factual Scrutiny**: Factual propositions inside `curiosityHook` questions, rhetorical questions, headings, stylistic framing, and declarative copy must receive equal scrutiny. Question form confers no exemption.
3. **Rule 3 — Specificity Preservation**: A broad source fact does not automatically authorize a materially narrower claim. Audit specificity shifts involving location / micro-location, duration, quantity, chronology, identity, relationship, motive, mechanism, consequence, or factual category. If the packet supports only a broader statement, a more specific editorial claim remains unsupported.
4. **Rule 4 — No Unsupported Inferential Completion**: Do not supply unstated causes, motives, mechanisms, narrative rules, consequences, stakes, relationships, or background explanations merely because they are compatible with authorized facts.
5. **Rule 5 — Identity and Terminology Fidelity**: Do not automatically treat aliases, monikers, epithets, franchise terms, political categories, legal terms, historical terms, medical terms, ideological terms, or domain-specific near-synonyms as interchangeable. Domain-specific or closely related terms are not automatically interchangeable; semantic similarity alone does not establish packet authorization.
6. **Rule 6 — Genre / World Knowledge Is Non-Authoritative**: Distinguish between `PLAUSIBLE` and `PACKET_AUTHORIZED`. Genre expectations and external knowledge cannot fill evidentiary gaps. Only `PACKET_AUTHORIZED` claims satisfy source boundaries.
7. **Rule 7 — Positive Low-Risk Coverage**: `LOW_RISK` cannot mean only "nothing obviously wrong was noticed." Affirmatively inspect every visible editorial field for unsupported concretization, inferential completion, causal/motive sharpening, terminology substitution, alias import, setting/time/quantity escalation, unstated mechanisms, or consequences.

---

## 5. Methodological Limitations

1. **Bundled Intervention**: v1.4 is evaluated as one bundled semantic prompt intervention. The study cannot identify which individual rule caused any later improvement or degradation. No component-level causal claim is permitted.
2. **Thinking-Level Limitation**: Results apply only to v1.4 under `thinkingLevel=low`. Failure of v1.4-low would not prove that the semantic principles are universally ineffective. Prompt $\times$ thinking-level interaction is outside this study.
3. **Balanced-Cohort Interpretation**: The 30/30 class balance is constructed. Sensitivity and specificity are legitimate development operating characteristics. Prevalence-dependent quantities (PPV, NPV, review burden, positive-call rate) must be marked `CONSTRUCTED_COHORT_DESCRIPTIVE_ONLY`.

---

## 6. Evaluation Framework & Analytical Layers

### A/A' Repeatability Control
- Same-prompt stochastic noise-floor control.
- Repeatability gates: Overall agreement $\ge 0.90$, defect-positive agreement $\ge 0.90$, clean agreement $\ge 0.90$.
- Repeatability technical completeness: Arm A' technical-invalid rate $\le 0.05$, A/A' pairwise-valid defect-positive $\ge 28/30$, A/A' pairwise-valid clean $\ge 28/30$.
- If any fails: `INCONCLUSIVE_TECHNICAL_OR_STOCHASTIC_INSTABILITY`.
- Technical-invalid calls are accounted for separately under technical completeness; semantic agreement is evaluated only where both outputs are valid. Invalid outputs cannot be converted into semantic LOW or HIGH.

### Layer A: Valid Paired Semantics
- Evaluated exclusively on records where **BOTH** Arm A and Arm B produced valid semantic outputs.
- Technical-invalid outcomes are **NEVER** semantic TPs.
- Transitions:
  - Defect-Positive:
    - Rescue: Arm A LOW $\rightarrow$ Arm B HIGH
    - Regression: Arm A HIGH $\rightarrow$ Arm B LOW
    - Persistent Detection: Arm A HIGH $\rightarrow$ Arm B HIGH
    - Persistent Escape: Arm A LOW $\rightarrow$ Arm B LOW
  - Clean:
    - Introduced FP: Arm A LOW $\rightarrow$ Arm B HIGH
    - Repaired FP: Arm A HIGH $\rightarrow$ Arm B LOW
    - Persistent Clean: Arm A LOW $\rightarrow$ Arm B LOW
    - Persistent FP: Arm A HIGH $\rightarrow$ Arm B HIGH

### Layer B: All-Record Fail-Closed Routing
- Evaluates full operational routing where all technical-invalid outcomes route to human review.
- Layer B must never be used to inflate semantic sensitivity.
- Reports: review burden, defect containment, clean unnecessary routing, technical-failure routing, escaped defects.

---

## 7. Technical Completeness Gate

Dual governance structure:
- **A/B Technical Completeness (Governs Semantic Treatment Comparison)**:
  - Arm A technical-invalid rate $\le 0.05$.
  - Arm B technical-invalid rate $\le 0.05$.
  - Pairwise-valid defect-positive A/B records $\ge 28 / 30$.
  - Pairwise-valid clean A/B records $\ge 28 / 30$.
  - Otherwise: study outcome is `INCONCLUSIVE`.
- **A/A' Technical Completeness (Governs Repeatability Control Interpretation)**:
  - Arm A' technical-invalid rate $\le 0.05$.
  - Pairwise-valid defect-positive A/A' records $\ge 28 / 30$.
  - Pairwise-valid clean A/A' records $\ge 28 / 30$.
  - Otherwise: repeatability outcome is `INCONCLUSIVE_TECHNICAL_OR_STOCHASTIC_INSTABILITY`.
- Automatic retries: `0` across all arms.

---

## 8. Statistical Plan
- **Defect-Positive Comparison**: One-sided exact McNemar test.
  - Alternative hypothesis: v1.4 produces more rescues than regressions ($\text{rescues} > \text{regressions}$).
  - Significance level: $\alpha = 0.05$. Strict comparator: $p < 0.05$ (`pValueComparator: "LT"`, `requiredPValueStrictlyLessThan: 0.05`).
  - 95% Wilson score confidence intervals reported for Arm A and Arm B sensitivity.
- **Clean Comparison**: 95% Wilson score confidence intervals for specificity; reported counts for introduced FP, repaired FP, and net clean harm ($\text{introducedFP} - \text{repairedFP}$). Failure to reject a significance test must not be treated as proof of specificity equivalence.

---

## 9. Advancement Gates

All gates combine with strict logical **AND** (no compensatory passing):

- **Gate A — Repeatability**: Overall agreement $\ge 0.90$, defect-positive agreement $\ge 0.90$, clean agreement $\ge 0.90$, Arm A' invalid $\le 0.05$, pairwise-valid A/A' defect-positive $\ge 28$, pairwise-valid A/A' clean $\ge 28$.
- **Gate B — Technical Integrity**: Arm A invalid $\le 0.05$, Arm B invalid $\le 0.05$, pairwise-valid A/B defect-positive $\ge 28$, pairwise-valid A/B clean $\ge 28$.
- **Gate C — Sensitivity Floor**: Arm B valid-pair sensitivity $\ge 0.75$.
- **Gate D — Paired Defect Improvement**: $\text{rescues} - \text{regressions} \ge 5$ AND strict one-sided exact McNemar $p < 0.05$ (`pValueComparator: "LT"`).
- **Gate E — Specificity Floor**: Arm B valid-pair specificity $\ge 0.85$.
- **Gate F — Anti-Overflagging**: Introduced false positives $\le 2$ AND net clean harm $\le 2$.
- **Gate G — Severe Safety**: Evaluation cohort severe count $\ge 6$ AND Arm B severe semantic escapes $= 0$. (Development safety policy; not statistical proof of zero population risk).

---

## 10. Provider / Execution Control
- Triplet order determined by frozen deterministic randomized schedule across all six permutations:
  - `A-A_PRIME-B`: exactly 10
  - `A-B-A_PRIME`: exactly 10
  - `A_PRIME-A-B`: exactly 10
  - `A_PRIME-B-A`: exactly 10
  - `B-A-A_PRIME`: exactly 10
  - `B-A_PRIME-A`: exactly 10
  - Total: $10 \times 6 = 60$ candidates.
- Target execution window: $\le 2$ hours.
- Per-call audit logging: request timestamp, response timestamp, model/version identifier, request hash, raw response hash.
- Mid-run model mutation rule: If provider model version changes mid-run, halt immediately with `INCONCLUSIVE_PROVIDER_MODEL_MUTATION`.

---

## 11. Exposure Firewall Policy
- Excluded sets:
  - 7 semantic FN taxonomy records: `DEVELOPMENT_EXPOSED`
  - 4 technical-ablation records: `DEVELOPMENT_EXPOSED`
  - 30 v1.3 replay cohort records: `DEVELOPMENT_EXPOSED`
  - Prior development fixtures: `DEVELOPMENT_EXPOSED`
- Prospective holdout: `RESERVED_PROSPECTIVE_DO_NOT_ACCESS` (strictly sealed and inaccessible).
- `p2ExposureLedgerReconciliationRequired`: `true` (No candidate may become evaluation-eligible until P2 reconciles all prior manually inspected/test/development candidate IDs into a complete exclusion ledger).
