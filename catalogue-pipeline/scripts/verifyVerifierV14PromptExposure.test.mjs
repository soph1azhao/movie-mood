import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import {
  verifyPromptExposure,
  normalizeWords,
  extractFourGrams,
} from './verifyVerifierV14PromptExposure.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const promptPath = path.join(repoRoot, 'catalogue-pipeline/candidates/source-boundary-risk-verifier.v1.4.md')
const taxonomyPath = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.3-retrospective-replay/semantic-false-negative-taxonomy.v1.json')
const exposurePolicyPath = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development/development-exposure-policy.v1.json')

test('1. verifyPromptExposure on frozen v1.4 candidate prompt passes cleanly', () => {
  const report = verifyPromptExposure({
    promptPath,
    taxonomyPath,
    exposurePolicyPath,
  })

  assert.equal(report.verdict, 'PROMPT_EXPOSURE_LINT_PASS')
  assert.equal(report.blockingMatchCount, 0)
  assert.equal(report.blockingMatches.length, 0)
  assert.equal(report.reviewRequiredMatchCount, 0)
  assert.equal(report.reviewRequiredMatches.length, 0)
  assert.ok(report.prompt.sha256.startsWith('sha256:'))
  assert.ok(report.taxonomy.sha256.startsWith('sha256:'))
  assert.ok(report.exposurePolicy.sha256.startsWith('sha256:'))
})

