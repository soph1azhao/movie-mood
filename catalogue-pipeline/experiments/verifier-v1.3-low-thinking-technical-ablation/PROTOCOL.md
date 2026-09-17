# Candidate Verifier v1.3 Low-Thinking Technical Ablation Protocol

- **Protocol ID**: `verifier-v1.3-low-thinking-technical-ablation.v1`
- **Activity**: `VERIFIER_V1_3_LOW_THINKING_TECHNICAL_ABLATION`
- **Classification**: `TECHNICAL_DEVELOPMENT_ABLATION`
- **Dataset Classification**: `RETROSPECTIVE_DEVELOPMENT_SET`
- **Governance State**: `PAUSED_FOR_SEVERE_AUDIT_MISS`
- **Execution Status**: `PREREGISTERED_NOT_EXECUTED`
- **Production Authorized**: `false`

---

## 1. Research Question & Purpose

> Does changing Gemini 3.8 Flash from `thinkingLevel = "medium"` to `thinkingLevel = "low"` reduce or eliminate `MAX_TOKENS` JSON truncation for the known v1.3 technical-failure records, while holding all semantic inputs and generation contracts constant?

This is a **technical development ablation** targeting the provider-level token budget exhaustion failure mode observed during the v1.3 retrospective development replay.

It is **NOT**:
- semantic tuning or prompt engineering
- verifier validation or confirmation
- prospective validation
- evidence for production promotion or readiness

---

## 2. Bound Parent Evidence & Invariants

This technical ablation binds to the immutable v1.3 frozen artifacts:

| Bound Artifact | Path | Exact Verified Hash |
| :--- | :--- | :--- |
| **Candidate Prompt** | `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.md` | `sha256:93c9a185620012609998ad8e58e4c68c9c945fd100820f2cc93c64385cdd402b` |
| **Candidate Schema** | `catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.3.schema.json` | `sha256:aa73ad6463e47c835186f8f2705f5c46167cd053ec43c1a0d72014ccc68c26dc` |
| **Candidate Validator** | `catalogue-pipeline/scripts/validateVerifierV13Contract.mjs` | `sha256:258c1520779fd147bf9c4aaa1c31c385d1da1fbd0f4835d381e30f767efab5b6` |
| **v1.3 Replay Protocol** | `catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/protocol.v1.json` | `sha256:d481ed8ba04473fda7b5a39c34a5592d2faa98af06501f782d965268aed5cdf5` |
| **v1.3 Execution Ledger** | `catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/execution/execution-ledger.json` | `sha256:9a1e0098935807935d9124a148b92f5363bade6516d80f742f3e160fead76888` |
| **v1.3 Evidence Freeze** | `catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/execution-evidence-freeze.v1.json` | `sha256:8b738b05c4f35b7ff2e3d11592ef683e0b79e6f3ebf1004d9f0bf791be6d03a5` |
| **v1.3 Reconciliation** | `catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/retrospective-reconciliation.v1.json` (`commit: 196b080`) | `sha256:553682aba547787787c65e6bfa2f7fb96e531d0d0d690f0737f08659dce1c18a` |

---

## 3. Ablation Cohort

Exactly **four** retrospective development candidates are included:
1. `scale500-tmdb-13398`
2. `scale500-tmdb-1563`
3. `scale500-tmdb-127533`
4. `scale500-tmdb-9725`

### Selection Rationale & Failure-Enriched Interpretation
- **Cohort Classification**: `FAILURE_ENRICHED_POST_OUTCOME_TECHNICAL_COHORT`
- **Selection Rationale**: Each of these four records produced at least one `MALFORMED_JSON_STRING` attempt with provider `finishReason: MAX_TOKENS` during the Candidate Verifier v1.3 replay under `thinkingLevel = "medium"`. No other candidates may be added.

> [!IMPORTANT]
> **Interpretation Constraint**: The four-record cohort was selected because each record previously produced at least one `MAX_TOKENS` serialization failure under `thinkingLevel=medium`. Therefore `serializationSuccessRate` is conditional on prior failure and is not an estimate of general verifier serialization reliability, future catalogue reliability, population performance, or production reliability.

Human labels are strictly excluded from generation inputs and technical success criteria.

---

## 4. Single-Variable Experimental Delta

All experimental variables are held byte-for-byte identical to Candidate Verifier v1.3, except for a single model generation parameter:

