# Source Boundary Risk Verifier v1.2 — Specification & Contract Hardening

> **STATUS: SPECIFICATION_ONLY**  
> **NOT AN ACTIVE PROMPT — NOT AN ACTIVE SCHEMA**  
> **NO MODEL BEHAVIOR VALIDATION EXECUTED**  
> **CURRENT GOVERNANCE STATE: `PAUSED_FOR_SEVERE_AUDIT_MISS`**

---

## 1. Executive Summary & Purpose

The Scale Tranche 2 (T2) random human audit exposed that automated risk verifier v1.1 routed 30 candidate records as `LOW_RISK / AUTO_ELIGIBLE`, but subsequent blind human review revealed:
- **14 APPROVE** (46.7%)
- **15 MINOR REVISE** (50.0%)
- **1 SEVERE REVISE** (3.3%)

Under project governance, the severe audit miss on *The Red Violin* (`scale500-tmdb-14283`) triggered a strict operational pause (`PAUSED_FOR_SEVERE_AUDIT_MISS`), blocking runtime promotion, targeted repair execution, and subsequent scale tranches.

The verifier-gap retrospective (`scale-tranche-2-verifier-gap-analysis.v1.1.json`) and the Option B deterministic experiment (`scale-tranche-2-option-b-development-evaluation.v1.1.json`) demonstrated that while narrow regex-based boundary checks (Option B) can reliably detect high-confidence lexical overstatements (e.g. duration units, multi-country collapse) on the retrospective development set, they only address 25% of development misses (4/16). The remaining 75% (12/16)—including ungrounded premise presuppositions, character motive sharpening, unstated story mechanisms, adaptation lore, and factual substitutions—require semantic interpretation.

This specification defines **Option A Verifier v1.2**: a formal contract hardening of the semantic verifier. It establishes an unambiguous source-authority matrix, defines explicit claim classes, codifies assertion semantics for indirect statements (questions, modifiers, idioms), replaces ambiguous stylistic carve-outs, introduces structured evidence requirements, and defines a strict `LOW_RISK` coverage contract before any future model replay.

---

## 2. Lineage & Artifact Bindings

This specification strictly binds the following accepted canonical artifacts:

| Artifact Role | File Path | Canonical SHA-256 Hash |
|---|---|---|
| **Retrospective Gap Analysis v1.1** | `catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-verifier-gap-analysis.v1.1.json` | `sha256:70a0adb731f9a3bdb00be18e6fde58590c9922312f342ef926488b39819bf0ae` |
| **Option B Historical v1** | `catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-option-b-development-evaluation.v1.json` | `sha256:fb5cd364bcdf2f57c8d4edde71c9fff025b1500611ec15690a5be42a6a66c143` |
| **Option B Supersession v1.1** | `catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-option-b-development-evaluation.v1.1.json` | `sha256:04e6c4b6328f1dd24da7bbde3f5127a31812c5894f535a93ba2b0b27a3656b32` |
| **Approved Guardians Correction** | `catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/human-review-adjudication-correction.v1.json` | `sha256:3a3b486dc8d39a3fa49d3aa907b4718674ce1b0d7907e67f47e4f00fe963783e` |
| **Active Verifier Prompt v1.1** | `catalogue-pipeline/prompts/source-boundary-risk-verifier.v1.1.md` | `sha256:361df6c2f5ca6feb3567c092e3f7bc5de7396f48b52e7a6c8afc9dbf00768123` |
| **Active Verifier Schema v1.1** | `catalogue-pipeline/schemas/source-boundary-risk-verifier.v1.1.schema.json` | `sha256:9e0647d3753e482ad23780725020f6bebb408486ba663596c0bb0fe562b06120` |
| **Governance Pause v1** | `catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-governance-pause.v1.json` | Status `PAUSED`, gates locked |

---

## 3. Audit of Verifier v1.1 Contract Defects

An audit of `source-boundary-risk-verifier.v1.1.md` and schema reveals observable contract ambiguities and gaps that coincided with the 16 retrospective development-set false negatives:

### 3.1 Undifferentiated Authority Surfaces
In v1.1, the prompt stated: *"The supplied facts, accepted semantic classification, semantic boundary flags, allowed source material, spoiler boundary rules, and copy constraints are the sole authorized basis."*
However, it failed to specify **which source surface authorizes which type of claim**. Specifically:
- It did not define whether `facts.spokenLanguages` or `allowedSourceMaterial.overview` authorizes language descriptions.
- It did not prohibit using `facts.countries` to infer language or story setting.
- It did not specify whether multi-country lists authorize single-country nationality descriptors.

