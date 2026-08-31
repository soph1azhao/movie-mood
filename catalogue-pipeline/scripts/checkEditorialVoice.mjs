import { SPOILER_PATTERNS, isDescriptionHookDuplicate } from './validateBatch.mjs'

const CLICHE_PATTERNS = [
  /\btour de force\b/i, /\brich tapestry\b/i, /\bmasterful blend\b/i, /\bstellar ensemble\b/i,
  /\bheartwarming tale\b/i, /\ba love letter to\b/i, /\bdeeply moving\b/i,
  /\bbreathtaking cinematography\b/i, /\bkeeps you on the edge of your seat\b/i,
]

const TRIAD_PATTERN = /\b[a-z]+,\s+[a-z]+,\s+and\s+[a-z]+\b/i

export function checkEditorialVoice(copy) {
  const flags = []
  for (const [field, text] of Object.entries(copy ?? {})) {
    if (typeof text !== 'string') continue
    if (CLICHE_PATTERNS.some((pattern) => pattern.test(text))) flags.push({ severity: 'review', code: 'GENERIC_LANGUAGE_REVIEW', field, message: `${field} uses generic critical language.` })
    if (SPOILER_PATTERNS.some((pattern) => pattern.test(text))) flags.push({ severity: 'review', code: 'SPOILER_PATTERN_REVIEW', field, message: `${field} has an obvious spoiler-sensitive pattern.` })
  }
  if (isDescriptionHookDuplicate(copy?.description, copy?.curiosityHook)) flags.push({ severity: 'review', code: 'DESCRIPTION_HOOK_DUPLICATION', field: 'curiosityHook', message: 'description and curiosityHook substantially overlap.' })
  return flags
}

export function detectBatchStructuralPatterns(entries, { triadThreshold = 3 } = {}) {
  const triads = []
  for (const entry of entries ?? []) {
    for (const [field, text] of Object.entries(entry.copy ?? entry)) {
      if (typeof text === 'string' && TRIAD_PATTERN.test(text)) triads.push({ candidateId: entry.candidateId ?? null, field })
    }
  }
  return triads.length >= triadThreshold
    ? [{ severity: 'review', code: 'BATCH_TRIAD_SYNTAX_REPETITION', field: null, message: `${triads.length} adjective-triad constructions exceed the batch review threshold.`, matches: triads }]
    : []
}