| Dimension | Frozen v1.3 Baseline | Experimental Ablation | Status |
| :--- | :--- | :--- | :---: |
| **Model** | `gemini-3.8-flash` | `gemini-3.8-flash` | Unchanged |
| **Temperature** | `0.0` | `0.0` | Unchanged |
| **Max Output Tokens** | `6144` | `6144` | Unchanged |
| **Prompt** | v1.3 Candidate Prompt | v1.3 Candidate Prompt | Zero delta |
| **Schema** | v1.3 Candidate Schema | v1.3 Candidate Schema | Zero delta |
| **Validator** | v1.3 Candidate Validator | v1.3 Candidate Validator | Zero delta |
| **Input Packets** | Direct historical risk inputs | Direct historical risk inputs | Zero delta |
| **Thinking Level** | `"medium"` | `"low"` | **Single Delta** |

---

## 5. Endpoints & Success Criteria

### Primary Technical Endpoint
$$\text{technicalSerializationSuccess} = \text{response reaches a complete parseable JSON payload without } \texttt{finishReason: MAX\_TOKENS}$$

$$\text{serializationSuccessRate} = \frac{\sum \text{technicalSerializationSuccess}}{4}$$

> [!NOTE]
> **Primary Endpoint Separation**: Schema validity and semantic validity do not determine the primary `technicalSerializationSuccess` endpoint. They are reported separately as observational diagnostics. Semantic disposition is strictly observational. No semantic accuracy scoring against human labels may be added.

### Secondary & Observational Endpoints
For each record, report:
- `finishReason`
- `promptTokenCount`
- `thoughtsTokenCount`
- `candidatesTokenCount`
- total output tokens (`candidatesTokenCount + thoughtsTokenCount`)
- parseability (`JSON.parse` pass/fail)
- schema validity (`validateJsonSchema` pass/fail)
- semantic validity (`validateVerifierV13CandidatePayload` pass/fail)
- candidate disposition (`VALID_HIGH_RISK`, `VALID_LOW_RISK`, `MALFORMED_JSON_STRING`, etc.)
- call cost (`callCostUsd`)

### Comparative Endpoints vs. Medium Baseline
Compare each low-thinking response against its frozen v1.3 medium-thinking attempt history:
- medium malformed-attempt count vs. low malformed-attempt count
- medium `thoughtsTokenCount` range (5,617–5,900) vs. low `thoughtsTokenCount`
- medium `candidatesTokenCount` range (228–512) vs. low `candidatesTokenCount`
- presence or absence of `finishReason: MAX_TOKENS`
- presence or absence of JSON completion

---

## 6. Execution Plan & Call Limits

- **Planned Primary Calls**: **4** (exactly one primary call per candidate).
- **Automatic Retries**: **0** (`maxRetries = 0`).
- **Maximum Total Calls**: **4** (`maxTotalCalls = 4`).
- **Rationale**: Measuring the direct technical efficacy of the low-thinking parameter requires observing first-attempt serialization without confounding by retry heuristics.
- **Transport Failure Handling**: If any attempt encounters a transport or provider failure unrelated to token budget exhaustion, classify as `TECHNICAL_TRANSPORT_FAILURE` without automated re-dispatch.

---

## 7. Cost Governance & Arithmetic

Derived from registered Gemini pricing ($0.75 / MTok input, $3.75 / MTok output) and frozen token calibration:

1. **Input Tokens**:
   - `scale500-tmdb-13398`: 3,260 tokens $\rightarrow$ $0.00244500
   - `scale500-tmdb-1563`: 3,281 tokens $\rightarrow$ $0.00246075
   - `scale500-tmdb-127533`: 3,307 tokens $\rightarrow$ $0.00248025
   - `scale500-tmdb-9725`: 3,291 tokens $\rightarrow$ $0.00246825
   - **Total Input Tokens**: 13,139 tokens $\rightarrow$ **$0.00985425 USD**
2. **Maximum Output Tokens**:
   - 4 calls $\times$ 6,144 tokens = 24,576 tokens $\rightarrow$ **$0.09216000 USD**
3. **Theoretical Absolute Maximum Cost**:
   - $\$0.00985425 + \$0.09216000 = \mathbf{\$0.10201425\text{ USD}}$
4. **Governed Cost Ceiling**:
   - Set at **$0.150000 USD** (incorporating a ~47% safety buffer above absolute saturation).

---

## 8. Fail-Closed Stop Rules

Halt immediately before dispatch if:
1. Total external calls would exceed 4.
2. Accumulated cost plus reserve would exceed `$0.150000 USD`.
3. Request hash differs from the registered low-thinking request hash.
4. Input artifact hash differs from registered parent bindings.
5. Execution state is ambiguous.
6. Prospective holdout access is detected.

---

## 9. Governance & Limitations

- **Dataset**: Retrospective development set only.
- **Holdout Status**: Sealed and untouched.
- **Governance State**: `PAUSED_FOR_SEVERE_AUDIT_MISS`.
- **Promotion Status**: Inactive; not authorized for production.