### 3.2 Unbounded Stylistic Carve-Outs
v1.1 contained the blanket exception: *"atmosphere, genre register, metaphorical urgency, and viewing-experience inference are allowed when they do not assert a concrete new story fact."*
The v1.1 carve-out was compatible with known false negatives involving deadline, genre, and atmospheric specificity and did not establish a sufficiently precise materiality boundary:
1. **Temporal Urgency Boundary**: v1.1 lacked explicit text establishing that finite deadlines, countdowns, and resource depletion claims (e.g. *Flight of the Phoenix* asserting "before supplies run out") are concrete temporal constraints rather than permissible metaphorical urgency.
2. **Genre vs Subgenre Boundary**: v1.1 did not state that specific unlisted subgenres (e.g. *The Grifters* asserting "neo-noir" when `facts.genres` listed "Drama, Crime") exceed permissible stylistic register.
3. **Atmosphere vs Physical Setting**: v1.1 did not restrict atmosphere to sensory register, allowing ungrounded physical settings and weather (e.g. *Sans Soleil* asserting "snowy streets of Hokkaido") to pass without synopsis grounding.
4. **Experiential Inference vs Character Motives**: v1.1 did not prevent attributing ungrounded psychological intentions or vengeance goals to characters (e.g. *Wild Card*).

### 3.3 Missing Assertion Semantics for Rhetorical & Indirect Statements
Verifier v1.1 did not explicitly require extraction and verification of factual presuppositions embedded in interrogative sentences. Known development-set false negatives occurred in this form (e.g. *The Red Violin* asking what dark secret from its 1681 creation left a trail of misfortune). The v1.1 contract lacked instruction that interrogative questions embed verifiable factual premises.

### 3.4 Unstructured Evidence & Opaque `LOW_RISK` Output
Under v1.1 schema, `LOW_RISK` outputs were completely opaque:
```json
{
  "riskLevel": "LOW_RISK",
  "riskCategories": [],
  "issues": [],
  "sourceBoundarySatisfied": true
}
```
The contract required no demonstration that copy fields, interrogative premises, factual modifiers, or metadata constraints were systematically verified.

---

## 4. Source-Authority Model & Authority Matrix

To eliminate authority ambiguity, Option A v1.2 establishes a deterministic 5-layer authority hierarchy. Each factual proposition in editorial copy must trace directly to its designated authoritative surface.

```
       AUTHORITY HIERARCHY
┌───────────────────────────────────────────────────────────┐
│ 1. PACKET FACTS (Metadata)                                │
│    director, year, runtime, countries, languages, genres   │
├───────────────────────────────────────────────────────────┤
│ 2. SYNOPSIS & ALLOWED STORY MATERIAL                      │
│    overview, allowed keywords, descriptive evidence        │
├───────────────────────────────────────────────────────────┤
│ 3. ACCEPTED SEMANTIC CLASSIFICATION                       │
│    pace, emotionalWeight, attentionDemand, moods          │
├───────────────────────────────────────────────────────────┤
│ 4. BOUNDARY FLAGS & SPOILER RULES                         │
│    negative constraints, cutoff boundaries                │
├───────────────────────────────────────────────────────────┤
│ 5. EXTERNAL KNOWLEDGE (PARAMETRIC / LORE / ADAPTATION)    │
│    >>> STRICTLY FORBIDDEN / ZERO AUTHORITY <<<           │
└───────────────────────────────────────────────────────────┘
```

### 4.1 Detailed Surface Authority Rules

#### Surface A: PACKET FACTS (`facts`)
- `director`: Authorizes director attribution claims only.
- `year`: Authorizes release year/era context.
- `runtime`: Authorizes viewing duration statements (e.g. "89 minutes", "compact under two hours"). Does not authorize in-story chronological duration.
- `countries`: Authorizes production country context (e.g. "French-Austrian co-production").
  * **Rule 1**: `countries` does **NOT** authorize spoken language (a French production is not necessarily in French).
  * **Rule 2**: `countries` does **NOT** authorize story setting/location (a French production is not necessarily set in France).
  * **Rule 3**: Multi-country lists do **NOT** authorize single-country nationality collapse (e.g. describing a 4-country European co-production as a "French mystery" is unauthorized).
- `spokenLanguages`: Authorizes spoken language claims (e.g. `facts.spokenLanguages: ["Russian"]` directly authorizes `"Russian-language"`).
  * **Rule 1**: `spokenLanguages` does **NOT** authorize story setting or country of production.
- `genres`: Authorizes high-level genre categories explicitly listed.
  * **Rule 1**: Does **NOT** authorize ungrounded subgenres (e.g. "Drama, Crime" does not authorize asserting "neo-noir" as a fact).

