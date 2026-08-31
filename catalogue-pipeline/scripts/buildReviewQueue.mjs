import { summarizeValidation } from './validateBatch.mjs'

function getPriority(summary) {
  if (summary.hardFailures.length > 0) return 'P0'

  const hasCriticalReview = summary.reviewFlags.some((flag) => (
    flag.code === 'POSTER_UNAVAILABLE' ||
    flag.code === 'SPOILER_HARD_FAILURE' ||
    flag.code === 'LAYOUT_HARD_FAILURE'
  ))
  if (hasCriticalReview) return 'P1'

  if (summary.reviewFlags.length > 0) return 'P2'
  return 'P4'
}

function getStatus(priority) {
  if (priority === 'P0') return 'blocked'
  if (priority === 'P4') return 'candidate_for_batch_approval'
  return 'needs_review'
}

export function buildReviewQueue({ batchId, candidates }) {
  if (!batchId || typeof batchId !== 'string') {
    throw new Error('batchId is required to build a review queue.')
  }
  if (!Array.isArray(candidates)) {
    throw new Error('candidates must be an array.')
  }

  return {
    batchId,
    schemaVersion: 'review-queue.v1',
    items: candidates.map((candidate) => {
      const validationSummary = summarizeValidation(candidate.validationResults ?? [])
      const priority = getPriority(validationSummary)

      return {
        candidateId: candidate.candidateId,
        tmdbId: candidate.tmdbId,
        title: candidate.title,
        priority,
        status: getStatus(priority),
        reviewReasons: [
          ...validationSummary.hardFailures,
          ...validationSummary.reviewFlags,
        ].map((issue) => ({
          code: issue.code,
          field: issue.field ?? null,
          message: issue.message,
        })),
        proposedCuratedMovie: candidate.proposedCuratedMovie ?? null,
        facts: candidate.facts ?? null,
        posterSuitability: candidate.posterSuitability ?? null,
        confidence: candidate.confidence ?? null,
        humanReview: {
          reviewer: null,
          decision: null,
          fieldOverrides: {},
          notes: null,
          reviewedAt: null,
        },
      }
    }),
  }
}
