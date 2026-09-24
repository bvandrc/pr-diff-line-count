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
  getMultilineInput,
  info,
  setFailed,
  setOutput,
  summary,
} from '@actions/core'
import { context } from '@actions/github'
import { zipObject } from 'es-toolkit'

import { runClocDiff } from './cloc/run.ts'
import { githubDiffTotalsSchema, renderMarkdown } from './markdown.ts'
import { resolveShaRange } from './sha.ts'
import { postStickyComment } from './sticky-comment.ts'
import {
  type CategoryGlobOverrides,
  NON_SOURCE_CATEGORIES,
  resolveCategoryGlobs,
  tallyDiff,
} from './tally.ts'

/**
 * The pattern inputs a workflow can set per category, as the overrides
 * `resolveCategoryGlobs` folds into the defaults.
 */
function readCategoryGlobOverrides(): CategoryGlobOverrides {
  return zipObject(
    [...NON_SOURCE_CATEGORIES],
    NON_SOURCE_CATEGORIES.map((category) => ({
      patterns: getMultilineInput(`${category}-patterns`),
      extraPatterns: getMultilineInput(`extra-${category}-patterns`),
    }))
  )
}

/**
 * Logs the categories a workflow re-globbed.
 *
 * Two repos counting by different globs produce numbers that cannot be
 * compared, so an override belongs in the run log rather than only in the
 * workflow file.
 */
function logCategoryGlobOverrides(overrides: CategoryGlobOverrides) {
  for (const category of NON_SOURCE_CATEGORIES) {
    const { patterns = [], extraPatterns = [] } = overrides[category] ?? {}
    if (patterns.length)
      info(
        `Category "${category}": default patterns replaced by ${patterns.length}.`
      )
    if (extraPatterns.length)
      info(`Category "${category}": ${extraPatterns.length} extra pattern(s).`)
  }
}

async function run(): Promise<void> {
  const pullRequest = context.payload.pull_request
  const { baseSha, headSha } = await resolveShaRange({
    base: getInput('base-sha') || pullRequest?.base?.sha,
    head: getInput('head-sha') || pullRequest?.head?.sha,
  })
  info(`Counting ${baseSha}..${headSha}`)

  const globOverrides = readCategoryGlobOverrides()
  logCategoryGlobOverrides(globOverrides)

  const report = await runClocDiff({
    baseSha,
    headSha,
    reportPath: join(tmpdir(), 'pr-diff-line-count.json'),
  })

  const tally = tallyDiff(report, resolveCategoryGlobs(globOverrides))

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