#### Surface B: SYNOPSIS & ALLOWED STORY MATERIAL (`allowedSourceMaterial`)
- Covers `overview`, `keywords`, and explicitly supplied descriptive evidence.
- Authorizes: plot setup, premises, named characters/entities, relationships, initial motives, depicted locations/settings, concrete story-context/event details, story mechanisms, chronology, explicit time constraints.
- **Rule 1**: Only explicitly stated setup elements are authorized. Unstated mechanisms, hidden origins, unrevealed motives, later plot turns, or unseen backstories are strictly unauthorized.

#### Surface C: ACCEPTED SEMANTIC CLASSIFICATION (`acceptedSemanticClassification`)
- Covers `pace`, `emotionalWeight`, `attentionDemand`, `discoveryStyle`, `moods`, `situations`.
- Authorizes: experiential and tonal framing from the viewer's perspective (e.g. "tense atmosphere", "deliberate pacing", "somber weight").
- **Rule 1**: **NEVER** authorizes new plot facts, character backstories, unseen story events, physical settings, or external lore.

#### Surface D: BOUNDARY FLAGS (`semanticBoundaryFlags`)
- Contains setup cutoff and forbidden reveal boundaries.
- Authorizes: negative constraints (defining what must **NOT** be mentioned).

#### Surface E: EXTERNAL KNOWLEDGE (`EXTERNAL_KNOWLEDGE`)
- Includes: parametric pretraining knowledge, franchise lore, adaptation history, real-world facts, actor trivia, and unprovided plot developments.
- **Status**: **NEVER AUTHORITATIVE**.
- **Rule 1**: External truth alone **NEVER** authorizes a detail. Even if a claim is 100% historically, factually, or lore-accurate in the real world, if absent from the packet it is **UNAUTHORIZED**.

---

## 5. Claim-Type Taxonomy & Risk-Category Semantics

Option A v1.2 categorizes all factual and descriptive propositions into 17 standardized claim classes, evaluated against 11 risk categories.

### 5.1 Semantic Principle: Unsupported Claim != Conflicting Claim
A critical semantic distinction is enforced across all claim evaluations:
- **Conflicting Claim (`MATERIAL_FACTUAL_CONFLICT`)**: The copy directly contradicts authorized packet facts or synopsis statements (e.g. release year 2004 vs 2012, runtime 90 mins vs 3 hours, or substituting contrary narrative facts).
- **Unsupported Claim (`UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM`)**: The copy introduces a concrete metadata, story-context, or event detail that lacks authorization in the packet, regardless of whether it might be true in the real world (e.g. asserting spoken language absent from `facts.spokenLanguages`, collapsing co-production countries to a single adjective, or asserting an ungrounded event context such as "ahead of auction").
- **Unresolved Grounding (`UNRESOLVED_SOURCE_GROUNDING_CONFLICT`)**: Narrowly restricted to subgenre, classification, or trope claims that cannot be resolved against authorized genres. It is **NOT** an overly broad catch-all for missing facts.

### 5.2 Claim Classes Matrix

| Claim Class | Allowed Authority Surface | Disallowed Surfaces | Tolerance | Primary Risk Category |
|---|---|---|---|---|
| `DIRECT_PACKET_FACT` | `PACKET_FACTS` | External, Semantic | Exact / Equivalent | `MATERIAL_FACTUAL_CONFLICT` (if contradictory) / `UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM` (if unsupported) |
| `LANGUAGE_CLAIM` | `PACKET_FACTS.spokenLanguages` | `facts.countries`, External | Strict lexical / array member | `UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM` |
| `NATIONALITY_OR_PRODUCTION_COUNTRY` | `PACKET_FACTS.countries` | `facts.spokenLanguages`, External | Preserves co-production | `UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM` |
| `GENRE_OR_SUBGENRE` | `PACKET_FACTS.genres`, Synopsis | Semantic, External | Exact genre or synopsis trope | `UNRESOLVED_SOURCE_GROUNDING_CONFLICT` |
| `STORY_SETUP_FACT` | `allowedSourceMaterial` | External, Semantic | Conservative paraphrase only | `UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM` (unauthorized setup) / `MATERIAL_FACTUAL_CONFLICT` (factual substitution) |
| `LOCATION_OR_SETTING` | `allowedSourceMaterial` | `facts.countries`, External | Explicit synopsis anchor only | `SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL` |
| `CHARACTER_RELATIONSHIP` | `allowedSourceMaterial` | External, Semantic | Explicit synopsis anchor only | `RELATIONSHIP_OR_CHARACTER_MOTIVE` |
| `CHARACTER_MOTIVE_OR_GOAL` | `allowedSourceMaterial` | External, Semantic | Explicit synopsis motive only | `RELATIONSHIP_OR_CHARACTER_MOTIVE` |
| `CAUSAL_OR_STORY_MECHANISM` | `allowedSourceMaterial` | External, Semantic | Explicit synopsis mechanism | `CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM` |
| `TEMPORAL_OR_DURATION_CONSTRAINT` | `allowedSourceMaterial`, `facts.runtime` | Semantic, External | Scale-consistent (no overstatement) | `MATERIAL_FACTUAL_CONFLICT` (overstatement) / `CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM` (deadline mechanism) |
| `QUANTITATIVE_CLAIM` | `PACKET_FACTS`, Synopsis | External | Exact / Authorized rounding | `MATERIAL_FACTUAL_CONFLICT` |
| `FRANCHISE_OR_EXTERNAL_LORE` | `allowedSourceMaterial` | External | Zero tolerance for external lore | `FRANCHISE_OR_EXTERNAL_LORE` |
| `SPOILER_OR_LATER_REVEAL` | `semanticBoundaryFlags` | All | Zero tolerance (setup only) | `SPOILER_OR_LATER_REVEAL` |
| `HIDDEN_IDENTITY_OR_ORIGIN` | `allowedSourceMaterial` | External | Zero tolerance for unstated secrets | `HIDDEN_IDENTITY_OR_ORIGIN` |
| `VIEWING_EXPERIENCE_INFERENCE` | `acceptedSemanticClassification`| External | Consistent with classification | `UNSUPPORTED_COMPARATIVE_OR_META_CLAIM` |
| `ATMOSPHERIC_OR_STYLISTIC_LANGUAGE`| `acceptedSemanticClassification`| External | Permitted if no concrete fact asserted | `UNSUPPORTED_COMPARATIVE_OR_META_CLAIM` |
| `SPECULATIVE_HOOK_PREMISE` | `allowedSourceMaterial` | External, Semantic | Presuppositions must be grounded | `SPECULATIVE_HOOK_PREMISE` |

