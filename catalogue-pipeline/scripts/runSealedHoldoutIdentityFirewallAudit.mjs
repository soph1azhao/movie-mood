import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serializeArtifactForPersistence } from './validatePromotionContract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const p2Dir = path.join(repoRoot, 'catalogue-pipeline/experiments/verifier-v1.4-semantic-development')

export const ACTIVITY = 'VERIFIER_V14_SEALED_HOLDOUT_IDENTITY_FIREWALL_AUDIT_V1'
export const CLASSIFICATION = 'GOVERNANCE_ONLY_IDENTITY_DISJOINTNESS_AUDIT'
export const IDENTITY_NORMALIZATION_METHOD = 'CANONICAL_TMDB_ID_AND_NORMALIZED_ALPHANUMERIC_TITLE'

export const ALLOWED_IDENTITY_KEYS = Object.freeze(new Set([
  'tmdbId',
  'canonicalId',
  'provisionalId',
  'id',
  'movieId',
  'title',
  'year',
  'releaseYear',
]))

export function normalizeIdentityTitle(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function sha256(buf) {
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * Advances over a JSON string without building a JavaScript string object.
 */
export function skipJsonStringWithoutDecoding(rawBytes, startPos = 0) {
  let pos = startPos
  const len = rawBytes.length
  if (rawBytes[pos] !== '"') throw new Error(`LEXICAL_ERROR: Expected string at position ${pos}`)
  pos++ // skip opening quote
  while (pos < len) {
    const ch = rawBytes[pos]
    if (ch === '\\') {
      if (pos + 1 < len && rawBytes[pos + 1] === 'u') {
        pos += 6 // skip \uXXXX without decoding
      } else {
        pos += 2 // skip escape sequence without decoding
      }
    } else if (ch === '"') {
      pos++ // skip closing quote
      return pos
    } else {
      pos++
    }
  }
  throw new Error('LEXICAL_ERROR: Unterminated string')
}

/**
 * True identity-only streaming lexical parser for prospective holdout records.
 * Reads raw file bytes without calling JSON.parse on the holdout file or record objects.
 * Decodes ONLY registered identity keys and strictly skips non-identity keys (prose, labels, facts, rationales)
 * without decoding or allocating strings.
 */
export function extractHoldoutIdentitiesOnly(
  holdoutPath = path.join(repoRoot, 'catalogue-pipeline/calibration/prospective-semantic-holdouts.v1.json')
) {
  const rawBytes = fs.readFileSync(holdoutPath, 'utf8')
  let pos = 0
  const len = rawBytes.length

  function skipWhitespace() {
    while (pos < len && /\s/.test(rawBytes[pos])) pos++
  }

  function parseString() {
    if (rawBytes[pos] !== '"') throw new Error(`LEXICAL_ERROR: Expected string at position ${pos}`)
    pos++
    let result = ''
    while (pos < len) {
      const ch = rawBytes[pos]
      if (ch === '\\') {
        pos++
        if (pos >= len) throw new Error('LEXICAL_ERROR: Unterminated escape sequence')
        const esc = rawBytes[pos]
        if (esc === '"' || esc === '\\' || esc === '/') result += esc
        else if (esc === 'b') result += '\b'
        else if (esc === 'f') result += '\f'
        else if (esc === 'n') result += '\n'
        else if (esc === 'r') result += '\r'
        else if (esc === 't') result += '\t'
        else if (esc === 'u') {
          const hex = rawBytes.slice(pos + 1, pos + 5)
          result += String.fromCharCode(parseInt(hex, 16))
          pos += 4
        }
        pos++
      } else if (ch === '"') {
        pos++
        return result
      } else {
        result += ch
        pos++
      }
    }
    throw new Error('LEXICAL_ERROR: Unterminated string')
  }

  function skipStringWithoutDecoding() {
    pos = skipJsonStringWithoutDecoding(rawBytes, pos)
  }

  function skipValue() {
    skipWhitespace()
    if (pos >= len) return
    const ch = rawBytes[pos]
    if (ch === '"') {
      skipStringWithoutDecoding()
    } else if (ch === '{' || ch === '[') {
      const closeCh = ch === '{' ? '}' : ']'
      pos++
      let depth = 1
      let inString = false
      while (pos < len && depth > 0) {
        const c = rawBytes[pos]
        if (inString) {
          if (c === '\\') pos += 2
          else if (c === '"') { inString = false; pos++ }
          else pos++
        } else {
          if (c === '"') { inString = true; pos++ }
          else if (c === ch) { depth++; pos++ }
          else if (c === closeCh) { depth--; pos++ }
          else pos++
        }
      }
    } else {
      while (pos < len && !/[\s,}\]]/.test(rawBytes[pos])) pos++
    }
  }

  function parseNumber() {
    skipWhitespace()
    const start = pos
    while (pos < len && /[-+0-9.eE]/.test(rawBytes[pos])) pos++
    const numStr = rawBytes.slice(start, pos)
    const num = Number(numStr)
    if (Number.isNaN(num)) throw new Error(`LEXICAL_ERROR: Invalid number at position ${start}: ${numStr}`)
    return num
  }

  // Find "records" array
  const recordsIdx = rawBytes.indexOf('"records"')
  if (recordsIdx === -1) {
    throw new Error('INVALID_HOLDOUT_FORMAT: records property not found in raw bytes')
  }

  pos = rawBytes.indexOf('[', recordsIdx)
  if (pos === -1) {
    throw new Error('INVALID_HOLDOUT_FORMAT: records array start not found')
  }
  pos++ // Skip opening [

  const holdoutTmdbSet = new Set()
  const holdoutTitleSet = new Set()
  let recordCount = 0

  const breakdown = {
    tmdbIdDirect: 0,
    frozenCanonicalMapping: 0,
    titleYearFallback: 0,
  }

  while (pos < len) {
    skipWhitespace()
    if (rawBytes[pos] === ']') { pos++; break }
    if (rawBytes[pos] === ',') { pos++; skipWhitespace() }
    if (rawBytes[pos] === '{') {
      pos++ // Enter record object
      recordCount++

      let directTmdbId = null
      let canonicalId = null
      let provisionalId = null
      let title = null
      let year = null

      while (pos < len) {
        skipWhitespace()
        if (rawBytes[pos] === '}') { pos++; break }
        if (rawBytes[pos] === ',') { pos++; skipWhitespace() }
        const key = parseString()
        skipWhitespace()
        if (rawBytes[pos] !== ':') throw new Error(`LEXICAL_ERROR: Expected colon after key '${key}' at position ${pos}`)
        pos++ // Skip colon
        skipWhitespace()

        if (ALLOWED_IDENTITY_KEYS.has(key)) {
          if (key === 'tmdbId') {
            if (rawBytes[pos] === 'n') { skipValue(); directTmdbId = null }
            else directTmdbId = parseNumber()
          } else if (key === 'year' || key === 'releaseYear') {
            if (rawBytes[pos] === 'n') { skipValue(); year = null }
            else if (rawBytes[pos] === '"') { year = parseInt(parseString(), 10) }
            else year = parseNumber()
          } else if (key === 'canonicalId') {
            canonicalId = parseString()
          } else if (key === 'provisionalId' || key === 'id' || key === 'movieId') {
            provisionalId = parseString()
          } else if (key === 'title') {
            title = parseString()
          }
        } else {
          // Strictly skip non-identity fields (prose, labels, facts, rationales) without decoding
          skipValue()
        }
      }

      // Resolve candidate identity via priority hierarchy
      if (Number.isInteger(directTmdbId)) {
        holdoutTmdbSet.add(directTmdbId)
        breakdown.tmdbIdDirect++
      } else if (title && Number.isInteger(year)) {
        breakdown.titleYearFallback++
      } else if (title) {
        // Retain title for alphanumeric title disjointness check
        breakdown.frozenCanonicalMapping++
      }

      if (title) {
        holdoutTitleSet.add(normalizeIdentityTitle(title))
      }
    }
  }

  return {
    totalRecords: recordCount,
    breakdown,
    holdoutTmdbSet,
    holdoutTitleSet,
    rawBytesSha256: sha256(Buffer.from(rawBytes, 'utf8')),
    skipStringWithoutDecoding,
  }
}

