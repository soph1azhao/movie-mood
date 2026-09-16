# Verifier v1.2 Retrospective Development Replay Protocol

**Protocol Status**: `PREREGISTERED_NOT_EXECUTED`  
**Governance State**: `PAUSED_FOR_SEVERE_AUDIT_MISS`  
**Dataset Classification**: `RETROSPECTIVE_DEVELOPMENT_SET`  
**Evaluation Scope**: Development-set diagnostic evaluation only. NOT prospective validation, confirmation, or production authorization.

---

## 1. Experiment Question & Purpose

### Primary Research Question
> When Candidate Verifier v1.2 is applied to the frozen T2 retrospective development set, how often does it identify human-confirmed source-boundary defects, how often does it over-route human-approved records, and what failure modes remain?

### Standardized Terminology
- **Activity Classification**: `RETROSPECTIVE_DEVELOPMENT_REPLAY`
- **Metric Classification**: `APPARENT_RETROSPECTIVE_PERFORMANCE`
- **Prohibited Terms**: Do not describe this experiment as "validation", "confirmation", "prospective performance", or "production readiness".

---

## 2. Bound Candidate Implementation & Lineage

This protocol strictly binds the accepted candidate implementation materialized in checkpoint `17b52f7901fa254953636ac08608f29c3072782d`:

- **Candidate Prompt**: `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.md`
  - Byte Hash: `sha256:f173ba79458c3178e301299632a183fa9cc7138b40f31db0821e9c520af19760`
- **Candidate Schema**: `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.schema.json`
  - Canonical Hash: `sha256:3f18f18a458a9dd63767c2bf4bbee1ddeee10828febf609872a0ab7fa51ee14f`
  - Raw File Byte Hash: `sha256:6c21edb0ed18a8febc1c7ec667904719cd9be4e25baf26d3de0ea3284f28b4ff`
- **Candidate Validator**: `catalogue-pipeline/scripts/validateVerifierV12Contract.mjs`
  - Byte Hash: `sha256:634cdb4bbb475dc20bc007b090e341cfcee0d956f7ec72c7d908ba238c19b3b6`
- **Materialization Addendum**: `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.materialization-addendum.v1.json`
  - Canonical Hash: `sha256:acf1e16ce52831880cc295dfb5d1b099b182ee8052c7abf7aa6bc074520a4bb4`
  - Raw File Byte Hash: `sha256:f2b6c2313440f5cc8d2c563de23c91ad050f4203383e4c394e8db54bc67c125a`
- **Candidate Manifest**: `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.2.manifest.json`
  - Canonical Hash: `sha256:ae55bb5fe4c44b7497669c6b7349acc77468dbe67f04b31865546283c54cfd56`
  - Raw File Byte Hash: `sha256:c40436b00c8ea4730590fdb9e7922d0bfecdca4c1b79b1dfaad5406599b6fecf`

Candidate operational flags remain strictly:
`active: false`, `productionAuthorized: false`, `empiricalBehaviorValidated: false`.

---

## 3. Frozen Development Cohort (N = 30)

The evaluation cohort consists of the exact 30 candidates from the Scale Tranche 2 random audit sample evaluated under the effective human adjudication layer (including the approved Guardians adjudication correction):

- **Total Candidates**: $N = 30$
- **Ground-Truth Breakdown**:
  - `APPROVE` (Clean): 14
  - `REVISE MINOR`: 15
  - `REVISE SEVERE`: 1 (`scale500-tmdb-14283`, *The Red Violin*)
  - `REJECT`: 0
- **Adjudication Baseline**: `catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-verifier-gap-analysis.v1.1.json`
- **Cohort Manifest**: `catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/cohort-manifest.v1.json`

No resampling, filtering, or case additions are permitted.

---

## 4. Input Leakage Firewall & Cohort Manifest Isolation

To guarantee experimental validity:

1. **Cohort Manifest Isolation**: `cohort-manifest.v1.json` contains human review labels for offline analysis only and is **NEVER** passed to the model.
2. **Model Input Construction**: Future runner model input must be constructed solely from `sourceRiskInputPath` containing only the seven whitelisted surfaces.
3. **Authorized Visible Surfaces**:
   1. `facts`
   2. `acceptedSemanticClassification`
   3. `semanticBoundaryFlags`
   4. `allowedSourceMaterial`
   5. `spoilerBoundaryRules`
   6. `copyConstraints`
   7. `visibleEditorialCopy`
4. **Strictly Forbidden Surfaces (Leakage Firewall)**:
   - Human review decisions (`APPROVE`, `REVISE`, `REJECT`)
   - Human review rationale or reviewer notes
   - Severity classifications (`MINOR`, `SEVERE`)
   - Human-identified affected fields (`description`, `whyWatch`, `curiosityHook`, `vibeSummary`)
   - Retrospective gap analysis classifications or defect taxonomy
   - Option B rule evaluation findings or adjudication labels
   - Severe-case audit annotations or flags
   - Audit sample membership metadata

**Action on Leakage**: Immediate hard stop (`FAIL_CLOSED_ON_LEAKAGE`).

---

## 5. Replay Modes

1. **Mode 1 — Option A Semantic Verifier in Isolation (`PRIMARY_REPLAY_MODE`)**:
   - The candidate prompt and schema receive only the 7 authorized input surfaces.
   - Measures semantic boundary verification capability independently from deterministic linting.
2. **Mode 2 — Option A + Option B Deterministic Evidence Supplier (`PROVISIONAL_EVALUATED_SEPARATELY`)**:
   - Evaluates Candidate v1.2 with deterministically generated `deterministicLintFindings` from Option B rules.
   - **Cost & Protocol Policy**: Mode 2 is preregistered but model execution is deferred until Mode 1 results are analyzed.

---

## 6. Provider & Model Configuration

- **Provider**: Google Gemini Developer API (`geminiEditorialProvider.mjs`)
- **Model Identifier**: Frozen to `gemini-3.8-flash`.
  - **Environment Policy**: If environment variable `GEMINI_MODEL` is set and does NOT equal `gemini-3.8-flash`, the runner must fail closed with `STOP_MODEL_CONFIG_MISMATCH`.
- **Sampling Temperature**: Fixed at `0.0`. Note: Temperature 0.0 reduces sampling variance but model output is not assumed byte-deterministic across API calls.
- **Thinking Setting**: Frozen to `medium` with `maxOutputTokens: 4096` (identical to the historical T2 verifier live binding and supported adapter levels).
- **Structured Output**: Schema-enforced structured JSON (`responseMimeType: 'application/json'`, `responseJsonSchema: source-boundary-risk-verifier.v1.2.schema.json`).
- **Timeout**: 30,000 ms per request.

---

## 7. Call Accounting & Technical Retry Policy

- **Primary Calls**: Exactly 1 primary call per candidate record ($N = 30$).
- **Technical Retries**: Allowed only for technical, transport, or unparseable JSON errors (HTTP 429 rate limit, HTTP 500/502/503/504 server error, transport timeout, connection reset, malformed JSON string).
- **Retry Limit**: Maximum 2 retries per candidate; maximum 10 technical retries across the batch.
- **Max Theoretical Calls**: 40 calls.
- **Semantic Errors are DATA**: A response that is valid JSON but substantively inaccurate or semantically invalid is an empirical data point, **never** a retry condition.

---

## 8. Hard Stop Rules & Cost Ceiling

The replay runner must halt immediately if any of the following boundaries are breached:
1. Total calls exceed call cap ($> 40$).
2. Estimated cost exceeds the cost ceiling ($> \$0.50$).
3. Input leakage is detected.
4. Candidate prompt or schema byte hash differs from preregistered hashes.
5. Resolved model identifier does not match frozen `gemini-3.8-flash` (`STOP_MODEL_CONFIG_MISMATCH`).
6. Systemic schema failure threshold: `STOP_IF_SCHEMA_OR_SEMANTIC_INVALID_COUNT >= 6` ($\ge 20\%$ of the 30-record cohort, counting `SCHEMA_INVALID` and `SEMANTICALLY_INVALID` outputs; excludes transient transport retries).

