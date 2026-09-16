import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArtifact } from './validatePromotionContract.mjs'

export const VERIFIER_V12_SPEC_LINEAGE = Object.freeze({
  gapAnalysisV11Hash: 'sha256:70a0adb731f9a3bdb00be18e6fde58590c9922312f342ef926488b39819bf0ae',
  optionBV11Hash: 'sha256:04e6c4b6328f1dd24da7bbde3f5127a31812c5894f535a93ba2b0b27a3656b32',
  approvedCorrectionHash: 'sha256:3a3b486dc8d39a3fa49d3aa907b4718674ce1b0d7907e67f47e4f00fe963783e',
  activeVerifierV11PromptHash: 'sha256:361df6c2f5ca6feb3567c092e3f7bc5de7396f48b52e7a6c8afc9dbf00768123',
  activeVerifierV11SchemaHash: 'sha256:9e0647d3753e482ad23780725020f6bebb408486ba663596c0bb0fe562b06120',
  governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS'
})

/**
 * Static mappings connecting the 16 development misses to Option A v1.2 specification coverage.
 * This is static contract coverage, NOT empirical model replay.
 */
export const DEVELOPMENT_MISS_SPEC_MAPPINGS = Object.freeze([
  {
    candidateId: 'scale500-tmdb-2604',
    title: 'Born on the Fourth of July',
    severity: 'MINOR',
    defectCategory: 'factual substitution',
    applicableV11Category: 'MATERIAL_FACTUAL_CONFLICT',
    v11FailureClassification: 'EXPLICIT_BUT_INSUFFICIENT',
    proposedV12ClaimClass: 'STORY_SETUP_FACT',
    proposedV12RiskCategory: 'MATERIAL_FACTUAL_CONFLICT',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-360605',
    title: 'Invisible Sister',
    severity: 'MINOR',
    defectCategory: 'unsupported plot mechanism / motive sharpening',
    applicableV11Category: 'CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM',
    v11FailureClassification: 'AMBIGUOUS',
    proposedV12ClaimClass: 'SPECULATIVE_HOOK_PREMISE',
    proposedV12RiskCategory: 'SPECULATIVE_HOOK_PREMISE',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-509585',
    title: '7500',
    severity: 'MINOR',
    defectCategory: 'unsupported setting/location / external leakage',
    applicableV11Category: 'SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL',
    v11FailureClassification: 'MISSING',
    proposedV12ClaimClass: 'LOCATION_OR_SETTING',
    proposedV12RiskCategory: 'SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-13398',
    title: 'Tokyo Godfathers',
    severity: 'MINOR',
    defectCategory: 'unsupported concrete detail / motive sharpening',
    applicableV11Category: 'CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM',
    v11FailureClassification: 'AMBIGUOUS',
    proposedV12ClaimClass: 'CAUSAL_OR_STORY_MECHANISM',
    proposedV12RiskCategory: 'CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-354556',
    title: 'Guardians',
    severity: 'MINOR',
    defectCategory: 'unsupported duration overstatement ("decades")',
    applicableV11Category: 'MATERIAL_FACTUAL_CONFLICT',
    v11FailureClassification: 'AMBIGUOUS',
    proposedV12ClaimClass: 'TEMPORAL_OR_DURATION_CONSTRAINT',
    proposedV12RiskCategory: 'MATERIAL_FACTUAL_CONFLICT',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'exp100-tmdb-18129',
    title: 'The Grifters',
    severity: 'MINOR',
    defectCategory: 'unsupported genre/category specificity',
    applicableV11Category: 'UNRESOLVED_SOURCE_GROUNDING_CONFLICT',
    v11FailureClassification: 'AMBIGUOUS',
    proposedV12ClaimClass: 'GENRE_OR_SUBGENRE',
    proposedV12RiskCategory: 'UNRESOLVED_SOURCE_GROUNDING_CONFLICT',
    authoritySurface: 'PACKET_FACTS.genres',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-1563',
    title: 'Sans Soleil',
    severity: 'MINOR',
    defectCategory: 'unsupported location / weather detail',
    applicableV11Category: 'SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL',
    v11FailureClassification: 'AMBIGUOUS',
    proposedV12ClaimClass: 'LOCATION_OR_SETTING',
    proposedV12RiskCategory: 'SCENE_OR_SCRIPT_LEVEL_EXTERNAL_DETAIL',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-14283',
    title: 'The Red Violin',
    severity: 'SEVERE',
    defectCategory: 'ungrounded origin secret presupposition & unauthorized story-context event detail ("ahead of auction")',
    applicableV11Category: 'HIDDEN_IDENTITY_OR_ORIGIN',
    v11FailureClassification: 'AMBIGUOUS',
    proposedV12ClaimClass: 'SPECULATIVE_HOOK_PREMISE',
    proposedV12RiskCategory: 'HIDDEN_IDENTITY_OR_ORIGIN',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED',
    severeStatus: 'SPECIFICATION_COVERS_KNOWN_SEVERE_FAILURE'
  },
  {
    candidateId: 'scale500-tmdb-127533',
    title: 'Rurouni Kenshin Part I: Origins',
    severity: 'MINOR',
    defectCategory: 'external franchise lore import',
    applicableV11Category: 'FRANCHISE_OR_EXTERNAL_LORE',
    v11FailureClassification: 'EXPLICIT_BUT_INSUFFICIENT',
    proposedV12ClaimClass: 'FRANCHISE_OR_EXTERNAL_LORE',
    proposedV12RiskCategory: 'FRANCHISE_OR_EXTERNAL_LORE',
    authoritySurface: 'EXTERNAL_KNOWLEDGE_FORBIDDEN',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-445',
    title: 'Caché',
    severity: 'MINOR',
    defectCategory: 'unauthorized nationality collapse',
    applicableV11Category: 'MATERIAL_FACTUAL_CONFLICT',
    v11FailureClassification: 'AMBIGUOUS',
    proposedV12ClaimClass: 'NATIONALITY_OR_PRODUCTION_COUNTRY',
    proposedV12RiskCategory: 'UNAUTHORIZED_SOURCE_BOUNDARY_CLAIM',
    authoritySurface: 'PACKET_FACTS.countries',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-265208',
    title: 'Wild Card',
    severity: 'MINOR',
    defectCategory: 'character motive sharpening / plot mechanism',
    applicableV11Category: 'RELATIONSHIP_OR_CHARACTER_MOTIVE',
    v11FailureClassification: 'AMBIGUOUS',
    proposedV12ClaimClass: 'CHARACTER_MOTIVE_OR_GOAL',
    proposedV12RiskCategory: 'RELATIONSHIP_OR_CHARACTER_MOTIVE',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-22824',
    title: 'The Fourth Kind',
    severity: 'MINOR',
    defectCategory: 'external lore / real-world case import',
    applicableV11Category: 'FRANCHISE_OR_EXTERNAL_LORE',
    v11FailureClassification: 'EXPLICIT_BUT_INSUFFICIENT',
    proposedV12ClaimClass: 'FRANCHISE_OR_EXTERNAL_LORE',
    proposedV12RiskCategory: 'FRANCHISE_OR_EXTERNAL_LORE',
    authoritySurface: 'EXTERNAL_KNOWLEDGE_FORBIDDEN',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-40662',
    title: 'Batman: Under the Red Hood',
    severity: 'MINOR',
    defectCategory: 'external franchise lore import',
    applicableV11Category: 'FRANCHISE_OR_EXTERNAL_LORE',
    v11FailureClassification: 'EXPLICIT_BUT_INSUFFICIENT',
    proposedV12ClaimClass: 'FRANCHISE_OR_EXTERNAL_LORE',
    proposedV12RiskCategory: 'FRANCHISE_OR_EXTERNAL_LORE',
    authoritySurface: 'EXTERNAL_KNOWLEDGE_FORBIDDEN',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-11866',
    title: 'Flight of the Phoenix',
    severity: 'MINOR',
    defectCategory: 'unsupported urgency / deadline',
    applicableV11Category: 'CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM',
    v11FailureClassification: 'AMBIGUOUS',
    proposedV12ClaimClass: 'TEMPORAL_OR_DURATION_CONSTRAINT',
    proposedV12RiskCategory: 'CONCRETE_STORY_OR_SUPERNATURAL_MECHANISM',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-16804',
    title: 'Departures',
    severity: 'MINOR',
    defectCategory: 'factual substitution',
    applicableV11Category: 'MATERIAL_FACTUAL_CONFLICT',
    v11FailureClassification: 'AMBIGUOUS',
    proposedV12ClaimClass: 'STORY_SETUP_FACT',
    proposedV12RiskCategory: 'MATERIAL_FACTUAL_CONFLICT',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED'
  },
  {
    candidateId: 'scale500-tmdb-27670',
    title: 'Nothing Left to Do But Cry',
    severity: 'MINOR',
    defectCategory: 'plot mechanism / character motive sharpening',
    applicableV11Category: 'RELATIONSHIP_OR_CHARACTER_MOTIVE',
    v11FailureClassification: 'EXPLICIT_BUT_INSUFFICIENT',
    proposedV12ClaimClass: 'CHARACTER_MOTIVE_OR_GOAL',
    proposedV12RiskCategory: 'RELATIONSHIP_OR_CHARACTER_MOTIVE',
    authoritySurface: 'SYNOPSIS_AND_ALLOWED_STORY_MATERIAL',
    coverageStatus: 'SPEC_COVERED'
  }
])

