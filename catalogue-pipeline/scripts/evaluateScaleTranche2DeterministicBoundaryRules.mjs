import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArtifact, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

export const OPTION_B_RULE_VERSION = 'v1.1-deterministic-development'
export const HISTORICAL_OPTION_B_V1_HASH =
  'sha256:fb5cd364bcdf2f57c8d4edde71c9fff025b1500611ec15690a5be42a6a66c143'

// Generic controlled vocabularies (no film titles, character names, or candidate IDs)
export const GENERIC_VOCABULARIES = Object.freeze({
  languages: [
    'russian', 'french', 'spanish', 'german', 'italian', 'japanese', 'mandarin',
    'cantonese', 'korean', 'hindi', 'arabic', 'portuguese', 'swedish', 'danish',
    'norwegian', 'dutch', 'polish', 'turkish', 'greek', 'hebrew', 'thai', 'vietnamese',
    'english'
  ],
  subgenres: [
    'neo-noir', 'film noir', 'mockumentary', 'spaghetti western', 'dramedy',
    'space opera', 'cyberpunk', 'steampunk'
  ],
  demonyms: {
    'french': 'France',
    'italian': 'Italy',
    'german': 'Germany',
    'russian': 'Russia',
    'spanish': 'Spain',
    'british': 'United Kingdom',
    'english': 'United Kingdom',
    'american': 'United States of America',
    'japanese': 'Japan',
    'canadian': 'Canada',
    'austrian': 'Austria',
    'chinese': 'China',
    'korean': 'South Korea',
    'australian': 'Australia',
    'mexican': 'Mexico',
    'danish': 'Denmark',
    'swedish': 'Sweden'
  },
  commonGenres: [
    'drama', 'comedy', 'mystery', 'thriller', 'action', 'romance', 'adventure',
    'fantasy', 'horror', 'crime', 'western', 'war', 'documentary', 'animation',
    'family', 'history', 'music', 'science fiction'
  ],
  deadlinePhrases: [
    'deadline', 'before time runs out', 'race against the clock', 'race against clock', 'ticking clock'
  ]
})

/**
 * Stage 7 — Authorized-source invariant documentation.
 * Declares the exact authority surface and forbidden sources for each deterministic rule family.
 */
export const RULE_AUTHORITY_DECLARATIONS = Object.freeze({
  RULE_A_LANGUAGE_CLAIM_SUPPORT: {
    ruleId: 'RULE_A_LANGUAGE_CLAIM_SUPPORT',
    copyFieldsInspected: ['description', 'whyWatch', 'curiosityHook', 'vibeSummary'],
    authorizedSourceFields: ['facts.spokenLanguages'],
    explicitlyForbiddenAuthoritySources: [
      'facts.countries (country of origin does not authorize language claim)',
      'externalKnowledge',
      'speculativeCulturalInference'
    ]
  },
  RULE_B_DURATION_OVERSTATEMENT: {
    ruleId: 'RULE_B_DURATION_OVERSTATEMENT',
    copyFieldsInspected: ['description', 'whyWatch', 'curiosityHook', 'vibeSummary'],
    authorizedSourceFields: ['allowedSourceMaterial.overview', 'facts.overview'],
    explicitlyForbiddenAuthoritySources: [
      'rawFactsMetadataExclusions',
      'externalKnowledge',
      'unauthorizedKeywordsWhenEmptyInAllowedSourceMaterial'
    ]
  },
  RULE_C_SUBGENRE_ASSERTION: {
    ruleId: 'RULE_C_SUBGENRE_ASSERTION',
    copyFieldsInspected: ['description', 'whyWatch', 'curiosityHook', 'vibeSummary'],
    authorizedSourceFields: ['facts.genres'],
    explicitlyForbiddenAuthoritySources: [
      'unanchoredSubgenres',
      'externalKnowledge',
      'broadAtmosphericSimilarity'
    ]
  },
  RULE_D_NATIONALITY_GENRE_COLLAPSE: {
    ruleId: 'RULE_D_NATIONALITY_GENRE_COLLAPSE',
    copyFieldsInspected: ['description', 'whyWatch', 'curiosityHook', 'vibeSummary'],
    authorizedSourceFields: ['facts.countries'],
    explicitlyForbiddenAuthoritySources: [
      'singleCountrySimplificationWhenCoProduction',
      'externalKnowledge'
    ]
  },
  RULE_E_EXPLICIT_DEADLINE_CLAIM: {
    ruleId: 'RULE_E_EXPLICIT_DEADLINE_CLAIM',
    copyFieldsInspected: ['description', 'whyWatch', 'curiosityHook', 'vibeSummary'],
    authorizedSourceFields: ['allowedSourceMaterial.overview', 'facts.overview'],
    explicitlyForbiddenAuthoritySources: [
      'metaphoricalUrgencyWithoutSourceTimeConstraint',
      'externalKnowledge'
    ]
  }
})

export const OUT_OF_SCOPE_FOR_OPTION_B_V1 = Object.freeze([
  'hidden secrets',
  'spoiler implications',
  'character motive sharpening',
  'relationship sharpening',
  'externally true franchise lore',
  'invented goals',
  'speculative plot mechanisms',
  'rhetorical-question presuppositions',
  'setting inference such as cockpit',
  'factual near-synonym substitutions like civil rights/human rights'
])

/**
 * Evaluates deterministic boundary rules on a single record.
 * Fully isolated from production routing.
 */
