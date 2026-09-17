import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const TRIVIAL_STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'of', 'to', 'for', 'is', 'are', 'was',
  'were', 'and', 'or', 'it', 'that', 'this', 'with', 'by', 'as', 'from', 'be',
  'not', 'all', 'its', 'into', 'their', 'can', 'do', 'how', 'what', 'where',
  'when', 'will', 'then', 'than', 'so', 'if', 'up', 'out', 'no', 'only',
])

export const CURATED_CHARACTER_PROPER_NOUNS = [
  'Ron Kovic',
  'Kovic',
  'Cleo',
  'Molly',
  'Daigo',
  'Red Hood',
  'Batman',
  'Patrick Vollrath',
  'Sarik Andreasyan',
  'Brandon Vietti',
  'Yojiro Takita',
  'Roberto Benigni',
  'Massimo Troisi',
  'Oliver Stone',
  'Paul Hoen',
]

export const CURATED_DISTINCTIVE_PHRASES = [
  'civil rights and peace',
  'keep an invisible reality under wraps',
  'cockpit becomes a high-stakes standoff',
  'living in complete secrecy for decades',
  'the Dark Knight',
  'orchestra disbands',
  'without unraveling their own path',
]

export function normalizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function isAllStopWords(fourGramTokens) {
  return fourGramTokens.every((token) => TRIVIAL_STOP_WORDS.has(token))
}

export function extractFourGrams(text) {
  const words = normalizeWords(text)
  const grams = []
  for (let i = 0; i <= words.length - 4; i++) {
    const gramTokens = words.slice(i, i + 4)
    if (!isAllStopWords(gramTokens)) {
      grams.push({
        phrase: gramTokens.join(' '),
        tokens: gramTokens,
      })
    }
  }
  return grams
}