---

## 6. Assertion Semantics for Indirect Claims

Verifier v1.2 explicitly instructs the verifier to evaluate indirect and rhetorical structures for factual assertions:

### 6.1 Interrogative Premises (Questions Assert Premises)
* **Principle**: Punctuation does not confer factual immunity.
* **Rule**: Questions often embed logical presuppositions that listeners/readers accept as common ground. For example:
  - *"what dark secret from its 1681 creation left a trail of misfortune?"* presupposes that (a) a dark secret exists, and (b) that secret is connected to the instrument's 1681 creation.
  - *"Will Cleo finish her formula before the competition begins?"* presupposes that (a) there is a formula, (b) there is a competition, and (c) there is a deadline.
* **Evaluation**: The verifier must extract all factual presuppositions from questions in `curiosityHook` and verify each against `allowedSourceMaterial`. If any presupposition is unsupported, it must be flagged under `SPECULATIVE_HOOK_PREMISE`.

### 6.2 Factual Modifiers (Modifiers Assert Facts)
* **Principle**: Adjectives and compound noun modifiers carry factual assertions.
* **Rule**: Descriptive modifiers are not harmless rhetoric when they assert objective attributes.
  - *"renowned swordsman"* asserts historical/story reputation.
  - *"snowy streets"* asserts specific weather and physical setting.
  - *"Russian-language"* asserts spoken language.
  - *"neo-noir"* asserts cinematic subgenre.
* **Evaluation**: All descriptive modifiers with concrete semantic content must be checked against the appropriate authority surface.

### 6.3 Idiomatic Mechanisms (Idioms Implying Concrete Constraints)
* **Principle**: Idioms that introduce concrete plot stakes, goals, or time constraints assert story facts.
* **Rule**: Expressions such as *"before supplies run out"*, *"to settle the score"*, or *"keep under wraps"* assert concrete countdowns, revenge motives, or cover-ups.
* **Evaluation**: If an ordinary viewer would understand the phrase as describing in-story facts, it requires explicit source support. Harmless figurative language (e.g. *"heart-pounding rhythm"*) is permitted, but mechanism-introducing language is not.

---

## 7. Replacement of Ambiguous v1.1 Carve-Outs

The following ambiguous clauses in v1.1 are formally replaced with precise materiality boundaries:

### 7.1 Metaphorical Urgency
* **v1.1 Clause**: *"metaphorical urgency... allowed when they do not assert a concrete new story fact."*
* **Observable Contract Defect**: v1.1 lacked explicit text establishing that finite deadlines, countdowns, and resource depletion claims are concrete temporal constraints.
* **v1.2 Replacement Contract**:
  > "Tonal urgency (e.g. 'tense', 'high-stakes', 'relentless') is permitted as viewing-experience inference. However, any assertion of an explicit deadline, countdown, finite resource depletion, ticking clock, or time-limited ultimatum is a concrete temporal constraint and is STRICTLY FORBIDDEN unless explicitly stated in `allowedSourceMaterial`."

