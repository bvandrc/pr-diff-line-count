/**
 * @fileoverview Runs cloc over a revision range, and the shape it hands back --
 * cloc being the thing that actually knows a comment from a line of code.
 */

import { readFile } from 'node:fs/promises'
import { info } from '@actions/core'
import { exec } from '@actions/exec'
import { z } from 'zod'

import type { OmitIndexSignatureDeep } from '../utils/type-utils.ts'
import { downloadCloc } from './download.ts'

export const CHANGE_KINDS = ['added', 'modified', 'removed'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

/**
 * `loose()` on both levels: cloc adds fields between releases -- `nFiles` sits
 * beside the counts already -- and an addition is no reason to fail.
 *
 * A count that stops being a number is, since the alternative is a table of
 * NaNs.
 */
const clocCountsSchema = z
  .object({
    code: z.number(),
    comment: z.number(),
    blank: z.number(),
  })
  .loose()

/** One `--by-file` section: counts keyed by repo-relative path. */
const clocSectionSchema = z.record(z.string(), clocCountsSchema)

/**
 * cloc's `--diff --by-file --json` shape: one section per change kind, each
 * keyed by repo-relative path.
 *
 * Every changed path appears in all of them, zeroed where that kind didn't
 * apply, so the sections share one file set. `SUM` and `header` sit among the
 * per-file entries and are not files.
 */
const clocDiffReportSchema = z
  .object({
    added: clocSectionSchema.optional(),
    modified: clocSectionSchema.optional(),
    removed: clocSectionSchema.optional(),
  })
  .loose()

/** One cloc tally, as the counts the schema names and nothing more. */
export type ClocCounts = OmitIndexSignatureDeep<
  z.infer<typeof clocCountsSchema>
>

/**
 * cloc's `--diff --by-file --json` shape: a section per change kind, each keyed
 * by repo-relative path.
 *
 * cloc's `same` and `header` siblings are left out -- they are parsed and
 * ignored, not part of what we hand on.
 */
export type ClocDiffReport = OmitIndexSignatureDeep<
  z.infer<typeof clocDiffReportSchema>
>

async function assertPerl(): Promise<void> {
  const code = await exec('perl', ['--version'], {
    ignoreReturnCode: true,
    silent: true,
  })
  if (code !== 0) {
    throw new Error(
      'cloc is a perl script and no working `perl` was found on this runner.'
    )
  }
}

/**
 * Per-file limit on cloc's diffing. cloc's own default of 10s is far too low
 * for a committed bundle: its diff cost climbs roughly quadratically, measured
 * here at 6s for 16k changed-heavy lines and 68s for 50k.
 *
 * Not unlimited, since cloc warns that a big file of repeated lines can take
 * `sdiff` hours -- and with the check below, too low now fails loudly rather
 * than counting wrong.
 */
const DIFF_TIMEOUT_SECONDS = 300

/**
 * Counts one revision range, returning cloc's per-file diff.
 *
 * Resolves to an empty report when the range holds nothing cloc can count -- it
 * writes no file at all in that case rather than an empty one. Throws rather
 * than returning counts cloc itself reported an error for.
 */
export async function runClocDiff({
  baseSha,
  headSha,
  reportPath,
  cwd,
}: {
  baseSha: string
  headSha: string
  reportPath: string
  /** Where to run git from. Defaults to the process's own directory. */
  cwd?: string
}): Promise<ClocDiffReport> {
  await assertPerl()
  const clocPath = await downloadCloc()

  let output = ''
  await exec(
    'perl',
    [
      clocPath,
      '--git',
      '--diff',
      baseSha,
      headSha,
      '--by-file',
      '--json',
      `--diff-timeout=${DIFF_TIMEOUT_SECONDS}`,
      `--report-file=${reportPath}`,
    ],
    {
      cwd,
      listeners: {
        stdout: (data) => {
          output += data.toString()
        },
        stderr: (data) => {
          output += data.toString()
        },
      },
    }
  )

  // cloc exits 0 having written a report that silently drops whatever it could
  // not diff -- a timed-out file comes back as wholly removed. Its own error
  // lines are the only signal, so a count we know is wrong fails here instead
  // of being published as fact.
  const errors = output
    .split('\n')
    .filter((line) => line.startsWith('Diff error'))
    .map((line) => line.trim())
  if (errors.length > 0) {
    throw new Error(
      `cloc could not diff ${errors.length} file(s), so these counts would be wrong:\n${errors.join('\n')}`
    )
  }

  // How cloc signals "nothing countable here" depends on its version: 2.10
  // writes `{}`, 2.06 wrote no file at all. Tolerate the absent file so the
  // pinned version can move either way, but keep it apart from a file that
  // will not parse or whose counts are not numbers -- those are real failures,
  // and must not be reported as a count of zero.
  const raw = await readFile(reportPath, 'utf8').catch(() => null)
  if (raw === null) {
    info(
      'cloc produced no report — treating the range as holding no countable lines.'
    )
    return {}
  }

  return clocDiffReportSchema.parse(JSON.parse(raw))
}