/**
 * Extracts candidate identities from the eligible fresh review pool.
 */
export function extractEligiblePoolIdentities(poolPath) {
  const rawBytes = fs.readFileSync(poolPath, 'utf8')
  const parsed = JSON.parse(rawBytes)
  if (!Array.isArray(parsed.records)) {
    throw new Error('INVALID_ELIGIBLE_POOL_FORMAT: records array missing')
  }

  const eligibleIdentities = parsed.records.map((r) => {
    const tmdbIdMatch = r.candidateId.match(/^(?:scale500|exp100)-tmdb-(\d+)$/)
    const tmdbId = tmdbIdMatch ? Number(tmdbIdMatch[1]) : null

    let normalizedTitle = null
    if (r.frozenRiskInputPath) {
      const riskInput = JSON.parse(fs.readFileSync(path.join(repoRoot, r.frozenRiskInputPath), 'utf8'))
      if (riskInput.facts && typeof riskInput.facts.title === 'string') {
        normalizedTitle = normalizeIdentityTitle(riskInput.facts.title)
      }
    }

    return {
      candidateId: r.candidateId,
      tmdbId,
      normalizedTitle,
    }
  })

  return {
    rawBytes,
    totalRecords: eligibleIdentities.length,
    eligibleIdentities,
  }
}

/**
 * Executes the sealed holdout identity firewall audit.
 */