### Cost Pricing Binding
- **Pricing Source**: `catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/gemini-pricing-metadata.v1.json`
- **Pricing Status**: `LOCALLY_FROZEN_BOUND`
- **Rates**: Standard input $0.75 / 1M tokens; Standard output (including reported thinking) $3.75 / 1M tokens.
- **Formula**: `inputTokens / 1e6 * 0.75 + (outputTokens + (thinkingTokens ?? 0)) / 1e6 * 3.75`
- **Guardrails**: Pre-dispatch check (`estimatedNextCallCost + accumulatedCost <= 0.50`) and post-response cost ledger enforcement.

---

## 9. Output Validation Pipeline & Disposition Taxonomy

Every raw response is processed through the 3-stage validation pipeline:
1. `JSON.parse()`
2. JSON Schema validation (`source-boundary-risk-verifier.v1.2.schema.json`)
3. Candidate Semantic Validator (`validateVerifierV12CandidatePayload`)

**Three Top-Level Disposition Classes for Evaluation**:
1. `VALID_HIGH_RISK`
2. `VALID_LOW_RISK`
3. `INVALID_OR_PROVIDER_FAILURE` (encompassing `PROVIDER_FAILURE`, `MALFORMED_JSON`, `SCHEMA_INVALID`, `SEMANTICALLY_INVALID`)

Invalid outputs are classified as failures and are **never** coerced into `LOW_RISK`.

---

## 10. Evaluation Framework: Two Distinct Analysis Layers

Evaluation strictly separates semantic model performance from operational fail-closed routing.

```
+-------------------------------------------------------------------------------+
|                           MODEL EVALUATION LAYERS                             |
+-------------------------------------------------------------------------------+
|                                                                               |
|  [Layer A: Semantic Verifier Performance]                                     |
|  Question: Did the verifier return a valid semantic judgment?                 |
|  Evaluated ONLY among valid outputs (VALID_HIGH_RISK, VALID_LOW_RISK):       |
|                                                                               |
|                   Human REVISE (Pos)      Human APPROVE (Neg)                 |
|  VALID_HIGH_RISK  TP (Defect Detected)    FP (Over-flagged)                   |
|  VALID_LOW_RISK   FN (Missed Defect)      TN (Correctly Passed)               |
|                                                                               |
|  * Failures/invalid outputs are excluded from the semantic matrix and         |
|    reported separately (validOutputCount, invalidOrFailureCount, rate).       |
|                                                                               |
|-------------------------------------------------------------------------------|
|                                                                               |
|  [Layer B: Operational Fail-Closed Containment]                               |
|  Question: Would the system prevent unsafe automatic passage?                 |
|  Routing Simulation for ALL 30 records:                                       |
|                                                                               |
|  VALID_HIGH_RISK             -> HUMAN_REVIEW_REQUIRED                         |
|  INVALID_OR_PROVIDER_FAILURE -> HUMAN_REVIEW_REQUIRED / FAIL_CLOSED            |
|  VALID_LOW_RISK              -> AUTO_ELIGIBLE_SIMULATION                      |
|                                                                               |
|  Operational Metrics:                                                         |
|  - Defect Containment: Human REVISE routed to review (TP + Fail-Closed)       |
|  - Clean Auto-Pass: Human APPROVE routed to auto-eligible (TN)                |
|  - Clean Over-Routing: Human APPROVE routed to review (FP + Fail-Closed)      |
|  - Human-Review Routing Burden: Total records routed to review / 30           |
|                                                                               |
|  * Fail-closed containment MUST NEVER be described as semantic defect         |
|    detection or True Positive.                                                |
+-------------------------------------------------------------------------------+
```

### Layer A: Semantic Verifier Performance (`VALID_OUTPUT_APPARENT_RETROSPECTIVE_PERFORMANCE`)

| Metric | Definition |
| :--- | :--- |
| **True Positive (TP)** | Human `REVISE` $\rightarrow$ Model `VALID_HIGH_RISK` |
| **False Negative (FN)** | Human `REVISE` $\rightarrow$ Model `VALID_LOW_RISK` |
| **False Positive (FP)** | Human `APPROVE` $\rightarrow$ Model `VALID_HIGH_RISK` |
| **True Negative (TN)** | Human `APPROVE` $\rightarrow$ Model `VALID_LOW_RISK` |

