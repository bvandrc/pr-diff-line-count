/**
 * @fileoverview Action entrypoint: counts the resolved range with cloc, sorts
 * the changed files into categories, and reports the tally as outputs, a job
 * summary and a pull request comment.
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getBooleanInput,
  getInput,
  info,
  setFailed,
  setOutput,
  summary,
} from '@actions/core'
import { context } from '@actions/github'

import { runClocDiff } from './cloc/run.ts'
import { githubDiffTotalsSchema, renderMarkdown } from './markdown.ts'
import { resolveShaRange } from './sha.ts'
import { postStickyComment } from './sticky-comment.ts'
import { DEFAULT_CATEGORY_GLOBS, tallyDiff } from './tally.ts'

async function run(): Promise<void> {
  const pullRequest = context.payload.pull_request
  const { baseSha, headSha } = await resolveShaRange({
    base: getInput('base-sha') || pullRequest?.base?.sha,
    head: getInput('head-sha') || pullRequest?.head?.sha,
  })
  info(`Counting ${baseSha}..${headSha}`)

  const report = await runClocDiff({
    baseSha,
    headSha,
    reportPath: join(tmpdir(), 'pr-diff-line-count.json'),
  })

  const tally = tallyDiff(report, DEFAULT_CATEGORY_GLOBS)

  const markdown = renderMarkdown(tally, {
    // Present only on the pull_request event. The payload is typed `any`, so the
    // schema is what checks it -- and strips the other ~50 keys.
    githubTotals: githubDiffTotalsSchema.safeParse(pullRequest).data,
    colorCounts: getBooleanInput('color-counts'),
  })

  setOutput('markdown', markdown)
  setOutput('json', JSON.stringify(tally))

  await summary.addRaw(markdown).write()

  if (getBooleanInput('comment')) {
    await postStickyComment({ body: markdown })
  }
}

run().catch((error: unknown) => {
  setFailed(error instanceof Error ? error.message : String(error))
})
