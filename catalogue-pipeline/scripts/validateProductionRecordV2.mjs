import { validateCuratedMovie, validateMovieFacts } from './validateBatch.mjs'
import { hashArtifact, validatePaletteArtifact } from './validatePromotionContract.mjs'

const HASH = /^sha256:[0-9a-f]{64}$/

const REQUIRED_PROVENANCE = [
  'promotionCandidateHash',
  'semanticArtifactHash',
  'evidencePacketHash',
  'factsRecordHash',
  'finalEditorialArtifactHash',
  'paletteArtifactHash',
]

const ROOT_FIELDS = [
  'schemaVersion',
  'candidateId',
  'tmdbId',
  'curatedMovie',
  'facts',
  'provenance',
]

const PROVENANCE_FIELDS = [
  ...REQUIRED_PROVENANCE,
  'criticArtifactHash',
]

const SEMANTIC_FIELDS = [
  'moods',
  'situations',
  'filterLanguages',
  'pace',
  'emotionalWeight',
  'attentionDemand',
  'discoveryStyle',
]

const FACT_FIELDS = [
  'tmdbId',
  'title',
  'year',
  'director',
  'countries',
  'spokenLanguages',
  'genres',
  'runtimeMinutes',
  'posterPath',
]

function fail(code, message, field) {
  return {
    severity: 'hard_fail',
    code,
    message,
    ...(field ? { field } : {}),
  }
}

function isObject(value) {
  return Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value)
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function finalEditorialCopy(artifact) {
  if (!isObject(artifact)) return undefined

  if (artifact.schemaVersion === 'editorial-artifact.v1.1') {
    return artifact.output?.copy
  }

  if (
    artifact.schemaVersion ===
    'editorial-human-directed-repair-artifact.v1'
  ) {
    return artifact.copy
  }

  return undefined
}

function rejectUnknown(hardFailures, value, allowed, prefix = '') {
  if (!isObject(value)) return

  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) {
      const qualified = prefix ? `${prefix}.${field}` : field

      hardFailures.push(
        fail(
          'UNKNOWN_FIELD',
          `${qualified} is not allowed.`,
          qualified,
        ),
      )
    }
  }
}