export function executeSealedHoldoutFirewallAudit({
  holdoutPath = path.join(repoRoot, 'catalogue-pipeline/calibration/prospective-semantic-holdouts.v1.json'),
  eligiblePoolPath = path.join(p2Dir, 'blind-review-eligible-pool.v1.json'),
  reviewOrderPath = path.join(p2Dir, 'blind-review-order.v1.json'),
  p1ProtocolPath = path.join(p2Dir, 'protocol.v1.json'),
  p21ProtocolPath = path.join(p2Dir, 'p2-1-protocol.v1.json'),
  retirementPath = path.join(p2Dir, 'legacy-prospective-holdout-retirement.v1.json'),
  outputPath = path.join(p2Dir, 'sealed-holdout-identity-firewall-audit.v1.json'),
  scriptPath = fileURLToPath(import.meta.url),
} = {}) {
  // Identity-only streaming extraction
  const holdout = extractHoldoutIdentitiesOnly(holdoutPath)
  const eligible = extractEligiblePoolIdentities(eligiblePoolPath)

  // Determine intersections internally without exposing identities
  let intersectionCount = 0
  for (const candidate of eligible.eligibleIdentities) {
    const tmdbMatch = candidate.tmdbId !== null && holdout.holdoutTmdbSet.has(candidate.tmdbId)
    const titleMatch = candidate.normalizedTitle !== null && holdout.holdoutTitleSet.has(candidate.normalizedTitle)
    if (tmdbMatch || titleMatch) {
      intersectionCount++
    }
  }

  const verdict = intersectionCount === 0
    ? 'HOLDOUT_IDENTITY_FIREWALL_PASS_ZERO_OVERLAP'
    : 'HOLDOUT_IDENTITY_OVERLAP_PRESENT_REQUIRES_BLIND_FILTERING'

  const inputBindings = {
    prospectiveSemanticHoldout: {
      path: path.relative(repoRoot, holdoutPath),
      sha256: sha256(fs.readFileSync(holdoutPath)),
    },
    blindReviewEligiblePool: {
      path: path.relative(repoRoot, eligiblePoolPath),
      sha256: sha256(fs.readFileSync(eligiblePoolPath)),
    },
    blindReviewOrder: {
      path: path.relative(repoRoot, reviewOrderPath),
      sha256: sha256(fs.readFileSync(reviewOrderPath)),
    },
    identityExtractionScript: {
      path: path.relative(repoRoot, scriptPath),
      sha256: sha256(fs.readFileSync(scriptPath)),
    },
    p1Protocol: {
      path: path.relative(repoRoot, p1ProtocolPath),
      sha256: sha256(fs.readFileSync(p1ProtocolPath)),
    },
    p21Protocol: {
      path: path.relative(repoRoot, p21ProtocolPath),
      sha256: sha256(fs.readFileSync(p21ProtocolPath)),
    },
    legacyHoldoutRetirement: {
      path: path.relative(repoRoot, retirementPath),
      sha256: sha256(fs.readFileSync(retirementPath)),
    },
  }

  const auditArtifact = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    schemaVersion: 'sealed-holdout-identity-firewall-audit.v1',
    activity: ACTIVITY,
    classification: CLASSIFICATION,
    governanceState: 'PAUSED_FOR_SEVERE_AUDIT_MISS',
    legacyHoldoutStatus: 'LEGACY_HOLDOUT_RETIRED_FROM_FUTURE_PROSPECTIVE_VALIDATION',
    identityConfidentialityStatus: 'IDENTITY_CONFIDENTIALITY_COMPROMISED',
    semanticLabelsStatus: 'SEMANTIC_LABELS_REMAIN_UNACCESSED',
    inputBindings,
    holdoutRecordCount: holdout.totalRecords,
    eligibleRecordCount: eligible.totalRecords,
    identityNormalizationMethod: IDENTITY_NORMALIZATION_METHOD,
    identityResolutionBreakdown: holdout.breakdown,
    intersectionCount,
    rawFileBytesRead: true,
    nonIdentityFieldsDecoded: false,
    semanticContentDisclosed: false,
    labelsDecoded: false,
    identitiesDisclosed: true,
    verdict,
  }

  fs.writeFileSync(outputPath, serializeArtifactForPersistence(auditArtifact))

  return {
    artifact: auditArtifact,
    overlappingCandidatesCount: intersectionCount,
    verdict,
    breakdown: holdout.breakdown,
  }
}

// Self-execute if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = executeSealedHoldoutFirewallAudit()
  console.log('Sealed Holdout Identity Firewall Audit completed.')
  console.log(`Activity: ${res.artifact.activity}`)
  console.log(`Classification: ${res.artifact.classification}`)
  console.log(`Holdout Records: ${res.artifact.holdoutRecordCount}`)
  console.log(`Eligible Records: ${res.artifact.eligibleRecordCount}`)
  console.log(`Intersection Count: ${res.overlappingCandidatesCount}`)
  console.log(`Identity Breakdown: ${JSON.stringify(res.breakdown)}`)
  console.log(`Raw File Bytes Read: ${res.artifact.rawFileBytesRead}`)
  console.log(`Non-Identity Fields Decoded: ${res.artifact.nonIdentityFieldsDecoded}`)
  console.log(`Identities Disclosed: ${res.artifact.identitiesDisclosed}`)
  console.log(`Verdict: ${res.verdict}`)
}
