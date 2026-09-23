/**
 * @fileoverview Works out which two revisions a run should count.
 */

import { exec } from '@actions/exec'

export type ShaRange = {
  baseSha: string
  headSha: string
}

/**
 * Resolves the range to count from the two candidate revisions, returning the
 * merge base of them as `baseSha` rather than `base` itself: diffing the base
 * branch's tip would bill a pull request for commits that landed on it after
 * the branch forked.
 *
 * GitHub's own +/- counts from the merge base too, so this keeps the two
 * comparable.
 *
 * Throws when either candidate is missing, and when the two have no merge base
 * in the checkout -- which a shallow clone causes, since it holds the two tips
 * but not their common ancestor.
 */
export async function resolveShaRange({
  base,
  head,
}: {
  base: string | undefined
  head: string | undefined
}): Promise<ShaRange> {
  if (!base || !head) {
    throw new Error(
      'No revisions to compare: run this on a `pull_request` event, or pass `base-sha` and `head-sha`.'
    )
  }

  let mergeBase = ''
  const code = await exec('git', ['merge-base', base, head], {
    ignoreReturnCode: true,
    silent: true,
    listeners: { stdout: (data) => (mergeBase += data.toString()) },
  })

  if (code !== 0) {
    throw new Error(
      `Could not find a merge base for ${base}...${head}. Check out with \`fetch-depth: 0\`.`
    )
  }

  return { baseSha: mergeBase.trim(), headSha: head }
}