### 7.2 Genre Register
* **v1.1 Clause**: *"genre register... allowed when they do not assert a concrete new story fact."*
* **Observable Contract Defect**: v1.1 did not state that asserting specific unlisted subgenres exceeds permissible stylistic register.
* **v1.2 Replacement Contract**:
  > "Copy may reflect the stylistic register of authorized genres (e.g. 'brooding tone', 'wry humor'). However, asserting specific subgenres not listed in `facts.genres` (e.g. 'neo-noir', 'cyberpunk', 'spaghetti western'), or asserting factual tropes typical of a genre without source support, is a material boundary violation."

### 7.3 Atmosphere / Texture
* **v1.1 Clause**: *"atmosphere... allowed when they do not assert a concrete new story fact."*
* **Observable Contract Defect**: v1.1 did not restrict atmosphere to sensory register, allowing ungrounded physical settings and weather to pass without synopsis grounding.
* **v1.2 Replacement Contract**:
  > "Atmospheric descriptors are restricted to psychological or sensory mood (e.g. 'somber', 'hazy', 'foreboding', 'claustrophobic'). Specific physical settings, weather conditions, geographic locations, or environmental elements require explicit support from `allowedSourceMaterial`."

### 7.4 Viewing-Experience Inference
* **v1.1 Clause**: *"viewing-experience inference are allowed when they do not assert a concrete new story fact."*
* **Observable Contract Defect**: v1.1 did not prevent attributing ungrounded psychological intentions or vengeance goals to characters.
* **v1.2 Replacement Contract**:
  > "Viewing-experience inference is strictly limited to synthesizing the film's verified pace, emotional weight, attention demand, and viewing situation. It must never attribute unstated feelings, beliefs, or inner monologues to characters in the film, nor predict unseen plot developments."

---

## 8. Taxonomy Discipline: The 11 Verifier v1.2 Risk Categories

Option A v1.2 defines 11 distinct risk categories:
- **9 Existing Categories Reused**: Preserved with tightened boundary definitions.
- **2 Targeted Categories**:
  - `SPECULATIVE_HOOK_PREMISE`: Captures ungrounded factual presuppositions embedded in curiosity hook questions.
  - `UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM`: Captures ungrounded metadata, language, nationality, or story-setup claims without forcing unsupported claims into `MATERIAL_FACTUAL_CONFLICT` or overusing `UNRESOLVED_SOURCE_GROUNDING_CONFLICT`.

### Category Definitions
1. `SPOILER_OR_LATER_REVEAL`: Reveals plot turns, climax, or resolution beyond setup.
2. `HIDDEN_IDENTITY_OR_ORIGIN`: Asserts or reveals unstated secret origins, true parentage, or covert identities.
3. `RELATIONSHIP_OR_CHARACTER_MOTIVE`: Sharpens, invents, or alters character motivations, alliances, or conflicts.
4. `CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM`: Introduces ungrounded plot devices, magical rules, concrete causal mechanisms, or ungrounded countdown deadlines.
5. `FRANCHISE_OR_EXTERNAL_LORE`: Imports comic-book lore, adaptation history, real-world external cases, or unprovided franchise backstory.
6. `SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL`: Inserts ungrounded script-level dialogue, micro-scenes, or unprovided physical settings/locations/weather.
7. `MATERIAL_FACTUAL_CONFLICT`: Directly contradicts authorized packet facts (runtime, director, language, year, countries) or substitutes synopsis facts.
8. `UNRESOLVED_SOURCE_GROUNDING_CONFLICT`: Asserts specific subgenres, historical tropes, or classifications where authority cannot be resolved against authorized genres.
9. `UNSUPPORTED_COMPARATIVE_OR_META_CLAIM`: Asserts absolute praise, industry impact, or unverifiable comparative audience claims.
10. `SPECULATIVE_HOOK_PREMISE`: Introduces ungrounded factual presuppositions, secrets, or deadlines inside curiosity hook questions.
11. `UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM`: Asserts concrete metadata or factual narrative setup not authorized by the applicable packet surface (e.g. ungrounded spoken language, unauthorized nationality collapse, ungrounded event context).

---

## 9. Structured Issue Evidence & LOW_RISK Contract

### 9.1 Structured Issue Schema
For every detected issue, Verifier v1.2 requires complete structured evidence distinguishing missing authority from direct contradiction:
```json
{
  "category": "SPECULATIVE_HOOK_PREMISE",
  "field": "curiosityHook",
  "claimSpan": "what dark secret from its 1681 creation left a trail of misfortune?",
  "normalizedClaim": "The instrument's 1681 creation is tied to a hidden dark secret.",
  "claimType": "SPECULATIVE_HOOK_PREMISE",
  "checkedAuthoritySources": ["allowedSourceMaterial.overview"],
  "authorityResolution": "UNSUPPORTED_MISSING_AUTHORITY",
  "materialityRationale": "The curiosityHook presupposes that a hidden secret exists and is connected to the instrument's 1681 creation. The authorized source establishes the creation date and subsequent journey, but does not establish any hidden-origin secret or causal secret-at-creation premise."
}
```

