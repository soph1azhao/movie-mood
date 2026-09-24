import { hashArtifact } from './validatePromotionContract.mjs'

const V2 = 'V2_LINT_PASS'
const ORIGINAL = 'ORIGINAL_STAGE1_LINT_PASS'

const withoutSelfHash = preview => Object.fromEntries(Object.entries(preview).filter(([key]) => key !== 'artifactHash'))

export function validateFinalPreviewBinding({ preview, expectedFinalPreviewHash, routeProvenance }) {
  if (typeof expectedFinalPreviewHash !== 'string') return false
  if (routeProvenance === V2) {
    return typeof preview?.artifactHash === 'string'
      && preview.artifactHash === expectedFinalPreviewHash
      && hashArtifact(withoutSelfHash(preview)) === expectedFinalPreviewHash
  }
  if (routeProvenance === ORIGINAL) return hashArtifact(preview) === expectedFinalPreviewHash
  return false
}
