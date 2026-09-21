# Prospective Validation r2.1 — Execution Freeze Preparation Area

## 1. Critical Governance Notice

> [!IMPORTANT]
> **`R2_1_READY_FOR_EXECUTION_FREEZE_PREPARATION` DOES NOT MEAN `AUTHORIZED_TO_EXECUTE`.**

This directory contains **only content-free schemas, structural templates, and validation specifications**. It does not contain sealed holdout data, candidate identities, challenge copy, human labels, or execution authorizations.

No prospective candidate packet may be opened, no challenge case constructed, no verifier executed, and no human label acquired under the artifacts in this directory.

---

## 2. Mandatory Validation Lifecycle

No stage of this lifecycle may be skipped, combined, or reordered:

```
1. DESIGN COMPLETE (r2.1 Protocol & Manifest Preregistered)
   ↓
2. FREEZE PREPARATION (Schemas, Templates & Deterministic Preflight Machinery Bound)
   ↓
3. INDEPENDENT SEALING / RESOURCE CONFIRMATION (Holdout Sealing, Challenge Pool & 8 Humans Confirmed)
   ↓
4. EXECUTION FREEZE VALIDATION (validateVerifierV14ProspectiveFreeze.mjs verifies full package)
   ↓
5. EXPLICIT EXECUTION AUTHORIZATION (Separate Signed Governance Record)
   ↓
6. PROSPECTIVE EXECUTION (Fixed Verifier Order: Qualifying Challenges, then Natural Stream)
```

---

## 3. Inventory of Preparation Artifacts

| Artifact | Type | Role |
|---|---|---|
| `execution-freeze-record.schema.v1.json` | Schema | Defines the complete fail-closed execution freeze record requirements |
| `execution-freeze-record.template.v1.json` | Template | Structural template with explicit unresolved placeholders (`UNRESOLVED_PRE_EXECUTION_COMMITMENT`) |
| `challenge-attempt-manifest.schema.v1.json` | Schema | Enforces 18 attempted challenge cases across 3 classes, dual-human labels, and closed qualification states |
| `challenge-qualification-manifest.schema.v1.json` | Schema | Enforces deterministic selection of exactly the first 4 qualifying cases per class (12 total), rejecting third-human rescue |
| `replacement-holdout-commitment.schema.v1.json` | Schema | Enforces content-free cryptographic commitment to the sealed replacement holdout; strictly forbids identities and copy |
| `runtime-dependency-declaration.schema.v1.json` | Schema | Requires full declaration of runtime files/settings affecting semantic input; requires explicit `deterministicLintFindings` disposition |
| `operator-log.schema.v1.json` | Schema | Append-only execution ledger schema enforcing `retryCount == 0`, immutable configs, and failure-closed technical aborts |
| `human-resource-confirmation.schema.v1.json` | Schema | Enforces exactly 8 distinct governed personnel assignments satisfying all mutual independence constraints |
| `analysis-plan.schema.v1.json` | Schema | Preregisters the terminal 10% rate rules (`floor(0.10 * N)`) and deterministic outcome logic |
| `challenge-source-exclusion.schema.v1.json` | Schema | Enforces content-free cryptographic exclusion proof proving severe challenge source pool is strictly disjoint from all prohibited cohorts |
| `catalogue-pipeline/scripts/validateVerifierV14ProspectiveFreeze.mjs` | Validator | Automated fail-closed preflight checker distinguishing `PREPARATION_TEMPLATE_VALID` from `EXECUTION_READY` |

---

## 4. Key Pre-Execution Invariants

