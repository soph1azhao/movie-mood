# V8.2 Scalable Promotion Governance

Status: active production-governance decision. Historical pilot and repair artifacts remain immutable evidence.

V8.2 uses risk-based human review and adaptive audit. Every promoted record must still pass the production validation contract, but human review is mandatory only for designated high-risk records and audit samples. Model output alone never authorizes production promotion.

## Validation and routing

Structural validation and semantic source-boundary risk are separate domains. Schema, required-field, type, cardinality, character-length, and malformed-JSON failures may receive at most one bounded structural repair attempt. That repair may use only the original authorized packet and contract, deterministic validator failures, and—when necessary—the immediately preceding output. It must prohibit new factual content. A second structural failure is quarantined.

Structurally valid records route to `AUTO_ELIGIBLE`, `HUMAN_REVIEW_REQUIRED`, or `QUARANTINED`. Auto eligibility requires complete provenance, no unresolved material source-boundary signal, a non-blocking risk layer, and a passing production contract. It is routing eligibility, not a claim of historical human approval.

Spoilers, hidden identities, concrete mechanisms, relationship or motive claims, franchise lore, scene-level external detail, material factual conflict, and unresolved source grounding require human review. Critic verdicts `hard_fail` and `needs_review` are also blocking, but the critic remains provisionally retained and insufficient as the sole source-boundary gate.

## Audit and escalation

Automatically eligible tranches begin with an adaptive random audit rate between 10% and 20%. Repeated clean tranches may support reductions toward approximately 5%. A severe audited miss pauses the current tranche, increases audit, and triggers diagnosis of the failure class. Escalation scope follows the mechanism and affected tranche; it does not automatically invalidate the historical catalogue.

## Experiment interpretation

Writer Repair v1.1 produced twelve structurally valid outputs and one length failure among thirteen requests. The Wings of Desire failure was structural only: its description exceeded 220 characters. No repaired output has received human semantic adjudication, so the experiment establishes neither semantic success nor semantic failure.

The historical 12-of-13 repair approval target is preserved in its experiment ledger but superseded as a production scale gate. Blind review of repaired outputs is optional calibration only. The next recommended phase is `SCALE_TRANCHE_1`, using previously eligible Semantic-400 candidates not consumed by the sixteen-film pilot and exercising the complete scalable routing pipeline.

Canonical machine-readable policy: `catalogue-pipeline/generated/catalogue-promotion/v8-2-editorial-pilot-v1/review/v8-2-scalable-promotion-governance.v1.json`.
