# Verifier v1.3 Retrospective Development Replay Protocol

**Protocol Identifier**: `verifier-v1.3-retrospective-development-replay.v1`  
**Protocol Status**: `PREREGISTERED_NOT_EXECUTED`  
**Governance State**: `PAUSED_FOR_SEVERE_AUDIT_MISS`  
**Dataset Classification**: `RETROSPECTIVE_DEVELOPMENT_SET`  
**Evaluation Scope**: Development-set diagnostic evaluation of an execution-instrument repair. NOT prospective validation, confirmation, or production authorization.

---

## 1. Experiment Question & Purpose

### Primary Research Question
> When Candidate Verifier v1.3 (incorporating execution-instrument repairs: 6144 max output tokens, provider-compatible structural response schema, local deterministic semantic validation, and corrected cost guards) is applied to the frozen T2 retrospective development cohort ($N=30$), does it eliminate MAX_TOKENS truncations and schema invalidity while preserving v1.2 semantic verification capability?

### Standardized Terminology
- **Activity Classification**: `RETROSPECTIVE_DEVELOPMENT_REPLAY_V1_3`
- **Metric Classification**: `APPARENT_RETROSPECTIVE_PERFORMANCE`
- **Prohibited Terms**: Do not describe this experiment as "validation", "confirmation", "prospective performance", or "production readiness".

---

## 2. Bound Candidate Implementation & Lineage

This protocol strictly binds the candidate implementation artifacts:

- **Candidate Prompt**: `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md`
- **Candidate Schema**: `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json`
- **Candidate Validator**: `catalogue-pipeline/scripts/validateVerifierV13Contract.mjs`
- **Candidate Manifest**: `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.manifest.json`

### Predecessor Lineage & Semantic Invariants
Candidate v1.3 is an execution-instrument repair of Candidate v1.2.
- **Semantic Delta**: ZERO.
- **Risk Categories**: Exact 11 v1.2 categories preserved.
- **Claim Types**: Exact 17 v1.2 claim types preserved.
- **Authority Resolutions**: Exact 5 v1.2 authority resolutions preserved.
- **Copy Fields**: Exact 4 copy fields preserved.
- **Low-Risk Coverage**: Exact 10 coverage booleans + `summaryRationale` preserved.
- **Source Evidence Semantics**: Complete tri-state contract (`SUPPORTED`, `UNSUPPORTED_MISSING_AUTHORITY`, `CONTRADICTED_BY_AUTHORITY`) preserved. `value` and `conflictingValue` remain arbitrary JSON-valued fields.

---

## 3. Frozen Development Cohort (N = 30)

The evaluation cohort consists of the identical 30 candidates from the Scale Tranche 2 random audit sample:
- **Total Candidates**: $N = 30$
- **Ground-Truth Composition**:
  - `APPROVE` (Clean): 14
  - `REVISE MINOR`: 15
  - `REVISE SEVERE`: 1 (`scale500-tmdb-14283`, *The Red Violin*)
  - `REJECT`: 0
- **Adjudication Source**: `catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-verifier-gap-analysis.v1.1.json`
- **Cohort Manifest**: `catalogue-pipeline/experiments/verifier-v1.2-retrospective-replay/cohort-manifest.v1.json`

---

## 4. Leakage Control & Firewall

1. **Cohort Manifest Isolation**: `cohort-manifest.v1.json` contains human labels and must NEVER enter model-visible packets.
2. **Authorized Model Visible Surfaces**:
   `facts`, `acceptedSemanticClassification`, `semanticBoundaryFlags`, `allowedSourceMaterial`, `spoilerBoundaryRules`, `copyConstraints`, `visibleEditorialCopy`.
3. **Strictly Forbidden Surfaces**:
   Human review decisions, reviewer rationale, severity classifications, affected fields, gap annotations, Option B labels.
4. **Action on Leakage**: Immediate hard stop (`FAIL_CLOSED_ON_LEAKAGE`).

---

## 5. Model & Execution Configuration

- **Provider**: Google Gemini Developer API (`generateContent`)
- **Model ID**: `gemini-3.8-flash`
- **Temperature**: `0.0`
- **Thinking Configuration**: `thinkingConfig: { thinkingLevel: "medium" }`
- **Max Output Tokens**: `6144` (expanded from 4096 to prevent mid-serialization truncations)
- **Response Format**: Strict JSON conforming to `source-boundary-risk-verifier.v1.3.schema.json`