**Separately Reported**:
- `validOutputCount`
- `invalidOrFailureCount`
- `validOutputRate`
- Apparent Defect Sensitivity: $\text{TP} / (\text{TP} + \text{FN})$
- Apparent Specificity: $\text{TN} / (\text{TN} + \text{FP})$
- Apparent False-Positive Rate: $\text{FP} / (\text{TN} + \text{FP})$
- Apparent Positive Predictive Value (PPV): $\text{TP} / (\text{TP} + \text{FP})$
- Apparent Negative Predictive Value (NPV): $\text{TN} / (\text{TN} + \text{FN})$

### Layer B: Operational Fail-Closed Containment (`FAIL_CLOSED_OPERATIONAL_CONTAINMENT`)

- **Defect Containment Rate**: Percentage of human `REVISE` cases prevented from automatic passage.
- **Clean Auto-Pass Rate**: Percentage of human `APPROVE` cases safely routed to `AUTO_ELIGIBLE_SIMULATION`.
- **Clean Over-Routing Rate**: Percentage of human `APPROVE` cases routed to human review (either via `VALID_HIGH_RISK` or fail-closed failure).
- **Total Routing Burden**: Total records requiring human review $(\text{Routed to Review}) / 30$.

---

## 11. Severity Analysis & Governance Safety Gate

- **Minor Defects ($N=15$)**: Evaluated for apparent sensitivity and issue match rate.
- **Severe Defect ($N=1$, `scale500-tmdb-14283`)**:
  - Reported as `SEVERE_CASE_OUTCOME` (not a sensitivity percentage).
  - **Governance Safety Gate**: If `scale500-tmdb-14283` receives `VALID_LOW_RISK`, the outcome `KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE` is recorded and governance remains locked in `PAUSED_FOR_SEVERE_AUDIT_MISS`.
  - Detecting the severe case does **not** automatically unpause governance or authorize promotion.

---

## 12. Issue-Level Concordance Framework

For candidate outputs classified as `HIGH_RISK`, each model issue is mapped against human defect findings:
- `MATCHES_HUMAN_DEFECT`: Model identifies the same claim span and defect principle as human review.
- `PARTIAL_MATCH`: Model flags the correct copy field but identifies a related or secondary defect.
- `ADDITIONAL_PLAUSIBLE_ISSUE`: Model identifies a genuinely ungrounded claim not noted during original human review.
- `UNSUPPORTED_MODEL_ISSUE`: Model flags permissible figurative language or grounded copy as a defect.
- `MISSED_HUMAN_DEFECT`: Human review defect not identified by any model issue.

Issue-level concordance is recorded separately from candidate-level routing. Additional plausible issues on human `APPROVE` records do not alter the frozen baseline confusion matrix.

---

## 13. Prospective Holdout Firewall

- **Firewall Policy**: Zero prospective holdout candidates will be selected, sampled, viewed, or annotated during this development replay phase.
- **Confirmation Requirement**: Prospective performance confirmation requires a separate, preregistered protocol executed on an `INDEPENDENT_PROSPECTIVE_BLINDED_HOLDOUT` following completion and analysis of all development-set experiments.

---

## 14. Artifact Layout & Immutability

Replay outputs will be saved in:
`catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/`

- `protocol.v1.json` (Preregistered protocol metadata)
- `cohort-manifest.v1.json` (Frozen 30-candidate development cohort)
- `PROTOCOL.md` (This document)
- Future execution artifacts:
  - `execution-ledger.json` (Per-call telemetry and cost ledger)
  - `raw-responses/` (Untransformed provider API payloads)
  - `parsed-outputs/` (Validated candidate payloads)
  - `evaluation-results.v1.json` (Confusion matrix and performance metrics)
  - `issue-concordance.v1.json` (Issue-level mapping)

**Prompt Immutability**: Candidate prompt and schema hashes are frozen. If flaws are identified during replay, they must be addressed in a new version (e.g. `v1.2.1`) under a new protocol.
