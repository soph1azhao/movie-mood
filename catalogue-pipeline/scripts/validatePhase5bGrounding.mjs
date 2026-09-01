const MEMORY_ONLY_PATTERN = /\b(?:model memory|pretrained knowledge|outside knowledge|i (?:know|recall)|general knowledge)\b/i

function issue(code, field, message) {
  return { severity: 'hard_fail', code, field, message }
}

function evidenceItems(output) {
  const entries = []
  for (const [label, item] of Object.entries(output.evidence?.moods ?? {})) entries.push([item, `evidence.moods.${label}`])
  for (const [label, item] of Object.entries(output.evidence?.situations ?? {})) entries.push([item, `evidence.situations.${label}`])
  for (const field of ['pace', 'emotionalWeight', 'attentionDemand', 'discoveryStyle']) entries.push([output.evidence?.[field], `evidence.${field}`])
  return entries
}

function hasOnlyDeclaredCueRefs(cues, sourceRefs) {
  const declared = new Set(Array.isArray(sourceRefs) ? sourceRefs : [])
  const cueRefs = cues.split(';').map((cue) => cue.trim().split(':')[0]?.trim()).filter(Boolean)
  return cueRefs.length > 0 && cueRefs.every((sourceRef) => declared.has(sourceRef))
}

export function validatePhase5bGrounding(output) {
  const hardFailures = []
  for (const [item, field] of evidenceItems(output)) {
    const rationale = item?.rationale
    if (typeof rationale !== 'string') continue
    if (MEMORY_ONLY_PATTERN.test(rationale)) {
      hardFailures.push(issue('UNSUPPORTED_MODEL_MEMORY_ASSERTION', field, `${field} must not rely on unstated model memory.`))
      continue
    }
    if (/^Direct evidence:\s*/i.test(rationale)) {
      const cues = /\bCues:\s*\[([^\]]+)\]/i.exec(rationale)?.[1] ?? ''
      if (!hasOnlyDeclaredCueRefs(cues, item.sourceRefs)) hardFailures.push(issue('INVALID_DIRECT_EVIDENCE_CUES', field, `${field} direct evidence must identify source cues from sourceRefs.`))
      continue
    }
    if (/^Supported inference:\s*/i.test(rationale)) {
      const cues = /\bCues:\s*\[([^\]]+)\]/i.exec(rationale)?.[1] ?? ''
      if (cues.split(';').filter((cue) => cue.trim().length > 0).length < 2) hardFailures.push(issue('INVALID_SUPPORTED_INFERENCE_CUES', field, `${field} supported inference must identify multiple source cues.`))
      if (!hasOnlyDeclaredCueRefs(cues, item.sourceRefs)) hardFailures.push(issue('INVALID_SUPPORTED_INFERENCE_CUES', field, `${field} supported inference cues must use declared sourceRefs.`))
      if (!/\bBridge:\s*\S[\s\S]{11,}/i.test(rationale)) hardFailures.push(issue('MISSING_SUPPORTED_INFERENCE_BRIDGE', field, `${field} supported inference must explain the bridge to the taxonomy label.`))
      continue
    }
    hardFailures.push(issue('MISSING_EVIDENCE_GROUNDING_MODE', field, `${field} must declare Direct evidence or Supported inference.`))
  }
  return { ok: hardFailures.length === 0, hardFailures }
}