---

## 6. Retry & Stop Governance

### Authorized Retries
- **Transport-Level Retries**:
  - `HTTP_429_RATE_LIMIT`
  - `HTTP_500_SERVER_ERROR`
  - `HTTP_503_SERVICE_UNAVAILABLE`
  - `NETWORK_TIMEOUT`
  - `CONNECTION_RESET`
- **Output-Level Retry**:
  - `MALFORMED_JSON_STRING` only

### Non-Retryable Dispositions (Terminal)
- `HTTP_502`
- `HTTP_504`
- `NETWORK_ERROR` (defined as: "0-byte persisted attempt artifact; physical cause unknown")
- `SCHEMA_INVALID`
- `SEMANTICALLY_INVALID`
- `VALID_LOW_RISK`
- `VALID_HIGH_RISK`

### Batch Retry Exhaustion Semantics
- Per-candidate retry cap: 2
- Batch technical retry cap: 10
- When `batchTechnicalRetries == 10`:
  `status = RETRY_DISABLED_FOR_REMAINDER_OF_BATCH`
  Further technical retries are disabled, but **untouched primary candidates continue execution normally**.

### Whole-Replay Stopping Rules
The runner halts execution before initiating the next external call if:
1. `accumulatedActualCost + nextCallReserve > 1.10 USD` (`STOP_IF_COST_EXCEEDS_CEILING`).
2. `totalExternalCalls >= 40` (`STOP_IF_CALL_COUNT_EXCEEDS_CAP`).
3. Cumulative `SCHEMA_INVALID + SEMANTICALLY_INVALID >= 6` (`STOP_IF_SCHEMA_OR_SEMANTIC_INVALID_COUNT_GTE_6`).
4. Severe case `scale500-tmdb-14283` produces `VALID_LOW_RISK` (`STOP_ON_SEVERE_CANDIDATE_LOW_RISK_ESCAPE`).
5. Observed prompt tokens exceed calibrated prompt tokens by $>5\%$ (`STOP_IF_UNEXPECTED_PROMPT_DRIFT`).

---

## 7. Cost Governance & Tokenizer Calibration

### Pricing Tier (Gemini 3.8 Flash Developer API)
- Input: **$0.75 / 1,000,000** tokens
- Output + Thinking: **$3.75 / 1,000,000** tokens

### Pre-Dispatch Cost Guard
- **`GOVERNED_PRE_DISPATCH_COST_CEILING_USD`**: **`$1.1000000`**
- **`FROZEN_NEXT_CALL_COST_RESERVE_USD`**: **`$0.026100`** (empirical engineering reserve)

### Networked Tokenizer Pre-Calibration (`countTokens`)
Before live generation replay is authorized, an optional separate networked tokenizer calibration pass can be executed via `calibrateVerifierV13Tokens.mjs`.
- It executes `countTokens` against the exact frozen request packets.
- Persists an immutable token manifest (`candidateId`, `requestHash`, `countedInputTokens`).
- Replay runner derives individual call reserves: `(countedInputTokens * $0.75 / 1M) + (6144 * $3.75 / 1M)`.
- Discrepancy rule: Post-generation prompt usage is compared to pre-counted tokens. Any positive drift is recorded; drift $>5\%$ triggers immediate fail-closed halt.

---

## 8. Two-Layer Evaluation Framework

- **Layer A (Semantic Discrimination on Valid Outputs)**:
  - Evaluated strictly on `VALID_LOW_RISK` and `VALID_HIGH_RISK` outputs.
  - Generates TP, FN, FP, TN, Sensitivity, Specificity, PPV, NPV.
- **Layer B (Operational Fail-Closed Containment)**:
  - Evaluates routing safety. All invalid outputs and provider failures are routed to `HUMAN_REVIEW_REQUIRED`.
  - Measures total defect containment and review burden.
  - Operational containment of failures must NEVER be described as semantic detection.
- **Severe Case Categorical Rule**:
  `scale500-tmdb-14283` (*The Red Violin*) must not pass as `VALID_LOW_RISK`. If it passes, execution halts immediately with `KNOWN_SEVERE_FAILURE_PASSED_CANDIDATE`.

---

## 9. Prospective Holdout Firewall

The prospective holdout cohort remains completely untouched, uninspected, and unreferenced.