export function sha256File(filePath) {
  const buf = fs.readFileSync(filePath)
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

export function verifyPromptExposure({
  promptPath,
  taxonomyPath,
  exposurePolicyPath,
  customResolutions = {},
}) {
  const promptRaw = fs.readFileSync(promptPath, 'utf8')
  const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'))
  const promptSha = sha256File(promptPath)
  const taxonomySha = sha256File(taxonomyPath)
  const exposurePolicySha = sha256File(exposurePolicyPath)

  const promptLower = promptRaw.toLowerCase()
  const blockingMatches = []
  const reviewRequiredMatches = []

  // 1. Candidate IDs Check
  const candidateIds = taxonomy.cases.map((c) => c.candidateId)
  for (const id of candidateIds) {
    if (promptLower.includes(id.toLowerCase())) {
      blockingMatches.push({
        type: 'EXPOSED_CANDIDATE_ID',
        matchClass: 'BLOCKING_MATCH',
        matchedText: id,
        explanation: `Prompt directly contains exposed candidate ID: ${id}`,
      })
    }
  }

  // 2. Movie Titles Check
  const titles = taxonomy.cases.map((c) => c.title)
  for (const title of titles) {
    if (promptLower.includes(title.toLowerCase())) {
      blockingMatches.push({
        type: 'EXPOSED_MOVIE_TITLE',
        matchClass: 'BLOCKING_MATCH',
        matchedText: title,
        explanation: `Prompt directly contains exposed movie title: "${title}"`,
      })
    }
  }

  // 3. Character Proper Nouns Check
  for (const noun of CURATED_CHARACTER_PROPER_NOUNS) {
    // Word-boundary check to prevent matching subwords
    const regex = new RegExp(`\\b${noun.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i')
    if (regex.test(promptRaw)) {
      blockingMatches.push({
        type: 'EXPOSED_CHARACTER_PROPER_NOUN',
        matchClass: 'BLOCKING_MATCH',
        matchedText: noun,
        explanation: `Prompt contains exposed character/proper noun: "${noun}"`,
      })
    }
  }

  // 4. Curated Distinctive Phrases Check
  for (const phrase of CURATED_DISTINCTIVE_PHRASES) {
    if (promptLower.includes(phrase.toLowerCase())) {
      blockingMatches.push({
        type: 'CURATED_DISTINCTIVE_PHRASE',
        matchClass: 'BLOCKING_MATCH',
        matchedText: phrase,
        explanation: `Prompt contains curated distinctive false-negative phrase: "${phrase}"`,
      })
    }
  }

  // 5. Normalized 4-Gram Overlap Check
  const promptGrams = extractFourGrams(promptRaw)
  const promptGramMap = new Map()
  for (const g of promptGrams) {
    promptGramMap.set(g.phrase, g)
  }

  const seenGramMatches = new Set()
  for (const c of taxonomy.cases) {
    const candidateTexts = [
      c.evidenceReconstruction?.sourceOverview || '',
      ...Object.values(c.evidenceReconstruction?.visibleEditorialCopy || {}),
      c.observedDefectPattern?.ungroundedElement || '',
    ]

    for (const text of candidateTexts) {
      const caseGrams = extractFourGrams(text)
      for (const cg of caseGrams) {
        if (promptGramMap.has(cg.phrase) && !seenGramMatches.has(cg.phrase)) {
          seenGramMatches.add(cg.phrase)

          // Check if this 4-gram is an exact distinctive phrase (blocking) or generic overlap (review required)
          const isDistinctive = CURATED_DISTINCTIVE_PHRASES.some((dp) =>
            dp.toLowerCase().includes(cg.phrase)
          )

          if (isDistinctive) {
            blockingMatches.push({
              type: 'DISTINCTIVE_4GRAM_OVERLAP',
              matchClass: 'BLOCKING_MATCH',
              candidateId: c.candidateId,
              matchedText: cg.phrase,
              explanation: `Contiguous 4-gram matches distinctive defect phrase from ${c.candidateId}: "${cg.phrase}"`,
            })
          } else {
            const supplied = customResolutions[cg.phrase]
            let resolution = null
            if (
              supplied &&
              supplied.status === 'RESOLVED_AFTER_MANUAL_REVIEW' &&
              typeof supplied.rationale === 'string' &&
              supplied.rationale.trim().length > 0
            ) {
              resolution = {
                status: 'RESOLVED_AFTER_MANUAL_REVIEW',
                rationale: supplied.rationale.trim(),
              }
            }
            reviewRequiredMatches.push({
              type: 'GENERIC_4GRAM_OVERLAP',
              matchClass: 'REVIEW_REQUIRED_MATCH',
              candidateId: c.candidateId,
              matchedText: cg.phrase,
              explanation: `Normalized 4-gram overlap with candidate ${c.candidateId}: "${cg.phrase}"`,
              resolution,
            })
          }
        }
      }
    }
  }

  const blockingMatchCount = blockingMatches.length
  const reviewRequiredMatchCount = reviewRequiredMatches.length
  const allReviewRequiredResolved =
    reviewRequiredMatchCount === 0 ||
    reviewRequiredMatches.every(
      (m) =>
        m.resolution !== null &&
        m.resolution.status === 'RESOLVED_AFTER_MANUAL_REVIEW' &&
        typeof m.resolution.rationale === 'string' &&
        m.resolution.rationale.trim().length > 0
    )

  let verdict = 'PROMPT_EXPOSURE_LINT_PASS'
  if (blockingMatchCount > 0) {
    verdict = 'PROMPT_EXPOSURE_LINT_FAIL_BLOCKING_MATCHES'
  } else if (!allReviewRequiredResolved) {
    verdict = 'PROMPT_EXPOSURE_LINT_FAIL_UNRESOLVED_REVIEWS'
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    activity: 'VERIFIER_V1_4_PROMPT_EXPOSURE_LINT',
    verdict,
    blockingMatchCount,
    reviewRequiredMatchCount,
    prompt: {
      path: promptPath,
      sha256: promptSha,
    },
    taxonomy: {
      path: taxonomyPath,
      sha256: taxonomySha,
    },
    exposurePolicy: {
      path: exposurePolicyPath,
      sha256: exposurePolicySha,
    },
    checksPerformed: [
      'exposedCandidateIdsAbsent',
      'exposedMovieTitlesAbsent',
      'exposedCharacterProperNounsAbsent',
      'curatedDistinctivePhrasesAbsent',
      'normalizedContiguousFourGramsAudited',
    ],
    blockingMatches,
    reviewRequiredMatches,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const promptPath = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md')
  const taxonomyPath = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/semantic-false-negative-taxonomy.v1.json')
  const exposurePolicyPath = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/development-exposure-policy.v1.json')

  const relPromptPath = path.relative(repoRoot, promptPath)
  const relTaxonomyPath = path.relative(repoRoot, taxonomyPath)
  const relExposurePolicyPath = path.relative(repoRoot, exposurePolicyPath)

  const report = verifyPromptExposure({
    promptPath,
    taxonomyPath,
    exposurePolicyPath,
  })

  // Store repo-relative paths for canonical persistence
  report.prompt.path = relPromptPath
  report.taxonomy.path = relTaxonomyPath
  report.exposurePolicy.path = relExposurePolicyPath

  console.log('Lint Verdict:', report.verdict)
  console.log('Blocking Matches:', report.blockingMatchCount)
  console.log('Review-Required Matches:', report.reviewRequiredMatchCount)

  const outPath = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/prompt-exposure-lint.v1.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log('Report saved to:', outPath)
}
