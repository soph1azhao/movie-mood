import { describe, expect, it } from 'vitest'
import { verifyV3ProtocolClosure } from './c1bV3ProtocolClosure.mjs'

describe('C1b-V3 post-execution protocol closure', () => {
  it('verifies Stage 1 preservation and the Stage 2 provenance block offline', async () => {
    await expect(verifyV3ProtocolClosure({ root: process.cwd() })).resolves.toMatchObject({
      ok: true,
      protocolId: 'phase5c-c1b-v-confirmatory.v3',
      stage1TerminalStatus: 'COMPLETE',
      stage2Executed: false,
      wikipediaLiveRequests: 0,
      networkCallsDuringClosure: 0,
    })
  })
})