/**
 * Runs static contract coverage audit on the 16 retrospective development misses.
 */
export async function auditVerifierV12SpecificationCoverage({ repoRoot }) {
  const base = path.join(repoRoot, 'catalogue-pipeline/generated/catalogue-promotion/v8-2-scale-tranche-2')
  const gapV11Path = path.join(base, 'scale-tranche-2-verifier-gap-analysis.v1.1.json')
  const authorityModelPath = path.join(repoRoot, 'catalogue-pipeline/specs/source-boundary-authority-model.v1.json')
  const schemaSpecPath = path.join(repoRoot, 'catalogue-pipeline/specs/source-boundary-risk-verifier.v1.2.schema-spec.json')

  const [gapV11, authorityModel, schemaSpec] = await Promise.all([
    readFile(gapV11Path, 'utf8').then(JSON.parse),
    readFile(authorityModelPath, 'utf8').then(JSON.parse),
    readFile(schemaSpecPath, 'utf8').then(JSON.parse)
  ])

  const actualMisses = gapV11.records.filter((r) => r.computedFacts.humanDecision === 'REVISE')
  if (actualMisses.length !== 16) {
    throw new Error(`Expected 16 human review misses in gap analysis v1.1, found ${actualMisses.length}`)
  }

  const results = []
  for (const miss of actualMisses) {
    const mapping = DEVELOPMENT_MISS_SPEC_MAPPINGS.find((m) => m.candidateId === miss.candidateId)
    if (!mapping) {
      throw new Error(`Missing static specification mapping for candidate ${miss.candidateId}`)
    }

    // Verify claim class is defined in authority model
    const claimDef = authorityModel.claimClassDefinitions[mapping.proposedV12ClaimClass]
    const hasClaimType = Boolean(claimDef)

    // Verify risk category is in schema spec
    const hasRiskCategory = schemaSpec.properties.riskCategories.items.enum.includes(mapping.proposedV12RiskCategory)

    // Verify authority surface is defined
    const hasAuthoritySurface =
      mapping.authoritySurface === 'EXTERNAL_KNOWLEDGE_FORBIDDEN'
        ? authorityModel.authoritySurfaces.EXTERNAL_KNOWLEDGE !== undefined
        : Boolean(
            authorityModel.authoritySurfaces[mapping.authoritySurface] ||
            authorityModel.authoritySurfaces.PACKET_FACTS.fields[mapping.authoritySurface.replace('PACKET_FACTS.', '')]
          )

    const isFullyCovered = hasClaimType && hasRiskCategory && hasAuthoritySurface
    const coverageStatus = isFullyCovered ? 'SPEC_COVERED' : 'NOT_SPEC_COVERED'

    results.push({
      candidateId: miss.candidateId,
      title: miss.title,
      humanSeverity: miss.computedFacts.humanSeverity,
      defectCategory: mapping.defectCategory,
      v11FailureClassification: mapping.v11FailureClassification,
      proposedV12ClaimClass: mapping.proposedV12ClaimClass,
      proposedV12RiskCategory: mapping.proposedV12RiskCategory,
      hasClaimType,
      hasRiskCategory,
      hasAuthoritySurface,
      coverageStatus,
      severeCoverageStatus: mapping.severeStatus || undefined
    })
  }

  const coveredCount = results.filter((r) => r.coverageStatus === 'SPEC_COVERED').length
  const severeResult = results.find((r) => r.candidateId === 'scale500-tmdb-14283')

  return {
    ok: true,
    coverageClassification: 'DEVELOPMENT_SET_STATIC_SPECIFICATION_COVERAGE',
    totalMisses: actualMisses.length,
    coveredCount,
    allCovered: coveredCount === actualMisses.length,
    severeStatus: severeResult?.severeCoverageStatus || 'UNCOVERED',
    lineageBindings: VERIFIER_V12_SPEC_LINEAGE,
    results
  }
}

// CLI
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  auditVerifierV12SpecificationCoverage({ repoRoot })
    .then((res) => {
      console.log('--- Option A Verifier v1.2 Development-Set Static Specification Coverage Audit ---')
      console.log(`Classification: ${res.coverageClassification}`)
      console.log(`Total Retrospective Development Misses: ${res.totalMisses}`)
      console.log(`Specification-Covered Count: ${res.coveredCount} / ${res.totalMisses}`)
      console.log(`All Covered: ${res.allCovered}`)
      console.log(`Severe Case Coverage Status: ${res.severeStatus}`)
    })
    .catch((err) => {
      console.error(err.stack || err.message)
      process.exitCode = 1
    })
}