export function validateProductionRecordV2(record, bound = {}) {
  const hardFailures = []
  const reviewFlags = []

  if (!isObject(record)) {
    return {
      ok: false,
      hardFailures: [
        fail(
          'INVALID_RECORD',
          'Production record must be an object.',
        ),
      ],
      reviewFlags,
    }
  }

  rejectUnknown(
    hardFailures,
    record,
    ROOT_FIELDS,
  )

  if (record.schemaVersion !== 'production-record.v2') {
    hardFailures.push(
      fail(
        'INVALID_SCHEMA_VERSION',
        'schemaVersion must be production-record.v2.',
        'schemaVersion',
      ),
    )
  }

  if (!record.candidateId) {
    hardFailures.push(
      fail(
        'MISSING_CANDIDATE_ID',
        'candidateId is required.',
        'candidateId',
      ),
    )
  }

  if (!Number.isInteger(record.tmdbId) || record.tmdbId < 1) {
    hardFailures.push(
      fail(
        'INVALID_TMDB_ID',
        'tmdbId must be positive.',
        'tmdbId',
      ),
    )
  }

  const curated = validateCuratedMovie(
    record.curatedMovie,
    {
      existingIds: bound.existingIds,
      existingTmdbIds: bound.existingTmdbIds,
    },
  )

  hardFailures.push(...curated.hardFailures)
  reviewFlags.push(...curated.reviewFlags)

  const facts = validateMovieFacts(record.facts)

  hardFailures.push(...facts.hardFailures)
  reviewFlags.push(...facts.reviewFlags)

  if (
    record.curatedMovie?.tmdbId !== record.tmdbId ||
    record.facts?.tmdbId !== record.tmdbId
  ) {
    hardFailures.push(
      fail(
        'IDENTITY_MISMATCH',
        'Record, curated movie, and facts TMDB identities must match.',
      ),
    )
  }

  if (!isObject(record.provenance)) {
    hardFailures.push(
      fail(
        'MISSING_PROVENANCE',
        'provenance is required.',
        'provenance',
      ),
    )
  } else {
    rejectUnknown(
      hardFailures,
      record.provenance,
      PROVENANCE_FIELDS,
      'provenance',
    )

    for (const field of REQUIRED_PROVENANCE) {
      if (!HASH.test(record.provenance[field] ?? '')) {
        hardFailures.push(
          fail(
            'INVALID_PROVENANCE_HASH',
            `${field} must be a sha256 hash.`,
            `provenance.${field}`,
          ),
        )
      }
    }

    if (
      record.provenance.criticArtifactHash !== undefined &&
      !HASH.test(record.provenance.criticArtifactHash)
    ) {
      hardFailures.push(
        fail(
          'INVALID_PROVENANCE_HASH',
          'criticArtifactHash must be a sha256 hash when present.',
          'provenance.criticArtifactHash',
        ),
      )
    }

    if (
      record.provenance.criticArtifactHash !== undefined &&
      !bound.criticArtifact
    ) {
      hardFailures.push(
        fail(
          'MISSING_BOUND_CRITIC_ARTIFACT',
          'criticArtifactHash is present but no critic artifact was loaded.',
          'provenance.criticArtifactHash',
        ),
      )
    }
  }

  const expected = {
    promotionCandidateHash:
      bound.promotionCandidate &&
      hashArtifact(bound.promotionCandidate),

    semanticArtifactHash:
      bound.semanticArtifact &&
      hashArtifact(bound.semanticArtifact),

    evidencePacketHash:
      bound.evidencePacket &&
      hashArtifact(bound.evidencePacket),

    factsRecordHash:
      bound.factsRecord &&
      hashArtifact(bound.factsRecord),

    finalEditorialArtifactHash:
      bound.finalEditorialArtifact &&
      hashArtifact(bound.finalEditorialArtifact),

    paletteArtifactHash:
      bound.paletteArtifact &&
      hashArtifact(bound.paletteArtifact),

    criticArtifactHash:
      bound.criticArtifact &&
      hashArtifact(bound.criticArtifact),
  }

  for (const [field, value] of Object.entries(expected)) {
    if (
      value &&
      record.provenance?.[field] !== value
    ) {
      hardFailures.push(
        fail(
          'STALE_PROVENANCE_HASH',
          `${field} does not match the loaded artifact.`,
          `provenance.${field}`,
        ),
      )
    }
  }

  if (bound.promotionCandidate) {
    if (
      bound.promotionCandidate.candidateId !== record.candidateId ||
      bound.promotionCandidate.tmdbId !== record.tmdbId
    ) {
      hardFailures.push(
        fail(
          'PROMOTION_CANDIDATE_IDENTITY_MISMATCH',
          'Promotion candidate identity must match the production record.',
        ),
      )
    }
  }

  if (bound.semanticArtifact) {
    const semanticIdentity = bound.semanticArtifact.movie

    if (
      semanticIdentity?.candidateId !== record.candidateId ||
      semanticIdentity?.tmdbId !== record.tmdbId
    ) {
      hardFailures.push(
        fail(
          'SEMANTIC_IDENTITY_MISMATCH',
          'Semantic movie identity must match the production record.',
        ),
      )
    }

    const classification = bound.semanticArtifact.classification

    if (!classification || typeof classification !== 'object') {
      hardFailures.push(
        fail(
          'INVALID_BOUND_SEMANTIC_ARTIFACT',
          'Bound semantic artifact must contain classification.',
          'semanticArtifact.classification',
        ),
      )
    } else {
      for (const field of SEMANTIC_FIELDS) {
        if (
          !same(
            record.curatedMovie?.[field],
            classification[field],
          )
        ) {
          hardFailures.push(
            fail(
              'SEMANTIC_FIELD_MISMATCH',
              `${field} must equal the bound semantic classification.`,
              `curatedMovie.${field}`,
            ),
          )
        }
      }
    }
  }

  if (bound.factsRecord) {
    if (
      bound.factsRecord.candidateId !== undefined &&
      bound.factsRecord.candidateId !== record.candidateId
    ) {
      hardFailures.push(
        fail(
          'FACTS_IDENTITY_MISMATCH',
          'Facts candidateId must match the production record.',
          'candidateId',
        ),
      )
    }

    for (const field of FACT_FIELDS) {
      if (
        !same(
          record.facts?.[field],
          bound.factsRecord[field],
        )
      ) {
        hardFailures.push(
          fail(
            'FACTS_FIELD_MISMATCH',
            `${field} must equal the bound factual snapshot.`,
            `facts.${field}`,
          ),
        )
      }
    }
  }

  if (bound.paletteArtifact) {
    const palette = validatePaletteArtifact(
      bound.paletteArtifact,
    )

    hardFailures.push(
      ...palette.hardFailures.map(
        (entry) => ({
          ...entry,
          code: `PALETTE_${entry.code}`,
        }),
      ),
    )

    if (
      bound.paletteArtifact.candidateId !== record.candidateId ||
      bound.paletteArtifact.tmdbId !== record.tmdbId
    ) {
      hardFailures.push(
        fail(
          'PALETTE_IDENTITY_MISMATCH',
          'Palette identity must match the production record.',
        ),
      )
    }

    if (
      !same(
        record.curatedMovie?.palette,
        bound.paletteArtifact.palette,
      )
    ) {
      hardFailures.push(
        fail(
          'PALETTE_VALUE_MISMATCH',
          'Curated palette must equal the bound palette artifact.',
        ),
      )
    }

    if (
      record.facts?.posterPath !==
      bound.paletteArtifact.sourcePosterIdentity?.posterPath
    ) {
      hardFailures.push(
        fail(
          'POSTER_PATH_MISMATCH',
          'Facts and palette posterPath must match.',
        ),
      )
    }
  }

  if (bound.finalEditorialArtifact) {
    if (
      bound.finalEditorialArtifact.candidateId !== record.candidateId ||
      bound.finalEditorialArtifact.tmdbId !== record.tmdbId
    ) {
      hardFailures.push(
        fail(
          'EDITORIAL_IDENTITY_MISMATCH',
          'Final editorial identity must match.',
        ),
      )
    }

    const copy = finalEditorialCopy(
      bound.finalEditorialArtifact,
    )

    if (!copy) {
      hardFailures.push(
        fail(
          'INVALID_FINAL_EDITORIAL_ARTIFACT',
          'Final editorial artifact must use an accepted editorial artifact schema with copy content.',
        ),
      )
    } else {
      for (const field of [
        'description',
        'whyWatch',
        'curiosityHook',
        'vibeSummary',
      ]) {
        if (
          record.curatedMovie?.[field] !== copy[field]
        ) {
          hardFailures.push(
            fail(
              'EDITORIAL_COPY_MISMATCH',
              `${field} must equal final editorial copy.`,
              `curatedMovie.${field}`,
            ),
          )
        }
      }
    }
  }

  return {
    ok: hardFailures.length === 0,
    hardFailures,
    reviewFlags,
  }
}