### 9.2 Strict `LOW_RISK` Coverage Contract
A candidate may receive `LOW_RISK` only when the verifier explicitly confirms that all 10 material check groups have been executed:
```json
{
  "riskLevel": "LOW_RISK",
  "riskCategories": [],
  "issues": [],
  "sourceBoundarySatisfied": true,
  "lowRiskCoverage": {
    "allVisibleFieldsAudited": true,
    "interrogativePremisesAudited": true,
    "factualModifiersAudited": true,
    "packetFactsAudited": true,
    "settingAndLocationAudited": true,
    "characterMotivesAndRelationshipsAudited": true,
    "storyMechanismsAndConstraintsAudited": true,
    "externalLoreAndBackstoryAudited": true,
    "spoilerAndRevealBoundariesAudited": true,
    "viewingExperienceInferenceAudited": true,
    "summaryRationale": "All visible copy fields stay strictly within authorized setup facts and verified semantic tokens with zero external lore or ungrounded premises."
  }
}
```

---

## 10. Known Severe Failure Coverage (`scale500-tmdb-14283` / *The Red Violin*)

Under source-only analysis of the development packet for `scale500-tmdb-14283` (*The Red Violin*), the v1.2 contract explicitly requires examination of both defects:

1. **Curiosity Hook Defect**:
   - Source-Only Formulation: The curiosityHook presupposes that a hidden secret exists and is connected to the instrument's 1681 creation. The authorized source establishes the creation date and subsequent journey, but does not establish any hidden-origin secret or causal secret-at-creation premise.
   - Claim Type: `SPECULATIVE_HOOK_PREMISE` & `HIDDEN_IDENTITY_OR_ORIGIN`.
   - Authority Check: `allowedSourceMaterial.overview` contains no mention of an origin secret.
   - Contract Ruling: Presupposition extraction rule requires verification; absence in overview triggers `SPECULATIVE_HOOK_PREMISE` and `HIDDEN_IDENTITY_OR_ORIGIN`.

2. **Description Defect**:
   - Source-Only Formulation: "Ahead of auction" introduces a concrete story-context/event detail not authorized by the applicable story-source surface. The copy asserts that an appraisal is occurring in advance of an auction, which is absent from `allowedSourceMaterial.overview`.
   - Claim Type: `STORY_SETUP_FACT`.
   - Authority Check: `allowedSourceMaterial.overview` contains no mention of an impending auction, and `allowedSourceMaterial.keywords` is `[]`.
   - Contract Ruling: Story-context and setup facts require explicit synopsis support; absence triggers `UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM`.

> **FORMAL STATUS: `SPECIFICATION_COVERS_KNOWN_SEVERE_FAILURE`**  
> *(Note: This confirms that the specification explicitly mandates detection under its formal rules. It does NOT claim that the model has empirically detected it; empirical verification requires future controlled replay.)*

---

## 11. Static Contract Coverage of the 16 Retrospective Development Misses

Evaluating the 16 human review misses from the retrospective development set (`scale-tranche-2-verifier-gap-analysis.v1.1.json`) against the Option A v1.2 specification:

### Status Label: `DEVELOPMENT_SET_STATIC_SPECIFICATION_COVERAGE`
* **What this means**:
  - Every known defect has a defined claim class.
  - The authority surface is formally established.
  - An explicit risk category path exists.
  - The prior contract ambiguity has been addressed.
* **What this does NOT mean**:
  - It does NOT mean the model empirically detects the defect.
  - It does NOT mean 100% recall.
  - It does NOT mean the verifier is validated.
  - It does NOT mean the specification generalizes.
  - It MUST NOT be expressed as empirical recall or precision.

