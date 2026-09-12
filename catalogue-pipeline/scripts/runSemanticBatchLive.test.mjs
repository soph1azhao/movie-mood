import { describe, expect, it } from 'vitest'
import { launchSemanticBatch } from './runSemanticBatchLive.mjs'

describe('authorized semantic batch launcher', () => {
  it('treats an unapproved run command as an offline dry-run', async () => {
    const result = await launchSemanticBatch(['run', 'launcher-test', '--max-fresh-calls', '4'], { env: { GEMINI_MODEL: 'gemini-3.6-flash' } })
    expect(result).toMatchObject({ dryRun: true, executionAuthorized: false, command: 'run', modelId: 'gemini-3.6-flash' })
  })

  it('does not infer execution authorization from an API key', async () => {
    const result = await launchSemanticBatch(['resume', 'launcher-test'], { env: { GEMINI_API_KEY: 'secret-not-printed', GEMINI_MODEL: 'gemini-3.6-flash' } })
    expect(result.executionAuthorized).toBe(false)
    expect(JSON.stringify(result)).not.toContain('secret-not-printed')
  })
})
