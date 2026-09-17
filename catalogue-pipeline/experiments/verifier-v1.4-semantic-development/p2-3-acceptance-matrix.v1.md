# Movie Mood V8.2 — Candidate Verifier v1.4 P2.3 Acceptance Matrix

> **Task Classification**: LEVEL 3 — GOVERNED / HIGH-RISK  
> **Activity**: `VERIFIER_V14_P2_3_MANUAL_ADVISORY_INGESTION_REGISTRATION`  
> **Governance State**: `PAUSED_FOR_SEVERE_AUDIT_MISS`  
> **Status**: PREREGISTERED / READY FOR FREEZE  

---

## Metadata

* **Task / Phase**: `VERIFIER_V14_P2_3_MANUAL_ADVISORY_INGESTION_REGISTRATION`
* **Frozen Baselines**:
  * P1 Freeze: `deda014`
  * P2.1 Freeze: `6f4437452d3a39e248b17a151f1589139962a933`
  * P2.2 Freeze: `a6391a7b32b36b22157783e8e3f17c91f313fb6f`
  * P2.2 Freeze Manifest SHA-256: `2e6112da08f8e4db880cb546447b86bf0be9f4cd36ec31ac5d937e646b158070`
* **Specification Authority**:
  * `docs/V8_2_SCALABLE_PROMOTION_GOVERNANCE.md`
  * `catalogue-pipeline/experiments/verifier-v1.4-semantic-development/BLIND_HUMAN_REVIEW_PROTOCOL.md`
  * `catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-1-protocol.v1.json`
  * `catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-2-protocol.v1.json`
  * `catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-3-live-operation-protocol.v1.json`
