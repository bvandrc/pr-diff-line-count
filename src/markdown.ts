/**
 * @fileoverview Renders a category tally as the markdown that goes in the job
 * summary and the `markdown` output.
 */

import { sum } from 'es-toolkit'
import { z } from 'zod'

import { CHANGE_KINDS } from './cloc/run.ts'
import {
  type CategoryTally,
  type DiffTally,
  FILE_CATEGORIES,
  type FileCategory,
} from './tally.ts'

const CATEGORY_LABELS = {
  source: 'Source',
  tests: 'Tests',
  generated: 'Generated',
  docs: 'Docs',
  config: 'Config',
} as const satisfies Record<FileCategory, string>

/**
 * The count columns, grouped under the header each group spans. The order is
 * the order a row's cells are built in.
 */
const COLUMN_GROUPS = [
  { label: 'code', signs: ['+', '~', '−'] },
  { label: 'comments', signs: ['+', '−'] },
] as const

/**
 * GitHub's own PR-level counts, shown alongside ours so the gap is visible.
 * Exported as a schema because the event payload they come from is untyped.
 */
export const githubDiffTotalsSchema = z.object({
  additions: z.number(),
  deletions: z.number(),
})

export type GithubDiffTotals = z.infer<typeof githubDiffTotalsSchema>

/** Whether a category earned a row: any count, of any kind, above zero. */
const hasAnyLine = (tally: CategoryTally) =>
  sum(CHANGE_KINDS.flatMap((kind) => Object.values(tally[kind]))) > 0

/** Keeps a phrase on one line, whatever the comment's width. */
const unbreakable = (text: string) => text.replaceAll(' ', '&nbsp;')

const row = (label: string, tally: CategoryTally) =>
  [
    `<td>${label}</td>`,
    ...[
      tally.added.code,
      tally.modified.code,
      tally.removed.code,
      tally.added.comment,
      tally.removed.comment,
    ].map((count) => `<td align="right">${count}</td>`),
  ].join('')

/**
 * Renders one diff as a table. Returns markdown ready to post or display, with
 * untouched categories left out of the table entirely.
 *
 * The table is HTML rather than markdown: the sign columns are grouped under a
 * spanning `code` / `comment` header, and a markdown table has no colspan.
 */
export function renderMarkdown(
  tally: DiffTally,
  { githubTotals: ghTotals }: { githubTotals?: GithubDiffTotals } = {}
): string {
  const lines = ['### PR Diff Line Count']

  // The tally carries every category; a row is only worth showing for one the
  // diff actually touched.
  const shown = FILE_CATEGORIES.filter((category) =>
    hasAnyLine(tally.byCategory[category])
  )

  if (shown.length === 0) {
    lines.push(
      'No counted line changes — nothing but renames, moves, or files cloc does not count.'
    )
    return lines.join('\n\n')
  }

  const rows = shown.map((category) =>
    row(CATEGORY_LABELS[category], tally.byCategory[category])
  )
  if (shown.length > 1) rows.push(row('<strong>Total</strong>', tally.total))

  const source = tally.byCategory.source
  const srcCodeHeaderStr = `**${unbreakable(`Source code: +${source.added.code} / ~${source.modified.code} / −${source.removed.code}`)}**`
  const ghTotalsStr = ghTotals
    ? ` ${unbreakable(' · ')} ${unbreakable(`GitHub reports +${ghTotals.additions} / −${ghTotals.deletions}`)}`
    : ''

  lines.push(
    `${srcCodeHeaderStr}${ghTotalsStr}`,
    [
      '<table>',
      // label header row
      `<tr><td></td>${COLUMN_GROUPS.map(({ label, signs }) => `<th colspan="${signs.length}" align="center">${label}</th>`).join('')}</tr>`,
      // sign header row
      `<tr><td></td>${COLUMN_GROUPS.flatMap(({ signs }) => signs)
        .map((sign) => `<th align="center">${sign}</th>`)
        .join('')}</tr>`,
      ...rows.map((cells) => `<tr>${cells}</tr>`),
      '</table>',
    ].join('\n'),
    `<sub>\`~\` is a line changed in place — cloc counts it once rather than as an add plus a delete, so these columns do not sum to GitHub's.\nBlank lines are excluded above: ${unbreakable(`+${tally.total.added.blank} / −${tally.total.removed.blank}.`)}</sub>`
  )

  return lines.join('\n\n')
}