| # | Candidate ID | Film Title | Human Defect Category | v1.1 Contract Defect Form | v1.2 Claim Class | v1.2 Risk Category | v1.2 Coverage Status |
|---|---|---|---|---|---|---|---|
| 1 | `scale500-tmdb-2604` | *Born on the Fourth of July* | Factual substitution | v1.1 lacked explicit check against narrative concept substitution | `STORY_SETUP_FACT` | `MATERIAL_FACTUAL_CONFLICT` | **SPEC_COVERED** |
| 2 | `scale500-tmdb-360605` | *Invisible Sister* | Plot mechanism / motive sharpening | v1.1 lacked presupposition extraction for hook questions | `SPECULATIVE_HOOK_PREMISE` | `SPECULATIVE_HOOK_PREMISE` | **SPEC_COVERED** |
| 3 | `scale500-tmdb-509585` | *7500* | Location / external leakage | v1.1 atmosphere carve-out lacked exclusion of flight routes/locations | `LOCATION_OR_SETTING` | `SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL` | **SPEC_COVERED** |
| 4 | `scale500-tmdb-13398` | *Tokyo Godfathers* | Concrete detail / motive sharpening | v1.1 lacked explicit instruction to audit secondary plot mechanisms | `CAUSAL_OR_STORY_MECHANISM` | `CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM` | **SPEC_COVERED** |
| 5 | `scale500-tmdb-354556` | *Guardians* | Duration overstatement ("decades") | v1.1 lacked explicit scale-consistency rule for temporal constraints | `TEMPORAL_OR_DURATION_CONSTRAINT` | `MATERIAL_FACTUAL_CONFLICT` | **SPEC_COVERED** |
| 6 | `exp100-tmdb-18129` | *The Grifters* | Subgenre assertion ("neo-noir") | v1.1 "genre register" carve-out lacked prohibition on unlisted subgenres | `GENRE_OR_SUBGENRE` | `UNRESOLVED_SOURCE_GROUNDING_CONFLICT` | **SPEC_COVERED** |
| 7 | `scale500-tmdb-1563` | *Sans Soleil* | Location / weather leakage | v1.1 atmosphere carve-out lacked exclusion of physical weather/setting | `LOCATION_OR_SETTING` | `SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL` | **SPEC_COVERED** |
| 8 | `scale500-tmdb-14283` | *The Red Violin* [SEVERE] | Ungrounded origin secret & ungrounded event context ("ahead of auction") | v1.1 lacked presupposition extraction and allowed ungrounded story setup | `SPECULATIVE_HOOK_PREMISE` & `STORY_SETUP_FACT` | `HIDDEN_IDENTITY_OR_ORIGIN` & `UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM` | **SPEC_COVERED** |
| 9 | `scale500-tmdb-127533` | *Rurouni Kenshin Part I* | Franchise lore import | v1.1 lacked zero-tolerance rule for unprovided manga backstory | `FRANCHISE_OR_EXTERNAL_LORE` | `FRANCHISE_OR_EXTERNAL_LORE` | **SPEC_COVERED** |
| 10 | `scale500-tmdb-445` | *Caché* | Nationality collapse ("French mystery")| v1.1 lacked prohibition on collapsing multi-country co-productions | `NATIONALITY_OR_PRODUCTION_COUNTRY` | `UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM` | **SPEC_COVERED** |
| 11 | `scale500-tmdb-265208` | *Wild Card* | Motive sharpening / plot mechanism | v1.1 viewing-experience carve-out lacked boundary on character motives | `CHARACTER_MOTIVE_OR_GOAL` | `RELATIONSHIP_OR_CHARACTER_MOTIVE` | **SPEC_COVERED** |
| 12 | `scale500-tmdb-22824` | *The Fourth Kind* | External lore / real-world case | v1.1 lacked prohibition on importing external real-world case facts | `FRANCHISE_OR_EXTERNAL_LORE` | `FRANCHISE_OR_EXTERNAL_LORE` | **SPEC_COVERED** |
| 13 | `scale500-tmdb-40662` | *Batman: Under the Red Hood* | Franchise lore import | v1.1 lacked zero-tolerance rule for parametric comic-book lore | `FRANCHISE_OR_EXTERNAL_LORE` | `FRANCHISE_OR_EXTERNAL_LORE` | **SPEC_COVERED** |
| 14 | `scale500-tmdb-11866` | *Flight of the Phoenix* | Ticking-clock deadline ("before supplies...") | v1.1 "metaphorical urgency" carve-out lacked exclusion of deadlines | `TEMPORAL_OR_DURATION_CONSTRAINT` | `CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM` | **SPEC_COVERED** |
| 15 | `scale500-tmdb-16804` | *Departures* | Factual substitution | v1.1 lacked explicit check against inaccurate setup simplification | `STORY_SETUP_FACT` | `MATERIAL_FACTUAL_CONFLICT` | **SPEC_COVERED** |
| 16 | `scale500-tmdb-27670` | *Nothing Left to Do But Cry*| Motive sharpening / later turn | v1.1 lacked setup-cutoff boundary on unstated character intentions | `CHARACTER_MOTIVE_OR_GOAL` | `RELATIONSHIP_OR_CHARACTER_MOTIVE` | **SPEC_COVERED** |

**Static Coverage Result**: 16/16 development misses (100%) have explicit static specification paths.

---

## 12. Option B ↔ Option A Interaction Model: `PROVISIONAL_INTERACTION_POLICY`

Option B deterministic source-boundary lint and Option A semantic verifier v1.2 represent complementary containment concepts. However, Option B currently has only retrospective-development evidence (N=30 development set, four confirmed hits, no independent prospective validation).