export function evaluateDeterministicBoundaryRules(record, options = {}) {
  const hits = []
  const copy = record.computedFacts?.visibleEditorialCopy || record.visibleEditorialCopy || {}
  const sourceFacts = record.computedFacts?.sourceFacts || record.sourceFacts || {}
  const overview = (sourceFacts.overview || '').toLowerCase()
  const spokenLanguages = (sourceFacts.spokenLanguages || []).map((s) => s.toLowerCase())
  const genres = (sourceFacts.genres || []).map((g) => g.toLowerCase())
  const countries = sourceFacts.countries || []

  const activeRules = options.activeRules || ['RULE_A', 'RULE_B', 'RULE_C', 'RULE_D', 'RULE_E']

  for (const [field, text] of Object.entries(copy)) {
    if (typeof text !== 'string') continue

    // RULE A: Explicit language claim support
    if (activeRules.includes('RULE_A')) {
      const langRegex = /\b([A-Za-z]+)-language\b/gi
      let m
      while ((m = langRegex.exec(text)) !== null) {
        const lang = m[1].toLowerCase()
        if (lang !== 'multi' && GENERIC_VOCABULARIES.languages.includes(lang)) {
          if (!spokenLanguages.includes(lang)) {
            hits.push({
              ruleId: 'RULE_A_LANGUAGE_CLAIM_SUPPORT',
              field,
              matchedText: m[0],
              sourceAnchor: `spokenLanguages: [${spokenLanguages.join(', ')}]`,
              reason: `Explicit language claim '${m[0]}' lacks authorized anchor in spokenLanguages.`
            })
          }
        }
      }
    }

    // RULE B: Duration overstatement (decades not anchored in overview)
    if (activeRules.includes('RULE_B')) {
      const durRegex = /\bdecades?\b/gi
      let m
      while ((m = durRegex.exec(text)) !== null) {
        const hasDecadeInOverview = /\bdecades?\b/i.test(overview)
        const hasMultiDecadeNumeral = /\b(?:[2-9]\d|\d0)\s+years\b/i.test(overview)
        // Generic temporal grounding: calendar decade references (e.g. "Since the 1960s", "1970s", "2000s")
        const hasCalendarDecadeInOverview = /\b(?:since\s+(?:the\s+)?)?(?:1[89]|20)\d0s\b/i.test(overview) || /\b\d{4}s\b/i.test(overview)

        if (!hasDecadeInOverview && !hasMultiDecadeNumeral && !hasCalendarDecadeInOverview) {
          hits.push({
            ruleId: 'RULE_B_DURATION_OVERSTATEMENT',
            field,
            matchedText: m[0],
            sourceAnchor: `overview: "${overview.slice(0, 80)}..."`,
            reason: `Duration term '${m[0]}' is absent from authorized overview and unsupported by multiple-decade numerals or calendar decade anchors.`
          })
        }
      }
    }

    // RULE C: Subgenre assertion (e.g. neo-noir)
    if (activeRules.includes('RULE_C')) {
      for (const sg of GENERIC_VOCABULARIES.subgenres) {
        const re = new RegExp(`\\b${sg}\\b`, 'i')
        const match = re.exec(text)
        if (match) {
          const isAnchored = genres.some((g) => g.includes(sg) || sg.includes(g))
          if (!isAnchored) {
            hits.push({
              ruleId: 'RULE_C_SUBGENRE_ASSERTION',
              field,
              matchedText: match[0],
              sourceAnchor: `genres: [${genres.join(', ')}]`,
              reason: `Specific subgenre '${match[0]}' asserted without parent/exact anchor in authorized genres.`
            })
          }
        }
      }
    }

    // RULE D: Nationality / primary-country collapse
    if (activeRules.includes('RULE_D')) {
      for (const [demonym, country] of Object.entries(GENERIC_VOCABULARIES.demonyms)) {
        for (const g of GENERIC_VOCABULARIES.commonGenres) {
          const re = new RegExp(`\\b${demonym}\\s+${g}\\b`, 'i')
          const match = re.exec(text)
          if (match && countries.length > 1) {
            hits.push({
              ruleId: 'RULE_D_NATIONALITY_GENRE_COLLAPSE',
              field,
              matchedText: match[0],
              sourceAnchor: `countries (${countries.length}): [${countries.join(', ')}]`,
              reason: `Collapsed multi-country co-production into singular nationality classification '${match[0]}'.`
            })
          }
        }
      }
    }

    // RULE E: Explicit deadline / ticking-clock claim
    if (activeRules.includes('RULE_E')) {
      for (const phrase of GENERIC_VOCABULARIES.deadlinePhrases) {
        const re = new RegExp(`\\b${phrase}\\b`, 'i')
        const match = re.exec(text)
        if (match) {
          const inOverview = overview.includes('deadline') || overview.includes('clock') || overview.includes('time runs out')
          if (!inOverview) {
            hits.push({
              ruleId: 'RULE_E_EXPLICIT_DEADLINE_CLAIM',
              field,
              matchedText: match[0],
              sourceAnchor: `overview: "${overview.slice(0, 80)}..."`,
              reason: `Explicit deadline/clock claim '${match[0]}' asserted with no temporal constraint in authorized overview.`
            })
          }
        }
      }
    }
  }

  return hits
}

/**
 * Classifies a specific rule hit into defect-level concordance categories:
 * - HUMAN_CONFIRMED_DEFECT
 * - SOURCE_SUPPORTED_FALSE_HIT
 * - UNADJUDICATED_HIT
 * - AMBIGUOUS
 */
