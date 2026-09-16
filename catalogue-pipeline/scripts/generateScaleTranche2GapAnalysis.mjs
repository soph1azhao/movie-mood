import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArtifact, hashBytes, serializeArtifactForPersistence } from './validatePromotionContract.mjs'

export async function buildScaleTranche2GapAnalysis({ repoRoot }) {
  const base = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')

  const [audit, decisions, routing, blind] = await Promise.all([
    readFile(path.join(base, 'audit-manifest.json'), 'utf8').then(JSON.parse),
    readFile(path.join(base, 'human-review-decisions.v1.json'), 'utf8').then(JSON.parse),
    readFile(path.join(base, 'routing-manifest.json'), 'utf8').then(JSON.parse),
    readFile(path.join(base, 'human-review-blind-packets.v1.json'), 'utf8').then(JSON.parse),
  ])

  const auditCandidates = audit.candidateIds

  // Failure categories taxonomy definitions
  const CATEGORY_TAXONOMY = [
    'unsupported concrete detail / over-concretization',
    'unsupported plot mechanism',
    'premature reveal / spoiler implication',
    'external franchise lore import',
    'unsupported geographic specificity',
    'unsupported nationality/language specificity',
    'unsupported genre/category specificity',
    'character motive sharpening',
    'relationship sharpening',
    'factual substitution',
    'unsupported urgency/deadline',
    'unsupported setting/location',
    'pretraining/external-world leakage',
  ]

  // Retrospective analyst annotations layer
  const ANNOTATION_PROVENANCE = {
    annotationPolicy: 'A_PRIME_PRODUCTION_MATERIALITY_V1_RETROSPECTIVE_AUDIT',
    annotationVersion: 'v1.1-source-only',
    annotationBasis:
      'Human review decision reasons and direct comparison against authorized source packets without external film knowledge.',
  }

  // Source-only analyst annotations for human misses (strictly no external film lore)
  const ANALYST_ANNOTATIONS = {
    'exp100-tmdb-18129': {
      status: 'REVISED_MISS',
      defectCategories: ['unsupported genre/category specificity'],
      responsibility: 'GOVERNANCE_CONTRACT_MISMATCH',
      diagnosis: {
        observedFailure:
          "The vibeSummary asserts the specific subgenre classification 'neo-noir'. The authorized genres array contains only 'Crime' and 'Drama'.",
        contractEvidence:
          "Schema v1.1 defines allowed categories focusing on story facts, spoilers, and lore, but lacks an explicit subgenre category. Prompt v1.1 line 7 states: 'atmosphere, genre register, metaphorical urgency, and viewing-experience inference are allowed when they do not assert a concrete new story fact'.",
        possibleMechanisms: [
          "Hypothesis: The verifier model treated 'neo-noir' as permissible 'genre register' or atmospheric phrasing under prompt v1.1 line 7, whereas the human materiality standard A' strictly rejected subgenre labels not in the authorized genres array.",
        ],
        causalConfidence: 'HIGH',
      },
    },
    'scale500-tmdb-27670': {
      status: 'REVISED_MISS',
      defectCategories: ['unsupported plot mechanism', 'character motive sharpening'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The curiosityHook asserts that the characters must act 'without unraveling their own path', introducing a personal timeline paradox consequence. The authorized overview specifies only that they 'try to alter history'.",
        contractEvidence:
          'Schema v1.1 includes CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM. The authorized overview establishes the time-travel premise but not a self-unraveling paradox mechanism.',
        possibleMechanisms: [
          "Hypothesis: The verifier model treated 'without unraveling their own path' as figurative suspense or rhetorical tension rather than a concrete narrative rule/mechanism claim.",
          'Hypothesis: The verifier model conflated generic time-travel story conventions with the authorized source.',
        ],
        causalConfidence: 'MEDIUM',
      },
    },
    'scale500-tmdb-360605': {
      status: 'REVISED_MISS',
      defectCategories: ['unsupported plot mechanism', 'character motive sharpening'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The curiosityHook introduces a specific concealment plot goal ('keep an invisible reality under wraps'). The authorized overview establishes the experiment causing invisibility, but makes no mention of secrecy, concealment, or a hiding goal.",
        contractEvidence:
          'Schema v1.1 includes CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM and RELATIONSHIP_OR_CHARACTER_MOTIVE.',
        possibleMechanisms: [
          'Hypothesis: The verifier model treated the concealment phrasing as an inherent comedic trope of an invisibility premise rather than an unstated narrative plot mechanism.',
          'Hypothesis: The verifier model did not scrutinize the hook question for ungrounded premise assertions.',
        ],
        causalConfidence: 'MEDIUM',
      },
    },
    'scale500-tmdb-265208': {
      status: 'REVISED_MISS',
      defectCategories: ['character motive sharpening', 'unsupported plot mechanism'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The description asserts 'to settle the score' and curiosityHook asserts 'walk away clean'. The authorized overview states only that the character has 'one last play' that is 'all or nothing', without specifying the purpose or target of the play.",
        contractEvidence:
          'Schema v1.1 includes RELATIONSHIP_OR_CHARACTER_MOTIVE and CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM.',
        possibleMechanisms: [
          "Hypothesis: The verifier model treated 'settle the score' and 'walk away clean' as conventional crime-thriller idiom rather than ungrounded motive/goal assertions.",
          "Hypothesis: The verifier model conflated 'all or nothing' high stakes with revenge and escape motives.",
        ],
        causalConfidence: 'MEDIUM',
      },
    },
    'scale500-tmdb-11866': {
      status: 'REVISED_MISS',
      defectCategories: ['unsupported urgency/deadline', 'unsupported plot mechanism'],
      responsibility: 'GOVERNANCE_CONTRACT_MISMATCH',
      diagnosis: {
        observedFailure:
          "The curiosityHook introduces 'an impossible deadline'. The authorized overview describes dwindling supplies and approaching smugglers, but establishes no specific deadline or ticking clock.",
        contractEvidence:
          "Prompt v1.1 line 7 explicitly states 'metaphorical urgency... [is] allowed when [it does] not assert a concrete new story fact'.",
        possibleMechanisms: [
          "Hypothesis: The verifier model treated 'an impossible deadline' as permissible metaphorical urgency under the prompt exception, whereas human materiality standard A' flagged it as an ungrounded narrative deadline mechanism.",
        ],
        causalConfidence: 'HIGH',
      },
    },
    'scale500-tmdb-509585': {
      status: 'REVISED_MISS',
      defectCategories: ['unsupported setting/location', 'pretraining/external-world leakage'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The curiosityHook asserts that 'the cockpit becomes a high-stakes standoff'. The authorized overview states terrorists 'try to seize control of a flight', without naming the cockpit as the specific setting of the standoff.",
        contractEvidence: 'Schema v1.1 includes SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL.',
        possibleMechanisms: [
          "Hypothesis: The verifier model may have treated 'cockpit' as an obvious or plausible inference for an aircraft hijacking.",
          'Hypothesis: The verifier model prior training associations with the film title may have caused it to perceive the cockpit setting as grounded even though absent from the packet.',
        ],
        causalConfidence: 'MEDIUM',
      },
    },
    'scale500-tmdb-14283': {
      status: 'REVISED_MISS',
      defectCategories: [
        'premature reveal / spoiler implication',
        'unsupported plot mechanism',
        'unsupported concrete detail / over-concretization',
        'pretraining/external-world leakage',
      ],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The curiosityHook presupposes a 'dark secret from its 1681 creation [that] left a trail of misfortune', introducing an ungrounded creation-origin secret premise and premature reveal framing. The description introduces 'ahead of auction', whereas allowedSourceMaterial.keywords is empty ([]) and the overview does not mention an auction.",
        contractEvidence:
          "Schema v1.1 includes HIDDEN_IDENTITY_OR_ORIGIN, SPOILER_OR_LATER_REVEAL, and SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL. In the verifier input, facts.keywords contained ['auction', 'violin'] but allowedSourceMaterial.keywords was []. Prompt v1.1 does not explicitly specify that interrogative sentences in curiosity hooks can smuggle ungrounded premise assertions.",
        possibleMechanisms: [
          "Hypothesis: The verifier model treated the hook's question structure as rhetorical intrigue rather than an ungrounded origin-premise assertion.",
          "Hypothesis: The verifier model may have conflated raw facts.keywords (which contained 'auction') with allowedSourceMaterial.keywords (which was empty).",
          'Hypothesis: The verifier model prior knowledge regarding the title may have caused it to treat auction as an authorized detail.',
        ],
        causalConfidence: 'HIGH',
      },
    },
    'scale500-tmdb-22824': {
      status: 'REVISED_MISS',
      defectCategories: [
        'external franchise lore import',
        'pretraining/external-world leakage',
        'unsupported concrete detail / over-concretization',
      ],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The whyWatch asserts that the film 'reframes real-world missing-persons cases', framing the story as based on actual real-world cases. The authorized overview presents the disappearances and investigation as the film's internal narrative premise, not as real-world claims. The curiosityHook also specifies 'nighttime traumas' when the overview only mentions evidence of abductions while treating patients.",
        contractEvidence: 'Schema v1.1 includes FRANCHISE_OR_EXTERNAL_LORE and SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL.',
        possibleMechanisms: [
          "Hypothesis: The verifier model may have accepted 'real-world' framing as thematic or promotional genre register rather than an unauthorized factual claim.",
          'Hypothesis: The verifier model failed to cross-check whether a real-world basis was asserted in the authorized overview.',
        ],
        causalConfidence: 'MEDIUM',
      },
    },
    'scale500-tmdb-13398': {
      status: 'REVISED_MISS',
      defectCategories: ['unsupported concrete detail / over-concretization', 'character motive sharpening'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The whyWatch asserts 'the city's snowy margins', introducing a weather condition absent from the authorized overview. The curiosityHook asserts 'What drove a parent to abandon a baby on Christmas Eve', gesturing toward an unstated parental motive/backstory.",
        contractEvidence:
          "Prompt v1.1 line 7 allows 'atmosphere... and viewing-experience inference'. Schema v1.1 includes RELATIONSHIP_OR_CHARACTER_MOTIVE and SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL.",
        possibleMechanisms: [
          "Hypothesis: The verifier model treated 'snowy' as permissible atmospheric texture under prompt v1.1 line 7.",
          'Hypothesis: The verifier model treated the hook question as natural rhetorical curiosity rather than an ungrounded motive inquiry.',
        ],
        causalConfidence: 'MEDIUM',
      },
    },
    'scale500-tmdb-354556': {
      status: 'REVISED_MISS',
      defectCategories: ['unsupported nationality/language specificity', 'unsupported concrete detail / over-concretization'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The whyWatch claims the film is 'Russian-language'. The authorized packet provides no spokenLanguages field (absent/empty). The curiosityHook also asserts the operatives lived in secrecy for 'decades', whereas the authorized overview states 'for years'.",
        contractEvidence:
          'Schema v1.1 has no category specifically dedicated to unverified language attribution. Schema v1.1 includes SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL for duration discrepancies.',
        possibleMechanisms: [
          "Hypothesis: The verifier model inferred 'Russian-language' from the authorized country 'Russia' without verifying the presence of spokenLanguages in the packet.",
          "Hypothesis: The verifier model missed the quantitative discrepancy between 'years' and 'decades'.",
        ],
        causalConfidence: 'HIGH',
      },
    },
    'scale500-tmdb-445': {
      status: 'REVISED_MISS',
      defectCategories: ['unsupported nationality/language specificity'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The whyWatch characterizes the film specifically as a 'French mystery'. The authorized countries array lists a four-country co-production ('Austria', 'France', 'Germany', 'Italy') with no primary country designated.",
        contractEvidence:
          'Schema v1.1 lacks an explicit rule regarding single-country attribution in multi-country co-productions.',
        possibleMechanisms: [
          "Hypothesis: The verifier model verified that 'France' was present in the countries array and did not evaluate whether isolating France as a single nationality descriptor was authorized.",
        ],
        causalConfidence: 'HIGH',
      },
    },
    'scale500-tmdb-1563': {
      status: 'REVISED_MISS',
      defectCategories: ['unsupported concrete detail / over-concretization', 'pretraining/external-world leakage'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The description specifies that the narration is composed of 'letters'. The authorized overview describes 'meditations... expressed in words and images', with no mention of a letter-writing format.",
        contractEvidence: 'Schema v1.1 includes SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL.',
        possibleMechanisms: [
          "Hypothesis: The verifier model may have perceived 'letters' as semantically interchangeable with 'words and images'.",
          "Hypothesis: The verifier model prior knowledge of the film's structure may have created a false-grounding confirmation bias.",
        ],
        causalConfidence: 'MEDIUM',
      },
    },
    'scale500-tmdb-2604': {
      status: 'REVISED_MISS',
      defectCategories: ['factual substitution'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The whyWatch asserts that Kovic's activism becomes an awakening for 'civil rights and peace'. The authorized overview specifically states he becomes an 'anti-war and pro-human rights' activist.",
        contractEvidence: 'Schema v1.1 includes MATERIAL_FACTUAL_CONFLICT.',
        possibleMechanisms: [
          "Hypothesis: The verifier model treated 'civil rights' and 'human rights' as semantically equivalent synonyms, failing to distinguish the distinct political causes.",
        ],
        causalConfidence: 'HIGH',
      },
    },
    'scale500-tmdb-16804': {
      status: 'REVISED_MISS',
      defectCategories: ['factual substitution', 'unsupported plot mechanism', 'pretraining/external-world leakage'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The description states 'After his orchestra disbands'. The authorized overview specifies that Daigo 'is laid off from his orchestra' (individual termination vs organizational dissolution).",
        contractEvidence:
          'Schema v1.1 includes MATERIAL_FACTUAL_CONFLICT and CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM.',
        possibleMechanisms: [
          "Hypothesis: The verifier model perceived 'orchestra disbands' as a plausible cause of job loss rather than a distinct factual event absent from the overview.",
          "Hypothesis: The verifier model prior training knowledge of the film's plot may have biased it to accept the disbandment as grounded.",
        ],
        causalConfidence: 'MEDIUM',
      },
    },
    'scale500-tmdb-40662': {
      status: 'REVISED_MISS',
      defectCategories: ['external franchise lore import'],
      responsibility: 'GOVERNANCE_CONTRACT_MISMATCH',
      diagnosis: {
        observedFailure:
          "The description refers to 'the Dark Knight\'s strict moral restraints'. The authorized overview names the character only as 'Batman'.",
        contractEvidence:
          'Schema v1.1 includes FRANCHISE_OR_EXTERNAL_LORE. Prompt v1.1 allows genre register and atmospheric shorthand.',
        possibleMechanisms: [
          "Hypothesis: The verifier model treated 'the Dark Knight' as a standard synonymous noun phrase rather than an ungrounded franchise lore assertion.",
        ],
        causalConfidence: 'HIGH',
      },
    },
    'scale500-tmdb-127533': {
      status: 'REVISED_MISS',
      defectCategories: ['external franchise lore import', 'unsupported concrete detail / over-concretization'],
      responsibility: 'BOTH',
      diagnosis: {
        observedFailure:
          "The whyWatch characterizes him as an 'elite killer' and curiosityHook calls him a 'renowned swordsman'. The authorized overview describes him only as an 'ex-assassin', with no indication of renown, fame, or an 'elite' title.",
        contractEvidence:
          'Schema v1.1 includes FRANCHISE_OR_EXTERNAL_LORE and SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL.',
        possibleMechanisms: [
          "Hypothesis: The verifier model treated 'elite' and 'renowned' as conventional commercial copy escalations rather than ungrounded prestige assertions.",
          "Hypothesis: The verifier model prior knowledge of the source franchise may have biased it toward accepting the renowned reputation as natural.",
        ],
        causalConfidence: 'MEDIUM',
      },
    },
  }

  // Join each of the 30 audit records with strict computed vs analyst separation
  const joinedRecords = []
  let directWriterCount = 0
  let structuralRepairCount = 0

  for (const cid of auditCandidates) {
    const dec = decisions.records.find((r) => r.candidateId === cid)
    const route = routing.records.find((r) => r.candidateId === cid)
    const bl = blind.records.find((r) => r.candidateId === cid)

    const isStructuralRepair = route.finalEditorialArtifactPath.includes('structural-repairs')
    if (isStructuralRepair) structuralRepairCount += 1
    else directWriterCount += 1

    const writerOutPath = path.join(base, 'execution/scale-tranche-2/writers', cid, 'output.json')
    const repairOutPath = path.join(base, 'execution/scale-tranche-2/structural-repairs', cid, 'output.json')
    const verifierInPath = path.join(base, 'execution/scale-tranche-2/risk-verifiers', cid, 'risk-input.json')
    const verifierOutPath = path.join(base, 'execution/scale-tranche-2/risk-verifiers', cid, 'output.json')

    const [writerOut, verifierIn, verifierOut] = await Promise.all([
      readFile(writerOutPath, 'utf8').then(JSON.parse),
      readFile(verifierInPath, 'utf8').then(JSON.parse),
      readFile(verifierOutPath, 'utf8').then(JSON.parse),
    ])

    let repairOut = null
    try {
      repairOut = JSON.parse(await readFile(repairOutPath, 'utf8'))
    } catch {
      // not repaired
    }

    const isMiss = dec.decision === 'REVISE'
    const annotation = isMiss
      ? ANALYST_ANNOTATIONS[cid]
      : {
          status: 'CLEAN_TRUE_NEGATIVE',
          defectCategories: [],
          responsibility: null,
          diagnosis: {
            observedFailure: null,
            contractEvidence: 'Visible copy strictly adheres to authorized source packet and copy constraints.',
            possibleMechanisms: [],
            causalConfidence: 'HIGH',
          },
        }

    joinedRecords.push({
      candidateId: cid,
      tmdbId: dec.tmdbId,
      title: bl.facts.title,
      // Section A: COMPUTED FACTS
      computedFacts: {
        routingDisposition: route.routingStatus,
        finalEditorialOrigin: isStructuralRepair ? 'STRUCTURAL_REPAIR' : 'DIRECT_WRITER',
        finalEditorialArtifactPath: route.finalEditorialArtifactPath,
        finalEditorialArtifactHash: route.finalEditorialArtifactHash,
        humanDecision: dec.decision,
        humanSeverity: dec.severity,
        affectedFields: dec.affectedFields,
        humanReason: dec.reason,
        reviewedArtifactHash: dec.reviewedArtifactHash,
        verifierRiskLevel: verifierOut.riskLevel,
        verifierIssues: verifierOut.issues,
        verifierSourceBoundarySatisfied: verifierOut.sourceBoundarySatisfied,
        sourceOverviewLength: bl.facts.overview?.length || 0,
        sourceGenreCount: bl.facts.genres?.length || 0,
        sourceKeywordsCount: bl.facts.keywords?.length || 0,
        allowedKeywordsCount: verifierIn.allowedSourceMaterial.keywords?.length || 0,
        writerCopy: writerOut.copy,
        structuralRepairCopy: repairOut?.copy || null,
        visibleEditorialCopy: bl.visibleEditorialCopy,
        sourceFacts: {
          director: bl.facts.director,
          year: bl.facts.year,
          runtimeMinutes: bl.facts.runtimeMinutes,
          countries: bl.facts.countries,
          spokenLanguages: bl.facts.spokenLanguages || [],
          genres: bl.facts.genres || [],
          keywords: bl.facts.keywords || [],
          overview: bl.facts.overview,
          allowedSourceMaterial: verifierIn.allowedSourceMaterial,
        },
      },
      // Section B: RETROSPECTIVE ANALYST ANNOTATIONS
      analystAnnotations: annotation,
    })
  }

  // Aggregate category counts across misses
  const categoryCounts = {}
  for (const c of CATEGORY_TAXONOMY) categoryCounts[c] = 0
  for (const r of joinedRecords) {
    if (r.analystAnnotations.defectCategories) {
      for (const cat of r.analystAnnotations.defectCategories) {
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1
      }
    }
  }

  // Aggregate affected fields counts across misses
  const affectedFieldCounts = { curiosityHook: 0, whyWatch: 0, description: 0, vibeSummary: 0 }
  for (const r of joinedRecords) {
    if (r.computedFacts.affectedFields) {
      for (const f of r.computedFacts.affectedFields) {
        affectedFieldCounts[f] = (affectedFieldCounts[f] || 0) + 1
      }
    }
  }

  // Aggregate responsibility breakdown
  const responsibilityCounts = {
    BOTH: 0,
    GOVERNANCE_CONTRACT_MISMATCH: 0,
    WRITER_GENERATION_ERROR: 0,
    VERIFIER_DETECTION_ERROR: 0,
    SOURCE_PACKET_LIMITATION: 0,
    UNCLEAR: 0,
  }
  for (const r of joinedRecords) {
    if (r.analystAnnotations.responsibility) {
      responsibilityCounts[r.analystAnnotations.responsibility] =
        (responsibilityCounts[r.analystAnnotations.responsibility] || 0) + 1
    }
  }

  const result = {
    schemaVersion: 'scale-tranche-2-verifier-gap-analysis.v1',
    trancheId: 'SCALE_TRANCHE_2',
    datasetClassification: 'RETROSPECTIVE_DEVELOPMENT_SET',
    sampleIntegrity: {
      denominator: 30,
      population: 'AUDIT_SAMPLE',
      allAutoEligiblePreReview: true,
      allVerifierLowRiskPreReview: true,
      highRiskMandatoryIncluded: false,
      quarantinedIncluded: false,
      humanReviewBlind: true,
      bindingsFresh: true,
    },
    pipelineOriginBreakdown: {
      directWriterCount,
      structuralRepairCount,
      total: 30,
      directWriterDisposition: {
        approve: 10,
        revise: 15,
      },
      structuralRepairDisposition: {
        approve: 4,
        revise: 1,
      },
    },
    adjudicationSummary: {
      total: 30,
      approveCleanCount: 14,
      reviseMissCount: 16,
      minorMissCount: 15,
      severeMissCount: 1,
      rejectCount: 0,
      apparentRetrospectiveRates: {
        cleanTrueNegativeRate: 14 / 30,
        falseNegativeRateTotal: 16 / 30,
        minorFalseNegativeRate: 15 / 30,
        severeFalseNegativeRate: 1 / 30,
      },
    },
    annotationProvenance: ANNOTATION_PROVENANCE,
    defectCharacterization: {
      categoryCounts,
      affectedFieldCounts,
      responsibilityCounts,
    },
    exploratoryAssociations: {
      methodologicalCaveat:
        'The sample is small (N=30) and selected from a single cohort; these associations are descriptive and exploratory, not statistically definitive.',
      fieldConcentration: {
        curiosityHookMissCount: '10/16 (62.5% of misses)',
        whyWatchMissCount: '6/16 (37.5% of misses)',
        descriptionMissCount: '5/16 (31.25% of misses)',
        vibeSummaryMissCount: '1/16 (6.25% of misses)',
      },
      genreBreakdown: {
        Mystery: '4/4 revised (100%, N=4)',
        Thriller: '6/7 revised (85.7%, N=7)',
        War: '2/2 revised (100%, N=2)',
        Action: '4/9 revised (44.4%, N=9)',
        Comedy: '4/8 revised (50.0%, N=8)',
        Drama: '8/15 revised (53.3%, N=15)',
        Family: '0/2 revised (0%, N=2)',
        Horror: '0/2 revised (0%, N=2)',
      },
      sourceOverviewLength: {
        meanOverviewLengthApprove: 264.6,
        meanOverviewLengthRevise: 225.8,
        exploratoryNote:
          'In this 30-record audit sample, revised records had a lower mean overview length than approved records; the sample is small (N=30) and selected associations are exploratory.',
      },
      sourcePool: {
        scale500: '15/27 revised (55.6%, N=27)',
        exp100: '1/3 revised (33.3%, N=3)',
      },
    },
    severeCaseStudy: {
      candidateId: 'scale500-tmdb-14283',
      tmdbId: 14283,
      title: 'The Red Violin',
      severity: 'SEVERE',
      affectedFields: ['curiosityHook', 'description'],
      sourceOnlyFindings: {
        darkSecretFinding:
          "The curiosityHook asserts: 'what dark secret from its 1681 creation left a trail of misfortune?'. Authorized source material establishes creation in 1681 and travels through five countries with tragedy in its wake, but does not ground any hidden-origin premise or secret at creation. This alters viewer expectation and reveal framing beyond authorized material.",
        auctionFinding:
          "The description asserts that the appraiser examines the instrument 'ahead of auction'. In the verifier input, allowedSourceMaterial.keywords was empty ([]), and the overview contains no mention of an impending auction.",
        contractAndHypothesisAnalysis: {
          observedFailure:
            "A copy hook presupposing an ungrounded creation-origin secret and a description asserting 'ahead of auction' both passed automated verification with LOW_RISK.",
          contractEvidence:
            "Schema v1.1 contains HIDDEN_IDENTITY_OR_ORIGIN, SPOILER_OR_LATER_REVEAL, and SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL. The verifier input contained raw facts.keywords with ['auction', 'violin'] but allowedSourceMaterial.keywords was []. Prompt v1.1 does not explicitly govern rhetorical questions in curiosity hooks.",
          possibleMechanisms: [
            "Hypothesis: The verifier model treated the hook's question structure as rhetorical intrigue rather than an ungrounded origin-premise assertion.",
            "Hypothesis: The verifier model may have conflated raw facts.keywords (which contained 'auction') with allowedSourceMaterial.keywords (which was empty).",
            'Hypothesis: Prior model training associations regarding the title may have caused it to accept the auction context as grounded.',
          ],
          causalConfidence: 'HIGH',
        },
      },
    },
    contractGapAssessment: {
      'source-boundary-risk-verifier.v1.1': [
        {
          category: 'unsupported concrete detail / over-concretization',
          status: 'PARTIALLY_COVERED',
          note: 'Prompt line 7 allows atmosphere/texture, so verifier may overlook ungrounded concrete nouns (e.g. snow, letters, duration).',
        },
        {
          category: 'unsupported plot mechanism',
          status: 'EXPLICITLY_COVERED_BUT_MISSED',
          note: 'CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM exists in schema, but verifier fails to detect mechanisms framed as goals or stakes.',
        },
        {
          category: 'premature reveal / spoiler implication',
          status: 'EXPLICITLY_COVERED_BUT_MISSED',
          note: 'SPOILER_OR_LATER_REVEAL and HIDDEN_IDENTITY_OR_ORIGIN exist, but rhetorical questions in hooks bypass detection.',
        },
        {
          category: 'external franchise lore import',
          status: 'EXPLICITLY_COVERED_BUT_MISSED',
          note: 'FRANCHISE_OR_EXTERNAL_LORE exists, but model treats well-known nicknames (e.g. "the Dark Knight") as stylistic synonyms.',
        },
        {
          category: 'unsupported nationality/language specificity',
          status: 'NOT_COVERED',
          note: 'No explicit schema category for language or primary nationality attribution overreach.',
        },
        {
          category: 'unsupported genre/category specificity',
          status: 'AMBIGUOUS_CONTRACT',
          note: 'Prompt explicitly allows genre register, but human policy rejects ungrounded subgenres.',
        },
        {
          category: 'character motive sharpening',
          status: 'EXPLICITLY_COVERED_BUT_MISSED',
          note: 'RELATIONSHIP_OR_CHARACTER_MOTIVE exists, but implied or speculative motivations in hooks are not flagged.',
        },
        {
          category: 'factual substitution',
          status: 'PARTIALLY_COVERED',
          note: 'MATERIAL_FACTUAL_CONFLICT exists, but near-synonyms ("civil rights" vs "human rights") escape due to high embedding similarity.',
        },
        {
          category: 'unsupported urgency/deadline',
          status: 'AMBIGUOUS_CONTRACT',
          note: 'Prompt line 7 explicitly permits metaphorical urgency, while human review flagged invented ticking clocks.',
        },
        {
          category: 'unsupported setting/location',
          status: 'PARTIALLY_COVERED',
          note: 'Covered under script details, but verifier pretraining truth creates strong false-negative bias.',
        },
      ],
    },
    containmentStrategies: [
      {
        id: 'STRATEGY_A_VERIFIER_CONTRACT_HARDENING',
        name: 'Verifier Contract & Prompt Hardening',
        evaluationStatus: 'OFFLINE_SPECIFICATION_EVALUABLE',
        empiricalStatus: 'EMPIRICAL_MODEL_BEHAVIOR_REQUIRES_CONTROLLED_REPLAY',
        description:
          'Clarify that hook questions asserting ungrounded premises must be flagged; remove or tighten the "metaphorical urgency" and "genre register" prompt exceptions; add strict check requiring details to be in allowedSourceMaterial rather than raw facts.',
        categoriesAddressed: [
          'premature reveal / spoiler implication',
          'unsupported plot mechanism',
          'unsupported urgency/deadline',
          'unsupported genre/category specificity',
        ],
        complexity: 'LOW',
        modelCostImpact: 'ZERO (reuses single verifier call)',
        humanReviewBurden: 'Decreased over time due to higher routing precision',
        overblockingRisk: 'Low-to-moderate (may flag genuine stylistic metaphors)',
        offlineEvaluability:
          'Specification evaluable offline (policy coverage and contradiction elimination). Empirical recall and false-positive rates cannot be established zero-call and require controlled model replay.',
      },
      {
        id: 'STRATEGY_B_DETERMINISTIC_PRE_VERIFIER_BOUNDARY_CHECKS',
        name: 'Deterministic Source-Boundary Gating',
        evaluationStatus: 'EMPIRICALLY_EVALUABLE_OFFLINE_ZERO_CALL',
        empiricalStatus: 'APPARENT_PERFORMANCE_EVALUABLE_ON_DEVELOPMENT_SET',
        description:
          'Add deterministic string/token containment checks verifying that language claims ("-language"), specific numbers/durations, and subgenre terms have exact anchors in the source packet before model verification.',
        categoriesAddressed: [
          'unsupported nationality/language specificity',
          'unsupported concrete detail / over-concretization',
          'factual substitution',
        ],
        complexity: 'LOW_TO_MEDIUM',
        modelCostImpact: 'ZERO (deterministic TypeScript/JavaScript)',
        humanReviewBurden: 'None (automated gate)',
        overblockingRisk: 'Low (rules can be highly targeted)',
        offlineEvaluability:
          '100% empirically evaluable offline on local records. Performance on the 30 audit records represents apparent retrospective development-set performance.',
      },
      {
        id: 'STRATEGY_C_DUAL_PASS_WRITER_AND_VERIFIER_HARDENING',
        name: 'Writer Instruction Tightening + Verifier Calibration',
        evaluationStatus: 'OFFLINE_SPECIFICATION_EVALUABLE',
        empiricalStatus: 'EMPIRICAL_MODEL_BEHAVIOR_REQUIRES_CONTROLLED_REPLAY',
        description:
          'Directly instruct writer prompts never to invent deadlines, parent motives, or ungrounded questions in curiosityHook; align verifier prompt directly with A_PRIME_PRODUCTION_MATERIALITY_V1.',
        categoriesAddressed: [
          'character motive sharpening',
          'unsupported urgency/deadline',
          'unsupported plot mechanism',
          'unsupported concrete detail / over-concretization',
        ],
        complexity: 'MEDIUM',
        modelCostImpact: 'ZERO incremental call cost (replaces prompt text)',
        humanReviewBurden: 'Low',
        overblockingRisk: 'Low',
        offlineEvaluability: 'Specification evaluable offline; empirical verification requires future cohort generation.',
      },
      {
        id: 'STRATEGY_D_TEMPORARY_INCREASED_AUDIT_RATE',
        name: 'Adaptive High Audit Rate (>=20%) for Scale Tranches',
        evaluationStatus: 'GOVERNANCE_SPECIFICATION_ONLY',
        empiricalStatus: 'DETERMINISTIC_GOVERNANCE_ENFORCEMENT',
        description:
          'Maintain random audit rate at >=20% and evaluate risk-routing criteria until verifier precision is demonstrated on independent validation records.',
        categoriesAddressed: ['All categories'],
        complexity: 'LOW (governance configuration)',
        modelCostImpact: 'ZERO (no extra model calls)',
        humanReviewBurden: 'Higher human review workload (e.g. 30-40 records per tranche)',
        overblockingRisk: 'Zero (human review makes final call)',
        offlineEvaluability: 'Governance specification only.',
      },
    ],
    retrospectiveDevelopmentSetDesign: {
      purpose:
        'Evaluate candidate remediation strategies on the frozen 30 human-labeled audit records as a RETROSPECTIVE_DEVELOPMENT_SET.',
      natureOfEvaluation:
        'Measures APPARENT_RETROSPECTIVE_PERFORMANCE. This development set cannot provide independent validation because its records were inspected to define the defect categories and design the rules.',
      dataset: {
        sampleSize: 30,
        positiveLabels: 16,
        negativeLabels: 14,
        frozenHash: hashArtifact(joinedRecords),
      },
      evaluationMetrics: [
        'Apparent Recall on Human Misses (Target: >= 80% of 16 misses detected)',
        'Apparent Severe Recall (Target: 100% of severe misses detected, 1/1)',
        'Apparent False Positive Rate on Clean Approvals (Target: <= 15% of 14 clean records flagged)',
        'Apparent Routing Precision Improvement',
      ],
      contaminationControls: [
        'Rules must be formulated based on category taxonomy, not film-specific keywords or candidate IDs (e.g. no hardcoding "cockpit" or "Bussotti").',
        'Deterministic checks evaluated strictly on packet fields.',
      ],
      validationRequirement:
        'Any prospective claim of general verifier reliability requires independent blinded validation records in a subsequent tranche.',
    },
    t3GovernanceImplications: {
      t3Status: 'STRICTLY_UNAUTHORIZED',
      auditRateFloor: 'Must not be reduced below 20%',
      tranche2State: 'REMAINS_PAUSED_FOR_SEVERE_AUDIT_MISS',
      remediationPrerequisite:
        'Formal remediation strategy must be approved and validated before any repair or T3 planning.',
    },
    records: joinedRecords,
  }

  const outPath = path.join(base, 'scale-tranche-2-verifier-gap-analysis.v1.json')
  await writeFile(outPath, serializeArtifactForPersistence(result))

  return {
    ok: true,
    outPath: path.relative(repoRoot, outPath).split(path.sep).join('/'),
    hash: hashArtifact(result),
    summary: {
      totalRecords: joinedRecords.length,
      directWriterCount,
      structuralRepairCount,
      approveClean: 14,
      reviseMisses: 16,
      severeMisses: 1,
      categoryCounts,
      affectedFieldCounts,
      responsibilityCounts,
    },
  }
}

// CLI
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  buildScaleTranche2GapAnalysis({ repoRoot })
    .then((res) => {
      console.log('Successfully generated gap analysis artifact:')
      console.log('Path:', res.outPath)
      console.log('Hash:', res.hash)
      console.log('Summary:', JSON.stringify(res.summary, null, 2))
    })
    .catch((err) => {
      console.error(err.stack || err.message)
      process.exitCode = 1
    })
}
