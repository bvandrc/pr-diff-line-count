import { exec } from '@actions/exec'

import { resolveShaRange } from '../sha.ts'

vi.mock('@actions/exec', () => ({ exec: vi.fn() }))

const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const MERGE_BASE = 'c'.repeat(40)

/** Makes `git merge-base` answer with `stdout`, or fail with a non-zero code. */
const gitMergeBase = ({ stdout = '', code = 0 } = {}) => {
  vi.mocked(exec).mockImplementation((_cmd, _args, options) => {
    options?.listeners?.stdout?.(Buffer.from(stdout))
    return Promise.resolve(code)
  })
}

describe('resolveShaRange', () => {
  it('counts from the merge base rather than the base branch tip', async () => {
    gitMergeBase({ stdout: `${MERGE_BASE}\n` })

    // Diffing the tip would bill the pull request for commits that landed on
    // the base branch after it forked.
    await expect(resolveShaRange({ base: BASE, head: HEAD })).resolves.toEqual({
      baseSha: MERGE_BASE,
      headSha: HEAD,
    })
  })

  it('says how to run it when there is no revision to compare', async () => {
    for (const range of [
      { base: undefined, head: HEAD },
      { base: BASE, head: undefined },
      { base: undefined, head: undefined },
    ]) {
      await expect(
        resolveShaRange(range),
        JSON.stringify(range)
      ).rejects.toThrow(
        'No revisions to compare: run this on a `pull_request` event, or pass `base-sha` and `head-sha`.'
      )
    }
  })

  it('names the fix when the checkout is too shallow to hold the ancestor', async () => {
    gitMergeBase({ code: 1 })

    await expect(resolveShaRange({ base: BASE, head: HEAD })).rejects.toThrow(
      `Could not find a merge base for ${BASE}...${HEAD}. Check out with \`fetch-depth: 0\`.`
    )
  })
})