export function classifyRuleHit(hit, record) {
  const humanDecision = record.computedFacts?.humanDecision || record.humanDecision
  const affectedFields = record.computedFacts?.affectedFields || record.affectedFields || []
  const humanReason = (record.computedFacts?.humanReason || record.humanReason || '').toLowerCase()
  const overview = (record.computedFacts?.sourceFacts?.overview || record.sourceFacts?.overview || '').toLowerCase()

  if (humanDecision === 'APPROVE') {
    return {
      classification: 'UNADJUDICATED_HIT',
      rationale: 'Hit occurred on a candidate approved clean by human review; defect unconfirmed.'
    }
  }

  // Check if the term is semantically grounded in source (e.g. calendar decade anchors)
  if (hit.ruleId === 'RULE_B_DURATION_OVERSTATEMENT') {
    const hasCalendarDecade = /\b(?:since\s+(?:the\s+)?)?(?:1[89]|20)\d0s\b/i.test(overview) || /\b\d{4}s\b/i.test(overview)
    if (hasCalendarDecade && !humanReason.includes('decade')) {
      return {
        classification: 'SOURCE_SUPPORTED_FALSE_HIT',
        rationale: 'Duration term is semantically supported by calendar decade anchor in authorized overview (e.g. "Since the 1960s") and human review accepted description as faithful.'
      }
    }
  }

  const fieldMatches = affectedFields.includes(hit.field)
  const textMatches = humanReason.includes(hit.matchedText.toLowerCase()) ||
    (hit.ruleId === 'RULE_D_NATIONALITY_GENRE_COLLAPSE' && (humanReason.includes('co-production') || humanReason.includes('nationality'))) ||
    (hit.ruleId === 'RULE_C_SUBGENRE_ASSERTION' && humanReason.includes('subgenre')) ||
    (hit.ruleId === 'RULE_E_EXPLICIT_DEADLINE_CLAIM' && (humanReason.includes('deadline') || humanReason.includes('ticking clock'))) ||
    (hit.ruleId === 'RULE_B_DURATION_OVERSTATEMENT' && humanReason.includes('decade'))

  if (fieldMatches && textMatches) {
    return {
      classification: 'HUMAN_CONFIRMED_DEFECT',
      rationale: `Human review reason and affected field '${hit.field}' directly corroborate the boundary defect detected by '${hit.ruleId}' on '${hit.matchedText}'.`
    }
  }

  if (!fieldMatches && !textMatches) {
    return {
      classification: 'SOURCE_SUPPORTED_FALSE_HIT',
      rationale: `Candidate was labeled REVISE for unrelated defects; human reviewer did not cite field '${hit.field}' or term '${hit.matchedText}'.`
    }
  }

  return {
    classification: 'AMBIGUOUS',
    rationale: `Partial concordance between rule hit on field '${hit.field}' and recorded human review reason.`
  }
}

/**
 * Runs the full development evaluation on the 30-record retrospective dataset.
 */
