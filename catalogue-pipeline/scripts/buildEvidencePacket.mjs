import { createHash } from 'node:crypto'

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function evidencePacketHash(packetInput) {
  return `sha256:${createHash('sha256').update(stableSerialize(packetInput)).digest('hex')}`
}

export function buildEvidencePacket({ candidateId, facts, tmdbOverview = null, keywordAssessment = { useful: false, selected: [] } }) {
  const sourceProvenance = [
    { source: 'tmdb-facts', fields: ['title', 'year', 'director', 'genres', 'runtimeMinutes', 'countries', 'spokenLanguages'], version: facts.factsHash ?? null },
  ]
  const groundedOverview = typeof tmdbOverview === 'string' && tmdbOverview.trim().length >= 30 ? tmdbOverview.trim() : null
  const groundedKeywords = keywordAssessment?.useful && Array.isArray(keywordAssessment.selected)
    ? keywordAssessment.selected.filter((keyword) => typeof keyword === 'string' && keyword.trim().length > 0).map((keyword) => keyword.trim())
    : []

  if (groundedOverview) sourceProvenance.push({ source: 'tmdb-overview', fields: ['overview'], version: facts.factsHash ?? null })
  if (groundedKeywords.length > 0) sourceProvenance.push({ source: 'tmdb-keywords', fields: ['keywords'], version: facts.factsHash ?? null, selection: 'maintainer-inspected-useful' })

  const packet = {
    schemaVersion: 'evidence-packet.v1',
    candidateId,
    tmdbId: facts.tmdbId,
    sourceProvenance,
    facts: {
      title: facts.title,
      year: facts.year,
      director: facts.director,
      genres: facts.genres,
      runtimeMinutes: facts.runtimeMinutes,
      countries: facts.countries,
      spokenLanguages: facts.spokenLanguages,
      overview: groundedOverview,
      keywords: groundedKeywords,
    },
  }
  packet.inputHash = evidencePacketHash(packet)

  return {
    packet,
    reviewFlags: groundedOverview || groundedKeywords.length > 0
      ? []
      : [{ severity: 'review', code: 'INSUFFICIENT_GROUNDING', field: 'evidencePacket', message: 'No TMDB overview or useful keywords are available; classification and writing require grounding review.' }],
  }
}