* **Scope Classification**:
  * **MUST UPDATE**:
    * `catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-3-acceptance-matrix.v1.md`
    * `catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-3-live-operation-protocol.v1.json`
    * `catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-3.test.mjs`
  * **MUST CREATE LAST**:
    * `catalogue-pipeline/experiments/verifier-v1.4-semantic-development/p2-3-freeze-manifest.v1.json`
  * **MUST NOT CHANGE**:
    * All P1 frozen files (`protocol.v1.json`, `candidate-verifier.v1.4.md`, etc.)
    * All P2.1 frozen files (`p2-1-freeze-manifest.v1.json`, `blind-review-order.v1.json`, etc.)
    * All P2.2 frozen files (`p2-2-freeze-manifest.v1.json`, `p2-2-protocol.v1.json`, `p2-2.test.mjs`, `runVerifierV14BlindReview.mjs`, `verifierV14ReviewState.mjs`, `verifierV14ReviewerAdapter.mjs`)
    * Unrelated dirty workspace modifications in `catalogue-pipeline/generated/`, etc.
  * **OPERATIONAL RESTRICTIONS**:
    * Zero automated network or API transport calls
    * Zero Anthropic API credentials or integration code
    * Zero Gemini API integration for human-review phase
    * Zero Candidate Verifier calls or countTokens calls
    * Zero live review execution evidence generation
    * Zero candidate adjudications (Candidate #1 remains unreviewed)
    * Zero git staging, committing, or pushing

---

## Frozen Invariant Acceptance Matrix

| ID | Invariant (Normative Requirement) | Threat / Failure Mode | Implementation Locus (Boundary / Module) | Positive Test (Nominal Behavior) | Negative Test (Adversarial / Bypass Attempt) | Recovery Test (Crash / Persistence / Replay) | Artifact / Hash Binding | Scope | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **INV-P23-01** | Gemini advisory channel is explicitly registered as `MANUAL_CONSUMER_UI` and does not claim an unobserved API model identity. | Inventing unverified API model identifiers or assuming automated API transport. | `p2-3-live-operation-protocol.v1.json` §manualAdvisoryChannels.gemini | Assert channel is `MANUAL_CONSUMER_UI` and fallback is `UNKNOWN_NOT_EXPOSED`. | Reject any configuration claiming unobserved API model ID or requiring API credentials. | Replay validates explicit manual ingestion schema. | `p2-3-live-operation-protocol.v1.json` | MUST | PASS |
| **INV-P23-02** | Claude advisory channel is explicitly registered as `MANUAL_CONSUMER_UI` / `FREE` and does not require Anthropic API infrastructure. | Blocking study on unavailable Anthropic API keys or building unneeded API transports. | `p2-3-live-operation-protocol.v1.json` §manualAdvisoryChannels.claude | Assert channel is `MANUAL_CONSUMER_UI`, accountTier is `FREE`, zero API prerequisites. | Reject requirement of `ANTHROPIC_API_KEY` or API transport dependencies. | Replay validates manual ingestion record structure. | `p2-3-live-operation-protocol.v1.json` | MUST | PASS |
| **INV-P23-03** | Reviewer payload is deterministic and cryptographically bound to frozen prompt text, prompt SHA, and blind packet SHA. | Ad-hoc prompt modification, accidental copy drift, or mismatched materiality policy. | `p2-3-live-operation-protocol.v1.json` §copyReadyPayloadSpecification | Assert copy-ready payload binds candidateId, prompt SHA, packet SHA, and policy SHA. | Tampered prompt text or packet fails cryptographic binding and triggers HARD STOP. | Replay produces byte-identical copy payload from disk state. | `review-prompts/*.v1.md`, `blind-human-review-packet.schema.v1.json` | MUST | PASS |
| **INV-P23-04** | Raw manual response is persisted to disk and hashed before parsing, trimming, or schema validation. | Premature JSON repair, whitespace normalization, or silent dropping of malformed outputs. | `p2-3-live-operation-protocol.v1.json` §rawResponseIngestionSpecification | Ingestion persists exact raw bytes and raw SHA-256 before schema validation. | Parsing before raw persistence throws integrity violation. | Crash recovery reconstructs attempt strictly from persisted raw response bytes. | `p2-3-live-operation-protocol.v1.json` | MUST | PASS |
| **INV-P23-05** | Manual model-generated retries are finite and preregistered: max 2 semantic generations per reviewer (MALFORMED_JSON / SCHEMA_INVALID only). | Runaway manual re-prompts, third generation attempts, or retrying fatal binding errors. | `p2-3-live-operation-protocol.v1.json` §manualRetryPolicy | MALFORMED_JSON or SCHEMA_INVALID allows exactly 1 additional model generation (max 2 total). | Attempting a 3rd model generation or retrying BINDING_INVALID throws error. | Ledger tracks attempt ordinals immutably without overwrite. | `p2-3-live-operation-protocol.v1.json` | MUST | PASS |
| **INV-P23-06** | Copy/ingest errors (`USER_COPY_OR_INGEST_ERROR`) are distinguished from new semantic model generation attempts. | Penalizing adjudicator for clipboard error as a model retry, or excusing real model defects. | `p2-3-live-operation-protocol.v1.json` §copyOrIngestErrorPolicy | Correcting confirmed copy truncation re-ingests without consuming model retry cap. | Claiming copy error when new prompt was sent throws validation error. | Bad ingestion record preserved or clearly superseded in audit log. | `p2-3-live-operation-protocol.v1.json` | MUST | PASS |
| **INV-P23-07** | Candidate #1 manual pilot is strictly bounded to frozen order index 1 (`exp100-tmdb-672647`) with mandatory manual hold stops. | Automatic progression to Candidate #2, or discarding Candidate #1 as synthetic. | `p2-3-live-operation-protocol.v1.json` §candidate1PilotProtocol | Candidate #1 matches sequence 1; pilot enforces 17 explicit inspection steps. | Attempting automatic advance to Candidate #2 without audit throws error. | Candidate #1 remains real ground truth upon successful completion. | `blind-review-order.v1.json` | MUST | PASS |
| **INV-P23-08** | Authoritative human decision exists if and only if `human/adjudication-record.v1.json` is atomically persisted and schema-validated. | Claiming in-memory decision on crash, or re-prompting adjudicator for committed decision. | `p2-3-live-operation-protocol.v1.json` §humanCommitSemantics | Assert committed record validates against schema and sets HUMAN_ADJUDICATED. | Unpersisted callback submission treated as void on process restart. | Disk reload reconstructs candidate state strictly from disk bytes. | `human-adjudication-record.schema.v1.json` | MUST | PASS |
| **INV-P23-09** | Sequential review resumes deterministically at the very next candidate in frozen P2.1 order after QA corrections. | Out-of-order execution, skipping difficult candidates, or quota-seeking reordering. | `p2-3-live-operation-protocol.v1.json` §provisionalStoppingAndQaContinuation | Verify continuation picks exact index next in sequence after QA reconciliation. | Attempting out-of-order candidate review throws OUT_OF_ORDER_EXECUTION error. | Ledger reload preserves unreviewed sequence index across restarts. | `blind-review-order.v1.json` | MUST | PASS |
| **INV-P23-10** | Final N=60 evaluation cohort is constructed strictly via preregistered deterministic stratification (30 clean, 30 defect, >=6 severe). | Discretionary post-hoc cohort selection, cherry-picking, or arbitrary substitutions. | `p2-3-live-operation-protocol.v1.json` §finalEvaluationCohortConstruction | Cohort construction function selects earliest 30 clean, earliest 30 defect, stratified to >= 6 severe. | Substituting arbitrary candidates outside algorithm throws deterministic mismatch error. | Identical cohort produced on repeated execution from frozen completed pool. | `p2-3-live-operation-protocol.v1.json` | MUST | PASS |
| **INV-P23-11** | Severe quota handling is content-blind: satisfied only through sequential recruitment; never by search or lowering requirement. | Cherry-picking suspected severe cases, searching ahead, or lowering 6 severe floor. | `p2-3-live-operation-protocol.v1.json` §severeQuotaHandling | Verify review continues sequentially until 6 severe found or pool exhausted. | Attempting to filter or prioritize queue by predicted severity throws error. | Ledger state tracks severe count without exposing quota to active review bundle. | `p2-3-live-operation-protocol.v1.json` | MUST | PASS |
| **INV-P23-12** | 100% of severe adjudications receive QA; deterministic 25% (`ceil(0.25 * N)`) of all completed non-severe receive QA; prior QA records retained on expansion. | Sampling QA only from final 60, biased non-severe sampling, or dropping prior QA records. | `p2-3-live-operation-protocol.v1.json` §qaSamplingScope | Sampling algorithm includes 100% severe, exactly `ceil(0.25*N)` non-severe, retains prior sample. | Omitting any severe record from QA or dropping prior non-severe audit throws error. | QA sample list deterministically reproducible from seed hash and candidate pool. | `second-review-qa-protocol.v1.json` | MUST | PASS |
| **INV-P23-13** | Model execution runner has zero dependency on human ground truth files; outputs frozen before truth unblinded. | Label leakage into Candidate Verifier execution, early evaluation bias, or unblinded testing. | `p2-3-live-operation-protocol.v1.json` §truthSeparationBoundary | Label-free evaluation packet exports only candidate IDs and inputs; truth hash frozen. | Attempting to pass human truth file path to model evaluation runner throws error. | Evaluation runner operates exclusively from label-free cohort export. | `p2-3-live-operation-protocol.v1.json` | MUST | PASS |

---

## Status Definitions

* **PASS**: Invariant is fully specified, enforced by deterministic logic, and mechanically verified.
* **BLOCKER**: Invariant requires unresolved external configuration that halts progression.
* **DEBT**: Non-blocking architectural debt documented for later refactoring.
* **DEFERRED_TO_LATER_PHASE**: Invariant explicitly allocated to a subsequent study phase.

---

## Sign-off Checklist

- [x] All API transport requirements, tokens, costs, and credentials removed.
- [x] Manual consumer UI advisory ingestion registered for Gemini and Claude.
- [x] Deterministic copy-ready review payload and raw persistence defined.
- [x] Distinction between copy/ingest errors and model attempts enforced.
- [x] All 13 normative invariants are in PASS status.
- [x] P2.3 preregistration is READY FOR FREEZE.
- [x] Candidate #1 live execution authorization remains FALSE pending manual-ingestion readiness check.