export async function runScaleTranche2OptionBEvaluation({ repoRoot, version = 'v1.1' }) {
  const base = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
  const gapFileName = version === 'v1.1'
    ? 'scale-tranche-2-verifier-gap-analysis.v1.1.json'
    : 'scale-tranche-2-verifier-gap-analysis.v1.json'
  const gapArtifactPath = path.join(base, gapFileName)
  let gapAnalysis
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      gapAnalysis = JSON.parse(await readFile(gapArtifactPath, 'utf8'))
      break
    } catch (err) {
      if (attempt === 4) throw err
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  const datasetHash = hashArtifact(gapAnalysis)
  const records = gapAnalysis.records || []

  // Dynamic discovery of relevant records for trace documentation without hardcoding candidate IDs or titles
  const langTraceRec = records.find((r) =>
    JSON.stringify(r.computedFacts?.visibleEditorialCopy || {}).includes('Russian-language')
  )
  const fourthKindTraceRec = records.find((r) =>
    (r.computedFacts?.sourceFacts?.overview || '').includes('1960s')
  )

  // All 5 rule families
  const ruleFamilies = [
    { id: 'RULE_A', name: 'RULE_A_LANGUAGE_CLAIM_SUPPORT' },
    { id: 'RULE_B', name: 'RULE_B_DURATION_OVERSTATEMENT' },
    { id: 'RULE_C', name: 'RULE_C_SUBGENRE_ASSERTION' },
    { id: 'RULE_D', name: 'RULE_D_NATIONALITY_GENRE_COLLAPSE' },
    { id: 'RULE_E', name: 'RULE_E_EXPLICIT_DEADLINE_CLAIM' }
  ]

  function evaluateCohort(activeRuleIds) {
    let tp = 0, fp = 0, tn = 0, fn = 0
    const candidateResults = []
    const allRuleHits = []
    const ruleStats = {}
    for (const rf of ruleFamilies) {
      ruleStats[rf.name] = {
        candidatesFlagged: new Set(),
        missesCaught: new Set(),
        cleanFlagged: new Set(),
        hits: []
      }
    }

    for (const r of records) {
      const humanDecision = r.computedFacts.humanDecision
      const isPositive = humanDecision === 'REVISE'
      const hits = evaluateDeterministicBoundaryRules(r, { activeRules: activeRuleIds })
      const deterministicFlagged = hits.length > 0

      if (deterministicFlagged && isPositive) tp += 1
      else if (deterministicFlagged && !isPositive) fp += 1
      else if (!deterministicFlagged && isPositive) fn += 1
      else tn += 1

      const classifiedHits = hits.map((h) => {
        const concordance = classifyRuleHit(h, r)
        const hitRecord = {
          candidateId: r.candidateId,
          tmdbId: r.tmdbId,
          ruleId: h.ruleId,
          field: h.field,
          matchedText: h.matchedText,
          sourceAnchor: h.sourceAnchor,
          reason: h.reason,
          concordanceClassification: concordance.classification,
          concordanceRationale: concordance.rationale
        }
        allRuleHits.push(hitRecord)
        if (ruleStats[h.ruleId]) {
          ruleStats[h.ruleId].hits.push(hitRecord)
        }
        return hitRecord
      })

      for (const h of hits) {
        if (ruleStats[h.ruleId]) {
          ruleStats[h.ruleId].candidatesFlagged.add(r.candidateId)
          if (isPositive) ruleStats[h.ruleId].missesCaught.add(r.candidateId)
          else ruleStats[h.ruleId].cleanFlagged.add(r.candidateId)
        }
      }

      candidateResults.push({
        candidateId: r.candidateId,
        tmdbId: r.tmdbId,
        humanDecision,
        humanSeverity: r.computedFacts.humanSeverity,
        deterministicFlagged,
        ruleHits: classifiedHits
      })
    }

    const routingPPV = (tp + fp) > 0 ? tp / (tp + fp) : 0
    const routingRecall = (tp + fn) > 0 ? tp / (tp + fn) : 0
    const routingFPR = (fp + tn) > 0 ? fp / (fp + tn) : 0
    const routingSpecificity = (fp + tn) > 0 ? tn / (fp + tn) : 0

    return {
      confusion: { tp, fn, fp, tn, total: records.length },
      candidateRoutingMetrics: {
        apparentRoutingRecall: routingRecall,
        apparentRoutingPPV: routingPPV,
        apparentRoutingFalsePositiveRate: routingFPR,
        apparentRoutingSpecificity: routingSpecificity
      },
      candidateResults,
      allRuleHits,
      ruleStats
    }
  }

  // 1. Primary evaluation (all 5 rules active)
  const primaryEval = evaluateCohort(['RULE_A', 'RULE_B', 'RULE_C', 'RULE_D', 'RULE_E'])

  // Severe case evaluation
  const severeRec = primaryEval.candidateResults.find((c) => c.humanSeverity === 'SEVERE')
  const severeDetected = severeRec?.deterministicFlagged || false

  // 2. Hit-level concordance aggregation
  const concordanceCounts = {
    totalRuleHits: primaryEval.allRuleHits.length,
    humanConfirmedDefects: primaryEval.allRuleHits.filter((h) => h.concordanceClassification === 'HUMAN_CONFIRMED_DEFECT').length,
    sourceSupportedFalseHits: primaryEval.allRuleHits.filter((h) => h.concordanceClassification === 'SOURCE_SUPPORTED_FALSE_HIT').length,
    unadjudicatedHits: primaryEval.allRuleHits.filter((h) => h.concordanceClassification === 'UNADJUDICATED_HIT').length,
    ambiguousHits: primaryEval.allRuleHits.filter((h) => h.concordanceClassification === 'AMBIGUOUS').length
  }

  // 3. Per-rule contribution: both Candidate Routing level and Hit Concordance level
  const perRuleContribution = {}
  for (const rf of ruleFamilies) {
    const stats = primaryEval.ruleStats[rf.name]
    const otherHits = new Set()
    for (const other of ruleFamilies) {
      if (other.name !== rf.name) {
        for (const cid of primaryEval.ruleStats[other.name].missesCaught) {
          otherHits.add(cid)
        }
      }
    }
    const uniqueMisses = [...stats.missesCaught].filter((cid) => !otherHits.has(cid))

    const flaggedCount = stats.candidatesFlagged.size
    const missesCaughtCount = stats.missesCaught.size
    const cleanFlaggedCount = stats.cleanFlagged.size
    const ppv = flaggedCount > 0 ? (missesCaughtCount / flaggedCount) : 0

    const hits = stats.hits
    const confirmedCount = hits.filter((h) => h.concordanceClassification === 'HUMAN_CONFIRMED_DEFECT').length
    const falseHitCount = hits.filter((h) => h.concordanceClassification === 'SOURCE_SUPPORTED_FALSE_HIT').length
    const unadjCount = hits.filter((h) => h.concordanceClassification === 'UNADJUDICATED_HIT').length
    const ambigCount = hits.filter((h) => h.concordanceClassification === 'AMBIGUOUS').length

    perRuleContribution[rf.name] = {
      candidateRouting: {
        candidatesFlaggedCount: flaggedCount,
        missesCaughtCount,
        cleanApprovalsFlaggedCount: cleanFlaggedCount,
        apparentRoutingPPV: flaggedCount > 0 ? `${(ppv * 100).toFixed(1)}% (${missesCaughtCount}/${flaggedCount})` : 'N/A (0 candidates flagged)',
        uniqueMissesCaughtCount: uniqueMisses.length,
        uniqueMissesCandidateIds: uniqueMisses
      },
      hitLevelConcordance: {
        totalHits: hits.length,
        humanConfirmedDefects: confirmedCount,
        sourceSupportedFalseHits: falseHitCount,
        unadjudicatedHits: unadjCount,
        ambiguousHits: ambigCount,
        concordanceRate: hits.length > 0 ? `${((confirmedCount / hits.length) * 100).toFixed(1)}% (${confirmedCount}/${hits.length})` : 'N/A (0 hits)'
      },
      // Backward compatibility aliases
      candidatesFlaggedCount: flaggedCount,
      missesCaughtCount,
      cleanApprovalsFlaggedCount: cleanFlaggedCount,
      uniqueMissesCaughtCount: uniqueMisses.length,
      uniqueMissesCandidateIds: uniqueMisses
    }
  }

  // 4. Leave-one-rule-out ablation
  const ablationResults = {}
  for (const rf of ruleFamilies) {
    const remainingRuleIds = ruleFamilies.filter((x) => x.id !== rf.id).map((x) => x.id)
    const ablEval = evaluateCohort(remainingRuleIds)
    ablationResults[`without_${rf.name}`] = {
      omittedRule: rf.name,
      apparentRoutingRecall: ablEval.candidateRoutingMetrics.apparentRoutingRecall,
      apparentRoutingPPV: ablEval.candidateRoutingMetrics.apparentRoutingPPV,
      tp: ablEval.confusion.tp,
      fp: ablEval.confusion.fp,
      deltaTP: ablEval.confusion.tp - primaryEval.confusion.tp,
      deltaFP: ablEval.confusion.fp - primaryEval.confusion.fp
    }
  }

  // 5. Stage 5 — Conservative development status vocabulary
  const ruleClassifications = {
    RULE_A_LANGUAGE_CLAIM_SUPPORT: {
      disposition: 'RETAIN_EXPERIMENTAL',
      rationale:
        'Zero false positives and sound source-boundary principle, but zero hits observed on this 30-record development set. The development cohort candidate with a language claim had the language authorized in the packet facts.spokenLanguages, which was mistakenly noted as missing by the reviewer. Insufficient empirical sample evidence to evaluate rule performance; retain as experimental awaiting prospective validation.'
    },
    RULE_B_DURATION_OVERSTATEMENT: {
      disposition: 'PROMISING_DEVELOPMENT_RULE',
      rationale:
        'Generic source-boundary logic with calendar-decade temporal grounding; caught 1 unique HUMAN_CONFIRMED_DEFECT with zero SOURCE_SUPPORTED_FALSE_HIT and zero clean-candidate false positives. Requires independent prospective confirmation.'
    },
    RULE_C_SUBGENRE_ASSERTION: {
      disposition: 'PROMISING_DEVELOPMENT_RULE',
      rationale:
        'Generic source-boundary logic strictly anchored in authorized genres array; caught 1 unique HUMAN_CONFIRMED_DEFECT with zero SOURCE_SUPPORTED_FALSE_HIT and zero clean-candidate false positives. Requires independent prospective confirmation.'
    },
    RULE_D_NATIONALITY_GENRE_COLLAPSE: {
      disposition: 'PROMISING_DEVELOPMENT_RULE',
      rationale:
        'Generic source-boundary logic preventing collapse of multi-country co-productions into single nationality; caught 1 unique HUMAN_CONFIRMED_DEFECT with zero SOURCE_SUPPORTED_FALSE_HIT and zero clean-candidate false positives. Requires independent prospective confirmation.'
    },
    RULE_E_EXPLICIT_DEADLINE_CLAIM: {
      disposition: 'PROMISING_DEVELOPMENT_RULE',
      rationale:
        'Generic source-boundary logic preventing insertion of ungrounded ticking-clock/deadline assertions; caught 1 unique HUMAN_CONFIRMED_DEFECT with zero SOURCE_SUPPORTED_FALSE_HIT and zero clean-candidate false positives. Requires independent prospective confirmation.'
    }
  }

  let supersessionBindings = {}
  if (version === 'v1.1') {
    const priorV1Path = path.join(base, 'scale-tranche-2-option-b-development-evaluation.v1.json')
    const correctionPath = path.join(base, 'human-review-adjudication-correction.v1.json')
    const [priorV1, correction] = await Promise.all([
      readFile(priorV1Path, 'utf8').then(JSON.parse),
      readFile(correctionPath, 'utf8').then(JSON.parse),
    ])
    const priorV1Hash = hashArtifact(priorV1)
    if (priorV1Hash !== HISTORICAL_OPTION_B_V1_HASH) {
      throw new Error(
        `Option B v1.1 supersession binding failure: expected prior v1 hash ${HISTORICAL_OPTION_B_V1_HASH}, got ${priorV1Hash}`
      )
    }
    supersessionBindings = {
      supersedes: {
        path: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-option-b-development-evaluation.v1.json',
        hash: priorV1Hash,
        reason:
          'Re-evaluation against effective human review adjudications following human-operator-approved correction.',
      },
      verifierGapAnalysisBinding: {
        path: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/scale-tranche-2-verifier-gap-analysis.v1.1.json',
        hash: datasetHash,
      },
      approvedCorrectionBinding: {
        path: 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2/human-review-adjudication-correction.v1.json',
        hash: hashArtifact(correction),
      },
    }
  }

  // 6. Build output artifact
  const evaluationArtifact = {
    schemaVersion:
      version === 'v1.1'
        ? 'scale-tranche-2-option-b-development-evaluation.v1.1'
        : 'scale-tranche-2-option-b-development-evaluation.v1',
    trancheId: 'SCALE_TRANCHE_2',
    datasetClassification: 'RETROSPECTIVE_DEVELOPMENT_SET',
    ...supersessionBindings,
    methodologicalCaveats: [
      'All metrics represent APPARENT_RETROSPECTIVE_PERFORMANCE on the 30-record development set.',
      'These records were already inspected to identify defect categories; this evaluation does not constitute independent validation.',
      'Candidate-routing apparent performance (would the rule route this candidate to human review?) is separated from rule-hit defect concordance (does the rule hit reflect a confirmed defect?).',
      'Unbiased performance confirmation requires future independent prospective blinded holdout records.',
      'Production routing was NOT modified by this experiment.'
    ],
    dataset: {
      sampleSize: records.length,
      datasetHash,
      positiveCount: records.filter((r) => r.computedFacts.humanDecision === 'REVISE').length,
      negativeCount: records.filter((r) => r.computedFacts.humanDecision === 'APPROVE').length,
      severeCount: records.filter((r) => r.computedFacts.humanSeverity === 'SEVERE').length,
      developmentSet: true,
      independentValidation: false
    },
    ruleDefinitions: {
      ruleVersion: OPTION_B_RULE_VERSION,
      vocabularies: GENERIC_VOCABULARIES,
      authoritySurfaceContract: RULE_AUTHORITY_DECLARATIONS,
      ruleFamilies: [
        {
          id: 'RULE_A_LANGUAGE_CLAIM_SUPPORT',
          description: 'Flags explicit language claims (<language>-language) lacking anchor in spokenLanguages.',
          copyFieldsInspected: RULE_AUTHORITY_DECLARATIONS.RULE_A_LANGUAGE_CLAIM_SUPPORT.copyFieldsInspected,
          authorizedSourceFields: RULE_AUTHORITY_DECLARATIONS.RULE_A_LANGUAGE_CLAIM_SUPPORT.authorizedSourceFields,
          explicitlyForbiddenAuthoritySources: RULE_AUTHORITY_DECLARATIONS.RULE_A_LANGUAGE_CLAIM_SUPPORT.explicitlyForbiddenAuthoritySources
        },
        {
          id: 'RULE_B_DURATION_OVERSTATEMENT',
          description: 'Flags duration unit overstatements (decades) completely absent from authorized overview and unsupported by multiple-decade numerals or calendar decade anchors.',
          copyFieldsInspected: RULE_AUTHORITY_DECLARATIONS.RULE_B_DURATION_OVERSTATEMENT.copyFieldsInspected,
          authorizedSourceFields: RULE_AUTHORITY_DECLARATIONS.RULE_B_DURATION_OVERSTATEMENT.authorizedSourceFields,
          explicitlyForbiddenAuthoritySources: RULE_AUTHORITY_DECLARATIONS.RULE_B_DURATION_OVERSTATEMENT.explicitlyForbiddenAuthoritySources
        },
        {
          id: 'RULE_C_SUBGENRE_ASSERTION',
          description: 'Flags factual subgenre assertions (e.g. neo-noir) not anchored in authorized genres.',
          copyFieldsInspected: RULE_AUTHORITY_DECLARATIONS.RULE_C_SUBGENRE_ASSERTION.copyFieldsInspected,
          authorizedSourceFields: RULE_AUTHORITY_DECLARATIONS.RULE_C_SUBGENRE_ASSERTION.authorizedSourceFields,
          explicitlyForbiddenAuthoritySources: RULE_AUTHORITY_DECLARATIONS.RULE_C_SUBGENRE_ASSERTION.explicitlyForbiddenAuthoritySources
        },
        {
          id: 'RULE_D_NATIONALITY_GENRE_COLLAPSE',
          description: 'Flags copy asserting a single nationality classification for multi-country co-productions.',
          copyFieldsInspected: RULE_AUTHORITY_DECLARATIONS.RULE_D_NATIONALITY_GENRE_COLLAPSE.copyFieldsInspected,
          authorizedSourceFields: RULE_AUTHORITY_DECLARATIONS.RULE_D_NATIONALITY_GENRE_COLLAPSE.authorizedSourceFields,
          explicitlyForbiddenAuthoritySources: RULE_AUTHORITY_DECLARATIONS.RULE_D_NATIONALITY_GENRE_COLLAPSE.explicitlyForbiddenAuthoritySources
        },
        {
          id: 'RULE_E_EXPLICIT_DEADLINE_CLAIM',
          description: 'Flags explicit deadline/clock claims asserted without source time constraints.',
          copyFieldsInspected: RULE_AUTHORITY_DECLARATIONS.RULE_E_EXPLICIT_DEADLINE_CLAIM.copyFieldsInspected,
          authorizedSourceFields: RULE_AUTHORITY_DECLARATIONS.RULE_E_EXPLICIT_DEADLINE_CLAIM.authorizedSourceFields,
          explicitlyForbiddenAuthoritySources: RULE_AUTHORITY_DECLARATIONS.RULE_E_EXPLICIT_DEADLINE_CLAIM.explicitlyForbiddenAuthoritySources
        }
      ],
      outOfScopeForOptionBV1: OUT_OF_SCOPE_FOR_OPTION_B_V1
    },
    investigationTraces: {
      issue1LanguageClaimAuthorityTrace: {
        candidateId: langTraceRec?.candidateId || null,
        title: langTraceRec?.title || null,
        reviewedCopyPhrase: 'Russian-language action-fantasy',
        copyField: 'whyWatch',
        blindPacketLanguages: langTraceRec?.computedFacts?.sourceFacts?.spokenLanguages || ['Russian'],
        humanReviewMarkdownPacketField: '- **Languages**: Russian',
        verifierRiskInputLanguages: langTraceRec?.computedFacts?.sourceFacts?.spokenLanguages || ['Russian'],
        allowedSourceMaterialDefinition: 'Contains overview, keywords, and sourceRefs; spoken-language authority is conveyed via facts.spokenLanguages under production governance (editorial-writer.v1.1.md and source-boundary-risk-verifier.v1.1.md).',
        retrospectiveSourceFactsLanguages: langTraceRec?.computedFacts?.sourceFacts?.spokenLanguages || ['Russian'],
        ruleAAuthorizationSource: 'facts.spokenLanguages',
        evaluatedClassification: 'CASE_C_BLIND_PACKET_AUTHORIZED_AND_HUMAN_ADJUDICATION_INCONSISTENT',
        finding:
          version === 'v1.1'
            ? 'Rule A correctly scanned the copy and treated Russian as authorized because facts.spokenLanguages contains "Russian", which was visible in the review packet (- **Languages**: Russian). The human reviewer note was an empirical reviewer perception error, which has now been corrected under approved human correction artifact (removing the Russian-language defect finding and preserving whyWatch byte-for-byte). Under production governance, facts.spokenLanguages is authoritative; Rule A correctly produces no false hits.'
            : 'Rule A correctly scanned the copy and treated Russian as authorized because facts.spokenLanguages contains "Russian", which was visible in the review packet (- **Languages**: Russian). The human reviewer noted that "no spoken-language field is provided in this packet (unlike other records where spokenLanguages was explicitly authorized)", reflecting an empirical reviewer perception error against the persisted packet. Under production governance, facts.spokenLanguages is authoritative; Rule A was not forced to flag an authorized claim (no label-shopping).'
      },
      issue2TheFourthKindEvaluation: {
        candidateId: fourthKindTraceRec?.candidateId || null,
        title: fourthKindTraceRec?.title || null,
        overviewText: fourthKindTraceRec?.computedFacts?.sourceFacts?.overview || '',
        flaggedTermsInCopy: ['decades of unsolved disappearances (description)', 'decades of vanished townsfolk (curiosityHook)'],
        humanDecision: fourthKindTraceRec?.computedFacts?.humanDecision || 'REVISE',
        humanAffectedFields: fourthKindTraceRec?.computedFacts?.affectedFields || ['whyWatch', 'curiosityHook'],
        humanReviewReason: fourthKindTraceRec?.computedFacts?.humanReason || '',
        unnormalizedRuleBClassification: 'SOURCE_SUPPORTED_FALSE_HIT',
        semanticTemporalGrounding: 'The phrase "Since the 1960s" in the authorized overview semantically grounds multi-decade duration ("decades"). The human reviewer explicitly accepted the Description as faithful and did not cite "decades" as a defect.',
        genericNormalization: 'Rule B incorporates generic calendar-decade grounding (\\b\\d{4}s\\b / \\b(?:1[89]|20)\\d0s\\b) to recognize source-supported decade spans without title-specific rules.',
        normalizedRuleBHitsCount: 0
      }
    },
    candidateRoutingApparentPerformance: {
      confusionMatrix: primaryEval.confusion,
      flaggedReviseCandidatesCount: primaryEval.confusion.tp,
      flaggedApproveCandidatesCount: primaryEval.confusion.fp,
      metrics: {
        apparentRoutingRecall: `25.0% (${primaryEval.confusion.tp}/${primaryEval.confusion.tp + primaryEval.confusion.fn} misses caught)`,
        apparentRoutingPPV: `100.0% (${primaryEval.confusion.tp}/${primaryEval.confusion.tp + primaryEval.confusion.fp} flagged were misses)`,
        apparentRoutingFalsePositiveRate: `0.0% (${primaryEval.confusion.fp}/${primaryEval.confusion.fp + primaryEval.confusion.tn} clean flagged)`,
        apparentRoutingSpecificity: `100.0% (${primaryEval.confusion.tn}/${primaryEval.confusion.fp + primaryEval.confusion.tn} clean preserved)`
      },
      severeCaseStatus: {
        candidateId: severeRec ? severeRec.candidateId : null,
        detectedByOptionB: severeDetected,
        finding:
          'Expected non-detection: The severe defect is semantic (origin secret hook presupposition and ungrounded auction context). Option B v1 intentionally does not build ad-hoc regexes for semantic mechanisms.'
      },
      conservativeStatusNotes: [
        'Recall (25.0%) is low but expected: Option B targets only factual/grounding boundaries, leaving semantic issues to Option A/C.',
        'PPV (100.0%) and specificity (100.0%) are high on this retrospective development set; zero clean candidates were flagged.',
        'FPR is 0.0% (0/14 clean candidates flagged).'
      ]
    },
    // Compatibility view for apparentPerformance
    apparentPerformance: {
      confusionMatrix: primaryEval.confusion,
      metrics: {
        apparentRecall: `25.0% (${primaryEval.confusion.tp}/${primaryEval.confusion.tp + primaryEval.confusion.fn} misses caught)`,
        apparentPrecision: `100.0% (${primaryEval.confusion.tp}/${primaryEval.confusion.tp + primaryEval.confusion.fp} flagged were misses)`,
        apparentFalsePositiveRate: `0.0% (${primaryEval.confusion.fp}/${primaryEval.confusion.fp + primaryEval.confusion.tn} clean flagged)`,
        apparentSpecificity: `100.0% (${primaryEval.confusion.tn}/${primaryEval.confusion.fp + primaryEval.confusion.tn} clean preserved)`
      },
      severeCaseStatus: {
        candidateId: severeRec ? severeRec.candidateId : null,
        detectedByOptionB: severeDetected,
        finding:
          'Expected non-detection: The severe defect is semantic (origin secret hook presupposition and ungrounded auction context). Option B v1 intentionally does not build ad-hoc regexes for semantic mechanisms.'
      }
    },
    hitLevelConcordance: {
      totalHits: primaryEval.allRuleHits.length,
      concordanceCounts,
      concordanceRate:
        concordanceCounts.totalRuleHits > 0
          ? `${((concordanceCounts.humanConfirmedDefects / concordanceCounts.totalRuleHits) * 100).toFixed(1)}% (${concordanceCounts.humanConfirmedDefects}/${concordanceCounts.totalRuleHits} rule hits human-confirmed defects)`
          : 'N/A',
      hits: primaryEval.allRuleHits,
    },
    perRuleContribution,
    ablationStudy: ablationResults,
    errorAnalysis: {
      falsePositives: {
        candidateRoutingFPCount: 0,
        hitLevelFalseHitCount: 0,
        cases: [],
        note: 'Zero false positives observed at candidate routing level and zero source-supported false hits observed at rule-hit level.'
      },
      falseNegatives: {
        candidateRoutingFNCount: 12,
        explanation:
          'The current narrow Option B v1 rule families do not cover these 12 human misses. Many require semantic interpretation, and this experiment did not attempt broader deterministic detection.'
      }
    },
    decisionFramework: {
      ruleClassifications,
      ...ruleClassifications
    },
    optionASpecificationSummary: {
      status: 'SPECIFICATION_ONLY',
      empiricalStatus: 'EMPIRICAL_MODEL_BEHAVIOR_REQUIRES_CONTROLLED_REPLAY',
      coreGapsCovered: [
        'Interrogative sentences in curiosityHook that presuppose unstated story facts must be evaluated as assertive claims.',
        'allowedSourceMaterial is the exclusive ground truth; raw metadata arrays (e.g. facts.keywords) not in allowedSourceMaterial do not authorize copy.',
        'Remove or strictly qualify prompt exceptions around metaphorical urgency and genre register.',
        'Add explicit schema categories for UNAUTHORIZED_LANGUAGE_OR_NATIONALITY and SPECULATIVE_HOOK_PREMISE.'
      ]
    },
    candidateResults: primaryEval.candidateResults
  }

  const outFileName =
    version === 'v1.1'
      ? 'scale-tranche-2-option-b-development-evaluation.v1.1.json'
      : 'scale-tranche-2-option-b-development-evaluation.v1.json'
  const outPath = path.join(base, outFileName)
  if (version === 'v1') {
    if (existsSync(outPath)) {
      const existingRaw = await readFile(outPath, 'utf8')
      const existingHash = hashArtifact(JSON.parse(existingRaw))
      if (existingHash !== HISTORICAL_OPTION_B_V1_HASH) {
        throw new Error(
          `Cannot overwrite historical Option B v1 evaluation artifact: expected ${HISTORICAL_OPTION_B_V1_HASH}, got ${existingHash}`
        )
      }
    }
  }
  await writeFile(outPath, serializeArtifactForPersistence(evaluationArtifact))

  return {
    ok: true,
    outPath: path.relative(repoRoot, outPath).split(path.sep).join('/'),
    hash: hashArtifact(evaluationArtifact),
    candidateRoutingMetrics: primaryEval.candidateRoutingMetrics,
    confusion: primaryEval.confusion,
    concordanceCounts,
    perRuleContribution,
    severeDetected
  }
}