1. **Content-Free Sealing:** The replacement holdout commitment exposes only opaque cryptographic hashes and candidate counts. Candidate count must be at least 100 to ensure the prospective natural arm can reach the required 100 valid packets. Any presence of movie titles, TMDB/IMDB IDs, source overview text, or editorial copy causes immediate preflight rejection.
2. **Mechanically Proven Challenge Exclusion:** The severe challenge pool must provide an opaque cryptographic exclusion proof establishing disjointness from development, retrospective v1.4, production, and prospective replacement holdout cohorts without exposing candidate identities.
3. **Pre-Natural Challenge Firewall:** All 18 challenge attempts must be constructed, blind-labeled by two independent humans, and mechanically qualified *before any natural holdout packet is opened*. If fewer than 4 cases qualify in any class, the study is `INCONCLUSIVE` and the natural arm does not begin.
4. **8 Distinct Personnel:** The 8 governed roles must be assigned to 8 distinct individuals. Custodian and verifier operator may not adjudicate; custodian and verifier operator must be different people.
5. **Terminal Rate Gates:** Natural CLEAN and MINOR gates are evaluated *only at the terminal stopping point* using `floor(0.10 * realizedHumanCount)`. Fixed count rules (such as fixed $\le 2$) are explicitly rejected.
6. **Zero Retries / Model Freeze:** Model is strictly `gemini-3.8-flash` with `thinkingLevel=low`, temperature `0.0`, and `automaticRetries=0`. Any retry or unlogged model mutation is a `TECHNICAL_ABORT`.

---

## 5. External Governance Anchor and Integrity Invariants

1. **Deterministic Git Checkpoint (`freezePreparationCheckpointCommit`):**
   The canonical external governance anchor is the scoped Git checkpoint commit. The validator proves via Git that:
   - `workspaceRoot` is inside the repository;
   - `commitSha` is an existing commit object;
   - `commitSha` is an ancestor of the currently checked-out `HEAD`;
   - Every file listed in `freeze-preparation-manifest.v1.json` under the single canonical `toolchainFiles` mapping (with no legacy `governedFiles` mapping permitted) exists at that commit and has exact byte SHA-256 matching;
   - The toolchain manifest artifact itself exists at that commit and matches `freezeValidationToolchainCommitment.sha256`.
   - In `PREPARATION_TEMPLATE`, `freezePreparationCheckpointCommit` remains `UNRESOLVED_PRE_EXECUTION_COMMITMENT`.

2. **Single Governed Candidate-Member Reference Contract (`sourceCandidateMemberReferenceHash`):**
   Exclusion checking operates strictly on **candidate membership identity**, not packet bytes or editorial copy. Every one of the 18 actual challenge attempts binds a `sourceCandidateMemberReferenceHash` created under the common HMAC derivation domain, while retaining `sourcePacketReferenceHash` for unperturbed packet content. All 18 attempts must be pairwise distinct and exist within `challengeSourceMemberHashes` in `challenge-source-exclusion.json`.

3. **Common Derivation Domain & Custodian Trust Boundary:**
   - **Contract**: All exclusion sets (challenge source pool, development cohort, retrospective v1.4 cohort, current production cohort, and replacement prospective holdout) share exactly one governed derivation domain:
     - `derivationScheme`: `HMAC_SHA256_CANDIDATE_MEMBER_V1`
     - `derivationVersion`: `1`
     - `derivationKeyCommitment`: `sha256:<digest>` (cryptographic commitment to the custodian-held secret key; raw key is never checked into the repository)
   - **Trust Boundary**: The independent custodian creates the member-reference sets from the sealed membership using the governed secret key. The public freeze package binds the key commitment, derivation contract, candidate counts, and aggregate member-reference-set hashes. The public validator proves all published sets are internally consistent, share the single derivation domain, and are strictly disjoint.

4. **Member-Level Replacement Holdout Disjointness:**
   The replacement holdout commitment binds `opaqueMemberReferenceSetHash` = `SHA256(canonical JSON of sorted unique opaque member-reference hashes)` alongside `candidateCount >= 100`, `derivationScheme`, `derivationVersion`, and `derivationKeyCommitment`. The challenge exclusion document contains the actual member-level opaque hashes, which the validator sorts and recomputes to assert equality to `holdoutJson.opaqueMemberReferenceSetHash`, proving member-level disjointness without exposing titles or candidate identities.

5. **Prohibited-Cohort Grounding:**
   The non-secret prohibited cohorts (development, retrospective v1.4, production) bind authoritative source artifacts via `sourceMembershipCommitment` (path, sha256, candidateCount, derivationScheme, derivationVersion, derivationKeyCommitment). The validator verifies file existence, committed SHA-256 match, candidate counts, and common derivation domain alignment.

6. **Challenge Execution Order Hash:**
   The validator recomputes `fixedExecutionOrderCommitment.challengeOrderHash` directly from the qualifying cases projected to `[ { suiteOrderIndex, attemptId, casePacketHash } ]` and canonical JSON serialized, rejecting arbitrary or copied hashes.