Therefore, this interaction policy is **PROVISIONAL** and is **NOT** authorized as finalized production policy.

### Evaluated Controlled-Replay Modes

Future controlled replay will evaluate and compare two operational modes:

#### MODE A — EVIDENCE SUPPLIER
```
Option B deterministic finding
  │
  ▼
Supplied as structured `deterministicLintFindings` to Option A Semantic Verifier
  │
  ▼
Option A Semantic Verifier + downstream routing logic decide final risk level
```
* **Characteristics**: Option B acts as an advisory pre-pass, surfacing exact lexical flags (e.g. duration units, country lists) for semantic contextualization by the verifier model.

#### MODE B — HARD GATE SIMULATION
```
Option B high-confidence finding
  │
  ├── [HIT]  ──► Mandatory HUMAN_REVIEW route (bypasses verifier AUTO eligibility)
  │
  └── [CLEAN] ──► Option A Semantic Verifier determines risk level
```
* **Characteristics**: Option B acts as an autonomous blocking gate. Any deterministic hit immediately prevents `AUTO_ELIGIBLE` routing.

### Comparison Objectives for Replay
Future controlled replay must compare Mode A and Mode B on:
1. **Incremental human-review burden**: Queue size and review overhead added by each mode.
2. **Severe/minor miss containment**: Recall on confirmed human defects.
3. **Clean-record over-routing**: False-positive rate on fully compliant records.

Neither mode is authorized for production routing until prospective replay is completed and reviewed.

---

## 13. Future Controlled Replay Design

To empirically evaluate Option A v1.2 without methodology contamination:

### 13.1 Dataset Separation
1. **Retrospective Development Set (N = 30)**:
   - The existing 30 audited records from Scale Tranche 2.
   - Used strictly for prompt engineering calibration, debugging, and sanity checks.
   - All performance measured on this set is labeled `APPARENT_RETROSPECTIVE_PERFORMANCE`.
2. **Independent Prospective Blinded Holdout**:
   - A newly sampled cohort of records, drawn independently and prospectively.
   - Evaluated under blind human review and automated verifier simultaneously.
   - **Strict Invariant**: Terminology must remain `independent prospective blinded holdout`. Any non-blinded terminology is strictly forbidden.

### 13.2 Performance Metrics to Measure
Future controlled replay must measure at least:
1. **Human-Miss Sensitivity**: Recall across human-confirmed defect cases.
2. **Severe-Miss Observations**: Count and rate of severe defect occurrences.
3. **Clean-Record False-Positive Rate / Specificity**: Proportion of clean records correctly identified vs over-routed.
4. **Issue-Level Concordance**: Semantic agreement between automated findings and human rationale.
5. **Review-Routing Burden**: Proportion of total candidates routed to human review.
6. **Malformed/Verifier Failure Rate**: Schema and parsing conformance rate.
7. **Model Cost**: Token consumption and latency per candidate.

### 13.3 Threshold-Setting Principles
Numeric acceptance thresholds for prospective replay are **NOT** predeclared in this specification, because valid statistical thresholds require independent evidence. Acceptance thresholds must be predeclared prior to execution based on:
1. **Holdout Size**: Statistical power of the sampled cohort.
2. **Expected Positives & Severes**: Base-rate estimates of defect frequency.
3. **Acceptable Human-Review Burden**: Operational capacity of the review queue.
4. **Statistical Uncertainty**: Confidence intervals around sensitivity and specificity estimates.
5. **Governance Tolerance for Severe Misses**: Risk threshold defined by product policy.
6. **Economic Constraints**: Token and verification budget limits.

### 13.4 Governance Safety Gates
Performance metrics are strictly separated from governance safety gates. The severe safety gate is defined as:

> **GOVERNANCE SAFETY GATE**:  
> Any observed SEVERE human miss that passed automated AUTO eligibility triggers fail-closed escalation under the applicable governance policy.

*(Note: This is a deterministic governance safety gate, not a claim of statistically measured 100% severe sensitivity.)*

---

## 14. Structural Cost & Complexity Budget

- **Input Token Delta**: Adding explicit source authority guidelines and negative definitions increases input prompt size by approximately 250–350 tokens per candidate.
- **Output Token Delta**:
  - For `HIGH_RISK` records, structured issue evidence adds ~50–80 tokens per issue.
  - For `LOW_RISK` records, the 10-point `lowRiskCoverage` audit checklist adds ~80 tokens per record.
- **Model Parameters**: Verifier thinking level should remain standard; model capacity should focus on strict adherence to the authority hierarchy rather than open-ended reasoning.
- **Complexity Assessment**: The modest increase in token budget (~10–15% total verifier cost) is justified by eliminating the operational cost of severe audit misses and subsequent governance freezes.