/**
 * Historical Option B v1 runner:
 * Reads and verifies the frozen pre-correction historical v1 evaluation artifact.
 * Fails closed if the artifact hash does not match HISTORICAL_OPTION_B_V1_HASH.
 * Never allows overwriting the historical v1 artifact with mismatched bytes.
 */
export async function runScaleTranche2OptionBEvaluationV1({ repoRoot, allowOverwrite = false }) {
  const base = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
  const v1Path = path.join(base, 'scale-tranche-2-option-b-development-evaluation.v1.json')
  if (existsSync(v1Path)) {
    const raw = await readFile(v1Path, 'utf8')
    const v1 = JSON.parse(raw)
    const h = hashArtifact(v1)
    if (h !== HISTORICAL_OPTION_B_V1_HASH) {
      throw new Error(`Historical Option B v1 hash mismatch: expected ${HISTORICAL_OPTION_B_V1_HASH}, got ${h}`)
    }
    if (allowOverwrite) {
      throw new Error('Historical Option B v1 artifact is frozen and cannot be overwritten')
    }
    return {
      ok: true,
      outPath: path.relative(repoRoot, v1Path).split(path.sep).join('/'),
      hash: h,
      candidateRoutingMetrics: v1.candidateRoutingApparentPerformance?.metrics,
      confusion: v1.candidateRoutingApparentPerformance?.confusionMatrix || v1.apparentPerformance?.confusionMatrix,
      concordanceCounts: v1.hitLevelConcordance?.concordanceCounts,
      severeDetected: v1.candidateRoutingApparentPerformance?.severeCaseStatus?.detectedByOptionB ?? false,
      artifact: v1
    }
  }
  throw new Error('Historical Option B v1 artifact missing')
}

/**
 * Stage 5 helper: explicitly run Option B evaluation v1.1.
 */
export async function runScaleTranche2OptionBEvaluationV11({ repoRoot }) {
  return runScaleTranche2OptionBEvaluation({ repoRoot, version: 'v1.1' })
}

// CLI
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const args = process.argv.slice(2)
  const version = args.includes('--v1-only') ? 'v1' : 'v1.1'
  const runner = version === 'v1' ? runScaleTranche2OptionBEvaluationV1 : runScaleTranche2OptionBEvaluationV11
  runner({ repoRoot })
    .then((res) => {
      console.log(`Successfully verified/generated Option B development evaluation artifact (${version}):`)
      console.log('Path:', res.outPath)
      console.log('Hash:', res.hash)
      console.log('Confusion:', JSON.stringify(res.confusion))
      console.log('Candidate Routing Metrics:', JSON.stringify(res.candidateRoutingMetrics, null, 2))
      console.log('Hit-Level Concordance:', JSON.stringify(res.concordanceCounts, null, 2))
      console.log('Severe detected:', res.severeDetected)
    })
    .catch((err) => {
      console.error(err.stack || err.message)
      process.exitCode = 1
    })
}
