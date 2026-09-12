import { describe, expect, it, vi } from 'vitest'
import { main } from './runC1bV4Stage2Live.mjs'

describe('C1b-V4 Stage-2 explicit launcher', () => {
  it('importing the launcher performs zero execution or network work', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch'); expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore()
  })

  it.each([[], ['--wrong'], ['--execute-authorized-v4-stage2', '--extra']])('rejects absent or non-exact authorization with zero execution', async (argv) => {
    const run = vi.fn(); await expect(main({ argv, run })).resolves.toEqual({ status: 'NOT_AUTHORIZED', dispatchedRequests: 0 }); expect(run).not.toHaveBeenCalled()
  })
})