test('2. Detecting injected candidate ID triggers BLOCKING_MATCH and fails verdict', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
  const testPromptPath = path.join(tmpDir, 'test-prompt.md')
  const basePrompt = fs.readFileSync(promptPath, 'utf8')

  fs.writeFileSync(testPromptPath, basePrompt + '\nCandidate ID reference: scale500-tmdb-2604\n', 'utf8')

  const report = verifyPromptExposure({
    promptPath: testPromptPath,
    taxonomyPath,
    exposurePolicyPath,
  })

  assert.equal(report.verdict, 'PROMPT_EXPOSURE_LINT_FAIL_BLOCKING_MATCHES')
  assert.ok(report.blockingMatchCount >= 1)
  const match = report.blockingMatches.find((m) => m.type === 'EXPOSED_CANDIDATE_ID')
  assert.ok(match)
  assert.equal(match.matchedText, 'scale500-tmdb-2604')

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('3. Detecting injected exposed movie title triggers BLOCKING_MATCH', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
  const testPromptPath = path.join(tmpDir, 'test-prompt.md')
  const basePrompt = fs.readFileSync(promptPath, 'utf8')

  fs.writeFileSync(testPromptPath, basePrompt + '\nExample from Born on the Fourth of July.\n', 'utf8')

  const report = verifyPromptExposure({
    promptPath: testPromptPath,
    taxonomyPath,
    exposurePolicyPath,
  })

  assert.equal(report.verdict, 'PROMPT_EXPOSURE_LINT_FAIL_BLOCKING_MATCHES')
  const match = report.blockingMatches.find((m) => m.type === 'EXPOSED_MOVIE_TITLE')
  assert.ok(match)
  assert.equal(match.matchedText, 'Born on the Fourth of July')

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('4. Detecting injected character proper noun triggers BLOCKING_MATCH', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
  const testPromptPath = path.join(tmpDir, 'test-prompt.md')
  const basePrompt = fs.readFileSync(promptPath, 'utf8')

  fs.writeFileSync(testPromptPath, basePrompt + '\nNotice how Ron Kovic was injured.\n', 'utf8')

  const report = verifyPromptExposure({
    promptPath: testPromptPath,
    taxonomyPath,
    exposurePolicyPath,
  })

  assert.equal(report.verdict, 'PROMPT_EXPOSURE_LINT_FAIL_BLOCKING_MATCHES')
  const match = report.blockingMatches.find((m) => m.type === 'EXPOSED_CHARACTER_PROPER_NOUN')
  assert.ok(match)
  assert.equal(match.matchedText, 'Ron Kovic')

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('5. Detecting injected distinctive false-negative phrase triggers BLOCKING_MATCH', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
  const testPromptPath = path.join(tmpDir, 'test-prompt.md')
  const basePrompt = fs.readFileSync(promptPath, 'utf8')

  fs.writeFileSync(testPromptPath, basePrompt + '\nEnsure characters do not act without unraveling their own path.\n', 'utf8')

  const report = verifyPromptExposure({
    promptPath: testPromptPath,
    taxonomyPath,
    exposurePolicyPath,
  })

  assert.equal(report.verdict, 'PROMPT_EXPOSURE_LINT_FAIL_BLOCKING_MATCHES')
  const match = report.blockingMatches.find((m) => m.type === 'CURATED_DISTINCTIVE_PHRASE')
  assert.ok(match)
  assert.equal(match.matchedText, 'without unraveling their own path')

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('6. Injected generic 4-gram with no resolution -> FAIL_UNRESOLVED_REVIEWS', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
  const testPromptPath = path.join(tmpDir, 'test-prompt.md')
  const basePrompt = fs.readFileSync(promptPath, 'utf8')

  // Inject a 4-gram from Invisible Sister overview: "school science project goes"
  fs.writeFileSync(testPromptPath, basePrompt + '\nWhenever a school science project goes beyond limits...\n', 'utf8')

  const report = verifyPromptExposure({
    promptPath: testPromptPath,
    taxonomyPath,
    exposurePolicyPath,
  })

  assert.equal(report.blockingMatchCount, 0)
  assert.equal(report.reviewRequiredMatchCount, 1)
  assert.equal(report.verdict, 'PROMPT_EXPOSURE_LINT_FAIL_UNRESOLVED_REVIEWS')
  const match = report.reviewRequiredMatches[0]
  assert.equal(match.matchedText, 'school science project goes')
  assert.equal(match.resolution, null)

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('7. Same generic 4-gram with explicit valid manual resolution -> PASS', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
  const testPromptPath = path.join(tmpDir, 'test-prompt.md')
  const basePrompt = fs.readFileSync(promptPath, 'utf8')

  fs.writeFileSync(testPromptPath, basePrompt + '\nWhenever a school science project goes beyond limits...\n', 'utf8')

  const report = verifyPromptExposure({
    promptPath: testPromptPath,
    taxonomyPath,
    exposurePolicyPath,
    customResolutions: {
      'school science project goes': {
        status: 'RESOLVED_AFTER_MANUAL_REVIEW',
        rationale: 'Audited manual inspection: generic syntactic overlap in test scenario, no candidate leakage.',
      },
    },
  })

  assert.equal(report.blockingMatchCount, 0)
  assert.equal(report.reviewRequiredMatchCount, 1)
  assert.equal(report.verdict, 'PROMPT_EXPOSURE_LINT_PASS')
  const match = report.reviewRequiredMatches[0]
  assert.ok(match.resolution)
  assert.equal(match.resolution.status, 'RESOLVED_AFTER_MANUAL_REVIEW')
  assert.ok(match.resolution.rationale.length > 0)

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('8. Malformed or empty resolution fails resolution requirement', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
  const testPromptPath = path.join(tmpDir, 'test-prompt.md')
  const basePrompt = fs.readFileSync(promptPath, 'utf8')

  fs.writeFileSync(testPromptPath, basePrompt + '\nWhenever a school science project goes beyond limits...\n', 'utf8')

  // Case A: empty rationale
  const reportEmptyRationale = verifyPromptExposure({
    promptPath: testPromptPath,
    taxonomyPath,
    exposurePolicyPath,
    customResolutions: {
      'school science project goes': {
        status: 'RESOLVED_AFTER_MANUAL_REVIEW',
        rationale: '   ',
      },
    },
  })
  assert.equal(reportEmptyRationale.verdict, 'PROMPT_EXPOSURE_LINT_FAIL_UNRESOLVED_REVIEWS')
  assert.equal(reportEmptyRationale.reviewRequiredMatches[0].resolution, null)

  // Case B: invalid status string
  const reportInvalidStatus = verifyPromptExposure({
    promptPath: testPromptPath,
    taxonomyPath,
    exposurePolicyPath,
    customResolutions: {
      'school science project goes': {
        status: 'SOME_ARBITRARY_RESOLVED_STRING',
        rationale: 'Valid rationale text',
      },
    },
  })
  assert.equal(reportInvalidStatus.verdict, 'PROMPT_EXPOSURE_LINT_FAIL_UNRESOLVED_REVIEWS')
  assert.equal(reportInvalidStatus.reviewRequiredMatches[0].resolution, null)

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('9. Blocking matches remain blocking regardless of review resolutions', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-test-'))
  const testPromptPath = path.join(tmpDir, 'test-prompt.md')
  const basePrompt = fs.readFileSync(promptPath, 'utf8')

  fs.writeFileSync(
    testPromptPath,
    basePrompt + '\nscale500-tmdb-2604\nWhenever a school science project goes beyond limits...\n',
    'utf8'
  )

  const report = verifyPromptExposure({
    promptPath: testPromptPath,
    taxonomyPath,
    exposurePolicyPath,
    customResolutions: {
      'school science project goes': {
        status: 'RESOLVED_AFTER_MANUAL_REVIEW',
        rationale: 'Explicit valid manual resolution',
      },
    },
  })

  // Blocking match must prevail and keep verdict in FAIL_BLOCKING_MATCHES
  assert.equal(report.verdict, 'PROMPT_EXPOSURE_LINT_FAIL_BLOCKING_MATCHES')
  assert.equal(report.blockingMatchCount, 1)
  assert.equal(report.reviewRequiredMatchCount, 1)
  assert.ok(report.reviewRequiredMatches[0].resolution)

  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test('10. extractFourGrams filters out pure stop-word sequences', () => {
  const grams = extractFourGrams('of the in the and of a for')
  assert.equal(grams.length, 0)

  const realGrams = extractFourGrams('Oliver Stone directs a weighty biographical drama')
  assert.ok(realGrams.length > 0)
  assert.ok(realGrams.some((g) => g.phrase === 'oliver stone directs a'))
})
